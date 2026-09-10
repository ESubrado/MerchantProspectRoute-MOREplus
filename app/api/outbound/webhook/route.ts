import { getOutboundScaffoldingStatus } from "@/lib/outbound/phase-7a";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deliberately rejects every provider event in Phase 7A.
 *
 * Do not read or parse the request body here. A provider-specific signature
 * verifier must be selected and tested before untrusted webhook data is
 * accepted, persisted, or allowed to change lead/enrollment state.
 */
export async function POST() {
  return Response.json(
    {
      code: "outbound_delivery_not_configured",
      ...getOutboundScaffoldingStatus(),
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: 503,
    },
  );
}
