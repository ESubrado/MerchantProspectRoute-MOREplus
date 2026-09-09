import "server-only";

import { assertOutboundDeliveryEnabled } from "@/lib/outbound/phase-7a";

/**
 * Provider-neutral contract for the reviewed Phase 7 implementation.
 *
 * A future adapter may translate this contract to EmailEngine or another
 * project-owned provider, but provider SDK types and identifiers must not leak
 * into routing, enrollment, or attempt code. `idempotencyKey` is supplied by
 * the target-owned send-attempt record and must remain stable on every retry.
 */
export type ProviderSubmissionInput = Readonly<{
  attemptId: string;
  htmlBody: string | null;
  idempotencyKey: string;
  mailboxId: string;
  recipient: string;
  subject: string;
  textBody: string;
}>;

/** Persist these provider identifiers before treating an attempt as submitted. */
export type ProviderSubmissionResult = Readonly<{
  providerMessageId: string | null;
  providerSubmissionId: string;
  submittedAt: string;
}>;

/**
 * A timeout is an unknown outcome, not permission to create another send.
 * A real adapter must reconcile with the same idempotency key before a worker
 * can retry or release a capacity reservation.
 */
export type ProviderSubmissionReconciliation =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ result: ProviderSubmissionResult; status: "submitted" }>;

/** Raw values are required because webhook signatures cover the exact bytes. */
export type ProviderWebhookRequest = Readonly<{
  body: Uint8Array;
  headers: Headers;
}>;

/**
 * A verified event is intentionally provider-neutral. Phase 7 will persist the
 * raw event and provider event ID before changing any attempt or enrollment.
 */
export type VerifiedProviderWebhook = Readonly<{
  occurredAt: string;
  providerEventId: string;
  providerSubmissionId: string | null;
  type: "bounce" | "delivery_failed" | "delivered" | "reply";
}>;

export interface OutboundProviderAdapter {
  readonly providerName: string;
  reconcileSubmission(input: Pick<ProviderSubmissionInput, "idempotencyKey" | "mailboxId">): Promise<ProviderSubmissionReconciliation>;
  submit(input: ProviderSubmissionInput): Promise<ProviderSubmissionResult>;
  verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedProviderWebhook>;
}

/**
 * The only adapter available in Phase 7A. It intentionally has no network,
 * provider SDK, credential lookup, database access, or webhook parser.
 */
class DisabledOutboundProviderAdapter implements OutboundProviderAdapter {
  readonly providerName = "disabled";

  async reconcileSubmission(): Promise<never> {
    assertOutboundDeliveryEnabled();
  }

  async submit(): Promise<never> {
    assertOutboundDeliveryEnabled();
  }

  async verifyWebhook(): Promise<never> {
    assertOutboundDeliveryEnabled();
  }
}

const disabledOutboundProviderAdapter = new DisabledOutboundProviderAdapter();

/**
 * Future code must replace this only after a specific provider's signature,
 * idempotency, submission-ID, webhook-retry, rate-limit, and reconciliation
 * behavior has been documented and integration-tested.
 */
export function getOutboundProviderAdapter(): OutboundProviderAdapter {
  return disabledOutboundProviderAdapter;
}
