/**
 * Source-only Supabase Cron ingress for the future Phase 7 dispatcher.
 *
 * This function deliberately remains non-operational. It authenticates the
 * scheduler header without reading a request body, then rejects the call
 * before it can touch a queue, database, object storage, or email provider.
 * A future reviewed release must replace this whole implementation together
 * with the Phase 7 migration, provider adapter, and integration tests.
 */

export {};

declare const Deno: Readonly<{
  env: Readonly<{
    get(name: string): string | undefined;
  }>;
  serve(handler: (request: Request) => Response | Promise<Response>): void;
}>;

const OUTBOUND_CRON_DISPATCH_ENABLED = false;
const schedulerHeader = "x-outbound-cron-secret";
const schedulerSecretName = "OUTBOUND_CRON_SCHEDULER_SECRET";
const encoder = new TextEncoder();

function json(body: Readonly<Record<string, string>>, status: number, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    status,
  });
}

/** Compares fixed-length SHA-256 digests so the supplied secret is not compared directly. */
async function secretsMatch(expected: string, supplied: string): Promise<boolean> {
  const [expectedDigest, suppliedDigest] = await Promise.all(
    [expected, supplied].map(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))),
  );

  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= expectedDigest[index] ^ suppliedDigest[index];
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ code: "method_not_allowed" }, 405, { Allow: "POST" });
  }

  const configuredSecret = Deno.env.get(schedulerSecretName);
  if (!configuredSecret) {
    return json(
      {
        code: "outbound_cron_not_configured",
        reason: "Outbound Cron dispatch is not configured.",
      },
      503,
    );
  }

  const suppliedSecret = request.headers.get(schedulerHeader);
  if (!suppliedSecret || !(await secretsMatch(configuredSecret, suppliedSecret))) {
    return json({ code: "unauthorized_scheduler" }, 401);
  }

  if (!OUTBOUND_CRON_DISPATCH_ENABLED) {
    return json(
      {
        code: "outbound_delivery_not_configured",
        reason: "Outbound delivery is not configured. Phase 7A accepts no Cron dispatch work.",
      },
      503,
    );
  }

  return json({ code: "outbound_delivery_not_configured" }, 503);
});
