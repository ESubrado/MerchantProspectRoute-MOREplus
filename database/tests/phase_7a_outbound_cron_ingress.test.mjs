import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionSource = await readFile(new URL("../../supabase/functions/outbound-dispatch/index.ts", import.meta.url), "utf8");
const functionConfig = await readFile(new URL("../../supabase/config.toml", import.meta.url), "utf8");
const runbook = await readFile(new URL("../../docs/supabase-cron-runbook.md", import.meta.url), "utf8");
const cronTemplate = await readFile(new URL("../../supabase/cron/outbound-dispatch.sql.example", import.meta.url), "utf8");
const cronJobCommand = await readFile(new URL("../../supabase/cron/outbound-dispatch-command.sql.example", import.meta.url), "utf8");

test("Phase 7A Cron ingress authenticates a scheduler but remains side-effect-free", () => {
  assert.match(functionSource, /Deno\.serve/);
  assert.match(functionSource, /x-outbound-cron-secret/);
  assert.match(functionSource, /OUTBOUND_CRON_SCHEDULER_SECRET/);
  assert.match(functionSource, /OUTBOUND_CRON_DISPATCH_ENABLED = false/);
  assert.match(functionSource, /outbound_delivery_not_configured/);
  assert.match(functionSource, /\b503\b/);
  assert.doesNotMatch(functionSource, /request\.json\s*\(/);
  assert.doesNotMatch(functionSource, /request\.text\s*\(/);
  assert.doesNotMatch(functionSource, /\.rpc\s*\(/);
  assert.doesNotMatch(functionSource, /createClient/);
  assert.doesNotMatch(functionSource, /\bfetch\s*\(/);
  assert.doesNotMatch(functionSource, /pgmq/i);
});

test("Phase 7A Cron ingress uses custom scheduler authentication and documents the inactive deployment", () => {
  assert.match(functionConfig, /\[functions\.outbound-dispatch\]/);
  assert.match(functionConfig, /verify_jwt = false/);
  assert.match(runbook, /source-only, non-operational/i);
  assert.match(runbook, /Supabase Vault/i);
  assert.match(runbook, /must not be deployed as an active scheduler/i);
  assert.match(cronTemplate, /DO NOT EXECUTE during Phase 7A/i);
  assert.match(cronTemplate, /vault\.decrypted_secrets/);
  assert.match(cronTemplate, /x-outbound-cron-secret/);
  assert.doesNotMatch(cronTemplate, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(cronJobCommand, /Dashboard Cron Job -> SQL snippet/i);
  assert.match(cronJobCommand, /vault\.decrypted_secrets/);
  assert.doesNotMatch(cronJobCommand, /SUPABASE_SERVICE_ROLE_KEY/);
});
