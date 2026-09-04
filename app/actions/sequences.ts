"use server";

import { revalidatePath } from "next/cache";

import {
  createCampaignSequence,
  createCampaignSequenceStep,
  deleteCampaignSequenceStep,
  deleteCampaignSequenceStepVariant,
  reorderCampaignSequenceSteps,
  saveCampaignSequenceStepVariant,
  setCampaignSequenceStatus,
  updateCampaignSequenceConfiguration,
  updateCampaignSequenceStep,
  type CampaignSequenceStatus,
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
const variantKeyPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;

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

/** Extracts a valid step UUID from an untrusted form submission. */
function stepId(formData: FormData): string | null {
  const value = String(formData.get("stepId") ?? "").trim();
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
  const name = String(formData.get("name") ?? "").trim();
  const scheduleTimezone = String(formData.get("scheduleTimezone") ?? "").trim();
  const throttleMaxSendsPerHour = wholeNumber(String(formData.get("throttleMaxSendsPerHour") ?? ""));
  const jitterMaxMinutes = wholeNumber(String(formData.get("jitterMaxMinutes") ?? ""));
  const rawWindows = String(formData.get("weeklyWindows") ?? "");

  if (!name || name.length > 160) return { message: "Enter a sequence name of up to 160 characters." };
  if (!scheduleTimezone || scheduleTimezone.length > 100 || !validIanaTimezone(scheduleTimezone)) {
    return { message: "Use a valid IANA schedule timezone, for example America/New_York or Asia/Singapore." };
  }
  if (throttleMaxSendsPerHour === null || throttleMaxSendsPerHour < 1 || throttleMaxSendsPerHour > 10000) {
    return { message: "Throttle must be a whole number from 1 to 10,000 sends per hour." };
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

  return { input: { jitterMaxMinutes, name, scheduleTimezone, throttleMaxSendsPerHour, weeklyWindows } };
}

/** Converts a domain command result into UI state and invalidates the sequence route after a successful mutation. */
function stateFromResult(result: { message?: string; type: "error" | "success" }, successMessage: string): SequenceActionState {
  if (result.type === "error") return { message: result.message ?? "The sequence configuration could not be saved.", status: "error" };

  revalidatePath(actionPath);
  return { message: successMessage, status: "success" };
}

/** Creates an inert draft with its required first step; schedule and template completeness are validated only when a manager activates it. */
export async function createSequenceAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const scheduleTimezone = String(formData.get("scheduleTimezone") ?? "").trim();
  if (!name || name.length > 160) return { message: "Enter a sequence name of up to 160 characters.", status: "error" };
  if (!scheduleTimezone || scheduleTimezone.length > 100 || !validIanaTimezone(scheduleTimezone)) {
    return { message: "Use a valid IANA schedule timezone, for example America/New_York or Asia/Singapore.", status: "error" };
  }

  return stateFromResult(await createCampaignSequence({ name, scheduleTimezone }), "Draft sequence created with its first step. Add schedule windows and a complete template variant before activation.");
}

/** Saves schedule windows, timezone, throttle, and jitter for an editable sequence. */
export async function saveSequenceConfigurationAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  if (!id) return { message: "This sequence reference is invalid. Refresh the page and try again.", status: "error" };
  const parsed = sequenceConfigurationInput(formData);
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  return stateFromResult(await updateCampaignSequenceConfiguration(id, parsed.input), "Schedule, timezone, throttle, and jitter saved. Automation remains disabled.");
}

/** Appends a new zero-delay step to an editable sequence. */
export async function createSequenceStepAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  if (!id) return { message: "This sequence reference is invalid. Refresh the page and try again.", status: "error" };

  return stateFromResult(await createCampaignSequenceStep(id, 0), "Step added. Add a complete template variant before activation.");
}

