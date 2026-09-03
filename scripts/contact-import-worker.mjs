import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const bucket = "contact-imports";
const batchSize = 200;
const maxFileBytes = 10 * 1024 * 1024;
const workerId = process.env.CONTACT_IMPORT_WORKER_ID || `contact-import-${randomUUID()}`;
const watch = process.argv.includes("--watch");

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isStorageObjectMissing(error) {
  return Boolean(error && typeof error === "object" && "status" in error && [400, 404].includes(Number(error.status)));
}

/** Parses UTF-8 RFC 4180-style CSV while preserving the physical row where each record began. */
function parseCsvDocument(text) {
  const records = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  function finishRecord() {
    cells.push(cell);
    if (cells.some((value) => value.trim() !== "")) records.push({ cells, rowNumber: recordLine });
    cells = [];
    cell = "";
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (character === '"' && cell === "") {
      quoted = true;
    } else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      finishRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (cell !== "" || cells.length > 0) finishRecord();
  return records;
}

function rowsForJob(records, mapping) {
  if (records.length < 2) throw new Error("CSV must include a header row and at least one data row.");
  if (!Array.isArray(mapping) || mapping.length !== records[0].cells.length) throw new Error("CSV header column count does not match the persisted import mapping.");

  return records.slice(1).map((record, index) => {
    const row = { row_number: record.rowNumber, source_index: index + 1 };
    mapping.forEach((field, index) => {
      if (field !== "ignore") row[field] = record.cells[index] ?? "";
    });
    return row;
  });
}

async function callRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function releaseMissingUpload(client, job) {
  await callRpc(client, "crm_release_contact_import_job", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
  });
  console.log(`Waiting for private upload for import job ${job.id}.`);
}

async function failJob(client, job, error) {
  try {
    await callRpc(client, "crm_fail_contact_import_job", {
      p_error: errorMessage(error).slice(0, 1000),
      p_job_id: job.id,
      p_lease_token: job.lease_token,
    });
    console.error(`Import job ${job.id} failed: ${errorMessage(error)}`);
  } catch (failure) {
    console.error(`Import job ${job.id} could not record its failure: ${errorMessage(failure)}`);
  }
}

async function processJob(client, job) {
  const { data: blob, error: downloadError } = await client.storage.from(bucket).download(job.storage_path);
  if (downloadError || !blob) {
    if (isStorageObjectMissing(downloadError)) {
      await releaseMissingUpload(client, job);
      return "waiting";
    }
    throw new Error(`Private CSV could not be downloaded: ${downloadError?.message ?? "unknown storage error"}`);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > maxFileBytes) throw new Error("CSV exceeds the 10 MiB import limit.");
  if (bytes.includes(0)) throw new Error("CSV contains a NUL byte and is not accepted.");

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("CSV must be encoded as UTF-8.");
  }

  const parsedRows = rowsForJob(parseCsvDocument(text), job.mapping);
  if (job.processed_rows > parsedRows.length) throw new Error("Persisted import progress exceeds the CSV row count.");

  let processedRows = job.processed_rows;
  while (processedRows < parsedRows.length) {
    const batch = parsedRows.slice(processedRows, processedRows + batchSize);
    const expectedProcessedRows = processedRows;
    try {
      processedRows = await callRpc(client, "crm_process_contact_import_batch", {
        p_expected_processed_rows: expectedProcessedRows,
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_rows: batch,
        p_total_rows: parsedRows.length,
      });
    } catch (error) {
      const state = await callRpc(client, "crm_get_contact_import_worker_state", {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
      });
      const recoveredProcessedRows = Array.isArray(state) ? state[0]?.processed_rows : null;
      if (typeof recoveredProcessedRows === "number" && recoveredProcessedRows >= expectedProcessedRows + batch.length) {
        processedRows = recoveredProcessedRows;
      } else {
        throw error;
      }
    }
  }

  await callRpc(client, "crm_complete_contact_import_job", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
  });
  console.log(`Completed import job ${job.id}.`);
  return "completed";
}

async function claimJob(client) {
  const data = await callRpc(client, "crm_claim_contact_import_job", {
    p_lease_seconds: 300,
    p_worker_id: workerId,
  });
  return Array.isArray(data) ? data[0] ?? null : null;
}

async function run() {
  const client = serviceClient();
  do {
    const job = await claimJob(client);
    if (!job) {
      if (!watch) return;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }

    try {
      const outcome = await processJob(client, job);
      if (outcome === "waiting") {
        if (!watch) return;
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    } catch (error) {
      await failJob(client, job, error);
    }
  } while (watch);
}

run().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
