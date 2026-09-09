import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const phaseGate = await readFile(new URL("../../lib/outbound/phase-7a.ts", import.meta.url), "utf8");
const adapter = await readFile(new URL("../../lib/outbound/provider-adapter.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../../lib/outbound/worker.ts", import.meta.url), "utf8");
const statusRoute = await readFile(new URL("../../app/api/outbound/status/route.ts", import.meta.url), "utf8");
const webhookRoute = await readFile(new URL("../../app/api/outbound/webhook/route.ts", import.meta.url), "utf8");
const scaffoldGuide = await readFile(new URL("../../docs/phase-7a-outbound-scaffolding.md", import.meta.url), "utf8");
const implementationPlan = await readFile(new URL("../../docs/implementation-plan.md", import.meta.url), "utf8");

test("Phase 7A keeps outbound delivery hard-disabled in server-only code", () => {
  assert.match(phaseGate, /import "server-only"/);
  assert.match(phaseGate, /const OUTBOUND_DELIVERY_ENABLED = false/);
  assert.match(phaseGate, /outbound_delivery_not_configured/);
  assert.match(phaseGate, /assertOutboundDeliveryEnabled/);
  assert.doesNotMatch(phaseGate, /process\.env/);
});

test("Phase 7A defines a provider-neutral contract with only a no-network disabled adapter", () => {
  assert.match(adapter, /export interface OutboundProviderAdapter/);
  assert.match(adapter, /idempotencyKey/);
  assert.match(adapter, /reconcileSubmission/);
  assert.match(adapter, /verifyWebhook/);
  assert.match(adapter, /class DisabledOutboundProviderAdapter/);
  assert.match(adapter, /assertOutboundDeliveryEnabled/);
  assert.doesNotMatch(adapter, /\bfetch\s*\(/);
  assert.doesNotMatch(adapter, /EMAIL_PROVIDER_/);
});

test("Phase 7A worker reports disabled without queue, storage, database, or provider access", () => {
  assert.match(worker, /claimedJobs: 0/);
  assert.match(worker, /getOutboundScaffoldingStatus/);
  assert.doesNotMatch(worker, /\.rpc\s*\(/);
  assert.doesNotMatch(worker, /createServiceClient/);
  assert.doesNotMatch(worker, /\bfetch\s*\(/);
});

test("Phase 7A exposes only a safe status route and a body-rejecting webhook stub", () => {
  assert.match(statusRoute, /export async function GET/);
  assert.match(statusRoute, /Cache-Control/);
  assert.match(webhookRoute, /export async function POST/);
  assert.match(webhookRoute, /status: 503/);
  assert.match(webhookRoute, /outbound_delivery_not_configured/);
  assert.doesNotMatch(webhookRoute, /request\.json\s*\(/);
  assert.doesNotMatch(webhookRoute, /request\.text\s*\(/);
});

test("Phase 7A documents the disabled contract and future-only secret names", () => {
  assert.match(scaffoldGuide, /cannot submit email/i);
  assert.match(scaffoldGuide, /Completion checklist before enabling delivery/i);
  assert.match(scaffoldGuide, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(scaffoldGuide, /OUTBOUND_DELIVERY_ENABLED/);
  assert.match(implementationPlan, /Phase 7A disabled outbound scaffolding/i);
});
