import { getOutboundScaffoldingStatus } from "@/lib/outbound/phase-7a";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Safe operator-facing readiness endpoint. It exposes no secret and reports
 * only the hard-disabled Phase 7A state; it does not inspect infrastructure.
 */
export async function GET() {
  return Response.json(getOutboundScaffoldingStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
