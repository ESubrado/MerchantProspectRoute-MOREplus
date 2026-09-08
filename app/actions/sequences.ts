"use server";

import { revalidatePath } from "next/cache";

import {
  archiveCampaignSequence,
  createCampaignSequence,
  deleteCampaignSequence,
  deleteCampaignSequenceVariant,
  saveCampaignSequenceVariant,
  setCampaignLifecycleStatus,
  updateCampaignSequenceConfiguration,
  type SequenceConfigurationInput,
  type SequenceScheduleWindow,
} from "@/lib/sequences/sequences";

export type SequenceActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const actionPath = "/outreach/sequences";
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uses the runtime's IANA database to reject invalid browser-supplied timezone names. */
function validIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Accepts only integer form values so fractions and numeric coercion cannot reach database commands. */
function wholeNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Extracts a valid sequence UUID from an untrusted form submission. */
function sequenceId(formData: FormData): string | null {
  const value = String(formData.get("sequenceId") ?? "").trim();
  return uuidPattern.test(value) ? value : null;
}

/** Distinguishes a new variant from an invalid existing-variant reference. */
function variantId(formData: FormData): string | null | "invalid" {
  const value = String(formData.get("variantId") ?? "").trim();
  if (!value) return null;
  return uuidPattern.test(value) ? value : "invalid";
}

/** Detects conflicting local-time windows before the database repeats the same invariant transactionally. */
function windowsOverlap(windows: SequenceScheduleWindow[]) {
  return windows.some((left, leftIndex) => windows.slice(leftIndex + 1).some((right) => (
    left.days.some((day) => right.days.includes(day))
      && left.startTime < right.endTime
      && right.startTime < left.endTime
  )));
}

/** Performs client-facing validation before the transaction repeats it against the campaign-owned schedule. */
function sequenceConfigurationInput(formData: FormData): { input: SequenceConfigurationInput } | { message: string } {
  const scheduleTimezone = String(formData.get("scheduleTimezone") ?? "").trim();
  const jitterMaxMinutes = wholeNumber(String(formData.get("jitterMaxMinutes") ?? ""));
  const rawWindows = String(formData.get("weeklyWindows") ?? "");

  if (!scheduleTimezone || scheduleTimezone.length > 100 || !validIanaTimezone(scheduleTimezone)) {
    return { message: "Use a valid IANA schedule timezone, for example America/New_York or Asia/Singapore." };
  }
  if (jitterMaxMinutes === null || jitterMaxMinutes < 0 || jitterMaxMinutes > 1440) {
    return { message: "Jitter must be a whole number from 0 to 1,440 minutes." };
  }

  let parsedWindows: unknown;
  try {
    parsedWindows = JSON.parse(rawWindows);
  } catch {
    return { message: "Weekly windows could not be read. Remove invalid rows and try again." };
  }
  if (!Array.isArray(parsedWindows) || parsedWindows.length > 42) return { message: "Use up to 42 weekly schedule windows." };

  const weeklyWindows: SequenceScheduleWindow[] = [];
  for (const rawWindow of parsedWindows) {
    if (!rawWindow || typeof rawWindow !== "object" || Array.isArray(rawWindow)) return { message: "Each weekly window needs weekdays, a start time, and an end time." };
    const candidate = rawWindow as Record<string, unknown>;
    const days = candidate.days;
    const startTime = candidate.startTime;
    const endTime = candidate.endTime;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7 || !timePattern.test(String(startTime)) || !timePattern.test(String(endTime)) || String(startTime) >= String(endTime)) {
      return { message: "Each weekly window needs one or more weekdays and a valid HH:MM start before end time." };
    }
    if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) {
      return { message: "Choose each weekday at most once; Sunday is 0 and Saturday is 6." };
    }
    weeklyWindows.push({ days: days as number[], endTime: String(endTime), startTime: String(startTime) });
  }
  if (windowsOverlap(weeklyWindows)) return { message: "Weekly windows cannot overlap on the same weekday." };

  return { input: { jitterMaxMinutes, scheduleTimezone, weeklyWindows } };
}

