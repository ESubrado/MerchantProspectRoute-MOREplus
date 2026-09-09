import "server-only";

import { getOutboundScaffoldingStatus, type OutboundScaffoldingStatus } from "@/lib/outbound/phase-7a";

export type OutboundWorkerCycleResult = Readonly<{
  claimedJobs: 0;
  status: OutboundScaffoldingStatus;
}>;

/**
 * Placeholder for the future worker entry point.
 *
 * Phase 7A deliberately does not connect to the database, a queue, object
 * storage, or an email provider. A later worker may claim leased jobs here
 * only after the Phase 7 migration and all provider/host requirements are
 * approved. Keeping this callable and side-effect-free lets a host verify it
 * cannot send mail before that release exists.
 */
export async function runOutboundDispatchCycle(): Promise<OutboundWorkerCycleResult> {
  return { claimedJobs: 0, status: getOutboundScaffoldingStatus() };
}
