"use server";

import { revalidatePath } from "next/cache";

import { createCampaignSequence } from "@/lib/sequences/sequences";

export type SequenceActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

function validIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Validates the small Phase 5.1 draft command before the database repeats its authorization and ownership checks. */
export async function createSequenceAction(_previousState: SequenceActionState, formData: FormData): Promise<SequenceActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const scheduleTimezone = String(formData.get("scheduleTimezone") ?? "").trim();

  if (!name || name.length > 160) return { message: "Enter a sequence name of up to 160 characters.", status: "error" };
  if (!scheduleTimezone || scheduleTimezone.length > 100 || !validIanaTimezone(scheduleTimezone)) {
    return { message: "Use a valid IANA schedule timezone, for example America/New_York or Asia/Singapore.", status: "error" };
  }

  const result = await createCampaignSequence({ name, scheduleTimezone });
  if (result.type === "error") return { message: result.message ?? "The sequence could not be created.", status: "error" };

  revalidatePath("/outreach/sequences");
  return { message: "Draft sequence created in the current campaign.", status: "success" };
}