/** Updates only a step's delay; reordering is handled by its own transactional command. */
export async function saveSequenceStepAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const currentStepId = stepId(formData);
  const delayAfterPreviousMinutes = wholeNumber(String(formData.get("delayAfterPreviousMinutes") ?? ""));
  if (!id || !currentStepId) return { message: "This sequence step reference is invalid. Refresh the page and try again.", status: "error" };
  if (delayAfterPreviousMinutes === null || delayAfterPreviousMinutes < 0 || delayAfterPreviousMinutes > 525600) {
    return { message: "Step delay must be a whole number from 0 to 525,600 minutes.", status: "error" };
  }

  return stateFromResult(await updateCampaignSequenceStep(id, currentStepId, delayAfterPreviousMinutes), "Step delay saved.");
}

/** Deletes an editable step and its owned template variants. */
export async function deleteSequenceStepAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const currentStepId = stepId(formData);
  if (!id || !currentStepId) return { message: "This sequence step reference is invalid. Refresh the page and try again.", status: "error" };

  return stateFromResult(await deleteCampaignSequenceStep(id, currentStepId), "Step and its template variants deleted.");
}

/** Submits the full ordered step list, which the database validates as an exact set before committing. */
export async function reorderSequenceStepsAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  if (!id) return { message: "This sequence reference is invalid. Refresh the page and try again.", status: "error" };

  let stepIds: unknown;
  try {
    stepIds = JSON.parse(String(formData.get("stepIds") ?? ""));
  } catch {
    return { message: "The sequence step order is invalid. Refresh the page and try again.", status: "error" };
  }
  if (!Array.isArray(stepIds) || stepIds.some((candidate) => typeof candidate !== "string" || !uuidPattern.test(candidate)) || new Set(stepIds).size !== stepIds.length) {
    return { message: "The sequence step order is invalid. Refresh the page and try again.", status: "error" };
  }

  return stateFromResult(await reorderCampaignSequenceSteps(id, stepIds), "Step order saved.");
}

/** Creates or updates a provider-neutral subject/body template variant for one step. */
export async function saveSequenceStepVariantAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const currentStepId = stepId(formData);
  const currentVariantId = variantId(formData);
  const variantKey = String(formData.get("variantKey") ?? "").trim().toLowerCase();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  if (!id || !currentStepId || currentVariantId === "invalid") return { message: "This sequence template reference is invalid. Refresh the page and try again.", status: "error" };
  if (!variantKeyPattern.test(variantKey)) return { message: "Variant keys use 1 to 32 lowercase letters, numbers, underscores, or hyphens.", status: "error" };
  if (!subject || subject.length > 250) return { message: "Template subject must be between 1 and 250 characters.", status: "error" };
  if (!body.trim() || body.length > 20000) return { message: "Template body must be between 1 and 20,000 characters.", status: "error" };

  return stateFromResult(await saveCampaignSequenceStepVariant(id, currentStepId, currentVariantId, { body, subject, variantKey }), "Template variant saved. It is stored only and will not send.");
}

/** Removes a template variant; activation will remain blocked if that leaves a step without a complete variant. */
export async function deleteSequenceStepVariantAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const currentStepId = stepId(formData);
  const currentVariantId = variantId(formData);
  if (!id || !currentStepId || !currentVariantId || currentVariantId === "invalid") return { message: "This sequence template reference is invalid. Refresh the page and try again.", status: "error" };

  return stateFromResult(await deleteCampaignSequenceStepVariant(id, currentStepId, currentVariantId), "Template variant deleted.");
}

/** Applies a lifecycle transition; activation validates configuration but never enables dispatch. */
export async function setSequenceStatusAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const id = sequenceId(formData);
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { message: "This sequence reference is invalid. Refresh the page and try again.", status: "error" };
  if (status !== "draft" && status !== "active" && status !== "paused" && status !== "archived") {
    return { message: "Choose a valid sequence state.", status: "error" };
  }

  const successMessage = status === "active"
    ? "Configuration activated. Automation is not configured, so no contacts will be enrolled or sent."
    : `Sequence state changed to ${status}.`;
  return stateFromResult(await setCampaignSequenceStatus(id, status as CampaignSequenceStatus), successMessage);
}
