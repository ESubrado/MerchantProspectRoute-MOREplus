"use server";

import { revalidatePath } from "next/cache";

import { createWorkspaceMailbox, type MailboxStatus, type MailboxWriteInput, updateWorkspaceMailbox } from "@/lib/mailboxes/mailboxes";

export type MailboxActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const emailPattern = /^[^\s@]+@[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wholeNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Validates browser input before the database repeats the tenant-independent policy invariants. */
function mailboxInput(formData: FormData): { input: MailboxWriteInput } | { message: string } {
  const emailAddress = String(formData.get("emailAddress") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const rawStatus = String(formData.get("status") ?? "").trim();
  const localDayTimezone = String(formData.get("localDayTimezone") ?? "").trim();
  const dailyCapacityLimit = wholeNumber(String(formData.get("dailyCapacityLimit") ?? ""));
  const manualPause = formData.get("manualPause") === "on";
  const manualPauseReason = String(formData.get("manualPauseReason") ?? "").trim();
  const rampEnabled = formData.get("rampEnabled") === "on";
  const rampStartDate = String(formData.get("rampStartDate") ?? "").trim();
  const rampInitialDailyCapacity = wholeNumber(String(formData.get("rampInitialDailyCapacity") ?? ""));
  const rampDailyIncrement = wholeNumber(String(formData.get("rampDailyIncrement") ?? ""));
  const rampMaxDailyCapacity = wholeNumber(String(formData.get("rampMaxDailyCapacity") ?? ""));

  if (!emailPattern.test(emailAddress) || emailAddress.length > 320) return { message: "Enter a valid mailbox email address." };
  if (displayName.length > 120) return { message: "Mailbox display name must be 120 characters or fewer." };
  if (rawStatus !== "active" && rawStatus !== "paused") return { message: "Choose an active or paused mailbox status." };
  if (!localDayTimezone || localDayTimezone.length > 100 || !validIanaTimezone(localDayTimezone)) {
    return { message: "Use a valid IANA timezone, for example America/New_York or Asia/Singapore." };
  }
  if (dailyCapacityLimit === null || dailyCapacityLimit < 1 || dailyCapacityLimit > 10000) {
    return { message: "Daily capacity must be a whole number between 1 and 10,000." };
  }
  if (manualPause && (!manualPauseReason || manualPauseReason.length > 500)) {
    return { message: "Give a manual-pause reason of up to 500 characters." };
  }

  if (rampEnabled) {
    if (!validDate(rampStartDate)) return { message: "Choose the date on which the daily ramp starts." };
    if (rampInitialDailyCapacity === null || rampInitialDailyCapacity < 1 || rampInitialDailyCapacity > dailyCapacityLimit) {
      return { message: "Ramp starting capacity must be between 1 and the daily capacity limit." };
    }
    if (rampDailyIncrement === null || rampDailyIncrement < 0 || rampDailyIncrement > dailyCapacityLimit) {
      return { message: "Ramp daily increment must be between 0 and the daily capacity limit." };
    }
    if (rampMaxDailyCapacity === null || rampMaxDailyCapacity < rampInitialDailyCapacity || rampMaxDailyCapacity > dailyCapacityLimit) {
      return { message: "Ramp maximum must be at least the starting capacity and no more than the daily capacity limit." };
    }
  }

  return {
    input: {
      dailyCapacityLimit,
      displayName: displayName || null,
      emailAddress,
      localDayTimezone,
      manualPause,
      manualPauseReason: manualPause ? manualPauseReason : null,
      rampDailyIncrement: rampEnabled ? rampDailyIncrement : null,
      rampEnabled,
      rampInitialDailyCapacity: rampEnabled ? rampInitialDailyCapacity : null,
      rampMaxDailyCapacity: rampEnabled ? rampMaxDailyCapacity : null,
      rampStartDate: rampEnabled ? rampStartDate : null,
      status: rawStatus as MailboxStatus,
    },
  };
}

export async function createMailboxAction(_previousState: MailboxActionState, formData: FormData): Promise<MailboxActionState> {
  const parsed = mailboxInput(formData);
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  const result = await createWorkspaceMailbox(parsed.input);
  if (result.type === "error") return { message: result.message ?? "The mailbox could not be created.", status: "error" };

  revalidatePath("/outreach/mailboxes");
  return { message: "Mailbox configuration saved.", status: "success" };
}

export async function updateMailboxAction(_previousState: MailboxActionState, formData: FormData): Promise<MailboxActionState> {
  const mailboxId = String(formData.get("mailboxId") ?? "").trim();
  if (!uuidPattern.test(mailboxId)) return { message: "This mailbox reference is invalid. Refresh the page and try again.", status: "error" };

  const parsed = mailboxInput(formData);
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  const result = await updateWorkspaceMailbox(mailboxId, parsed.input);
  if (result.type === "error") return { message: result.message ?? "The mailbox could not be saved.", status: "error" };

  revalidatePath("/outreach/mailboxes");
  return { message: "Mailbox configuration updated.", status: "success" };
}
