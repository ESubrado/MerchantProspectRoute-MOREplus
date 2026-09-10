import "server-only";

/**
 * Phase 7A is intentionally a compile-time safety boundary, not a deployment
 * setting. Do not replace this literal with an environment variable: a secret
 * being added to a host must never be enough to start sending email.
 */
const OUTBOUND_DELIVERY_ENABLED = false;

export const OUTBOUND_DELIVERY_DISABLED_MESSAGE =
  "Outbound delivery is not configured. Phase 7A accepts no provider submissions or webhooks.";

export type OutboundScaffoldingStatus = {
  delivery: "disabled";
  phase: "7A";
  reason: string;
};

/** Returned to operators and callers without exposing any deployment secret. */
export function getOutboundScaffoldingStatus(): OutboundScaffoldingStatus {
  return {
    delivery: "disabled",
    phase: "7A",
    reason: OUTBOUND_DELIVERY_DISABLED_MESSAGE,
  };
}

/**
 * Thrown by every future submission boundary until a reviewed Phase 7 release
 * replaces the Phase 7A scaffold. Keep this guard ahead of database, queue,
 * provider, or webhook work so the disabled release cannot create side effects.
 */
export class OutboundDeliveryDisabledError extends Error {
  readonly code = "outbound_delivery_not_configured";

  constructor() {
    super(OUTBOUND_DELIVERY_DISABLED_MESSAGE);
    this.name = "OutboundDeliveryDisabledError";
  }
}

/**
 * Central fail-closed guard for all future outbound paths.
 *
 * The `if` is deliberately retained even though the current value is literal.
 * Changing the literal alone still throws: a future reviewed implementation
 * must replace this whole guard and the disabled adapter together after the
 * provider, worker, storage, migration, and test requirements are complete.
 */
export function assertOutboundDeliveryEnabled(): never {
  if (!OUTBOUND_DELIVERY_ENABLED) throw new OutboundDeliveryDisabledError();
  throw new OutboundDeliveryDisabledError();
}
