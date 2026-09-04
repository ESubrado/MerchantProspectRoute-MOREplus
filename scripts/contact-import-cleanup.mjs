import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const bucket = "contact-imports";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function callRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function run() {
  const client = serviceClient();
  const expired = await callRpc(client, "crm_list_expired_contact_import_sources", { p_limit: 100 });

  for (const job of expired ?? []) {
    const { error } = await client.storage.from(bucket).remove([job.storage_path]);
    if (error) {
      console.error(`Could not delete retained CSV for ${job.job_id}: ${error.message}`);
      continue;
    }
    await callRpc(client, "crm_mark_contact_import_source_deleted", { p_job_id: job.job_id });
    console.log(`Deleted expired CSV source for import job ${job.job_id}.`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