/** Converts a domain command result into UI state and invalidates the sequence route after a successful mutation. */
function stateFromResult(result: { message?: string; type: "error" | "success" }, successMessage: string): SequenceActionState {
  if (result.type === "error") return { message: result.message ?? "The sequence configuration could not be saved.", status: "error" };

  revalidatePath(actionPath);
  return { message: successMessage, status: "success" };
}

/** Creates the next inert Step N draft; schedule and template completeness are validated only when a manager activates it. */
export async function createSequenceAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const scheduleTimezone = String(formData.get("scheduleTimezone") ?? "").trim();
  if (!scheduleTimezone || scheduleTimezone.length > 100 || !validIanaTimezone(scheduleTimezone)) {
    return { message: "Use a valid IANA schedule timezone, for example America/New_York or Asia/Singapore.", status: "error" };
  }

  return stateFromResult(await createCampaignSequence({ scheduleTimezone }), "New step created. Add schedule windows and a complete template variant before activation.");
}

/** Saves schedule windows, timezone, and jitter for an editable sequence. */
export async function saveSequenceConfigurationAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  if (!id) return { message: "This sequence reference is invalid. Refresh the page and try again.", status: "error" };
  const parsed = sequenceConfigurationInput(formData);
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  return stateFromResult(await updateCampaignSequenceConfiguration(id, parsed.input), "Schedule, timezone, and jitter saved. Automation remains disabled.");
}

/** Creates or updates a provider-neutral subject/body template variant for one sequence. */
export async function saveSequenceVariantAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const currentVariantId = variantId(formData);
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  if (!id || currentVariantId === "invalid") return { message: "This sequence template reference is invalid. Refresh the page and try again.", status: "error" };
  if (!subject || subject.length > 250) return { message: "Template subject must be between 1 and 250 characters.", status: "error" };
  if (!body.trim() || body.length > 20000) return { message: "Template body must be between 1 and 20,000 characters.", status: "error" };

  return stateFromResult(await saveCampaignSequenceVariant(id, currentVariantId, { body, subject }), "Template variant saved. It is stored only and will not send.");
}

/** Removes a template variant; activation remains blocked if none complete variants remain. */
export async function deleteSequenceVariantAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const currentVariantId = variantId(formData);
  if (!id || !currentVariantId || currentVariantId === "invalid") return { message: "This sequence template reference is invalid. Refresh the page and try again.", status: "error" };

  return stateFromResult(await deleteCampaignSequenceVariant(id, currentVariantId), "Template variant deleted.");
}

/** Removes an editable Step N record while the database preserves enrollment history and compacts later generated labels. */
export async function deleteSequenceAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  if (!id) return { message: "This step reference is invalid. Refresh the page and try again.", status: "error" };

  return stateFromResult(await deleteCampaignSequence(id), "Step removed. Remaining generated step labels have been renumbered.");
}

/** Launches, pauses, or resumes every non-archived step; activation validates each step but never enables dispatch. */
export async function setCampaignStatusAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const status = String(formData.get("status") ?? "").trim();
  if (status !== "active" && status !== "paused") {
    return { message: "Choose a valid campaign action.", status: "error" };
  }

  const successMessage = status === "active"
    ? "Campaign is active. Every non-archived step was validated; automation is not configured, so no contacts will be enrolled or sent."
    : "Campaign paused. Every active step can now be edited or removed.";
  return stateFromResult(await setCampaignLifecycleStatus(status), successMessage);
}

/** Archives one step without changing the lifecycle of other campaign steps. */
export async function archiveSequenceAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  if (!id) return { message: "This step reference is invalid. Refresh the page and try again.", status: "error" };

  return stateFromResult(await archiveCampaignSequence(id), "Step archived. It is retained as a read-only configuration record.");
}
