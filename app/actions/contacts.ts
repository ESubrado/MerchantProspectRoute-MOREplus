"use server";

import { revalidatePath } from "next/cache";

import { createWorkspaceContact, type ContactWriteInput, updateWorkspaceContact } from "@/lib/crm/contacts";

export type ContactActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the editable contact fields before the data layer calls an atomic database command. */
function contactInput(formData: FormData): { input: ContactWriteInput } | { message: string } {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const rawCompanyId = String(formData.get("companyId") ?? "").trim();
  const rawPrimaryEmail = String(formData.get("primaryEmail") ?? "").trim().toLowerCase();
  const rawReplyTemperature = String(formData.get("replyTemperature") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const replyTemperature = rawReplyTemperature === "" ? null : Number(rawReplyTemperature);

  if (!firstName && !lastName) return { message: "Enter a first or last name." };
  if (firstName.length > 100 || lastName.length > 100 || `${firstName} ${lastName}`.trim().length > 200) {
    return { message: "First and last names must be 100 characters or fewer each." };
  }
  if (rawCompanyId && !uuidPattern.test(rawCompanyId)) return { message: "Choose a company from this workspace." };
  if (rawPrimaryEmail && (!emailPattern.test(rawPrimaryEmail) || rawPrimaryEmail.length > 320)) {
    return { message: "Enter a valid primary email address or leave it blank." };
  }
  if (rawReplyTemperature && (replyTemperature === null || !Number.isInteger(replyTemperature) || replyTemperature < 0 || replyTemperature > 4)) {
    return { message: "Choose a valid reply classification." };
  }
  if (!stage || stage.length > 80) return { message: "Contact stage must contain between 1 and 80 characters." };
  if (!status || status.length > 80) return { message: "Contact status must contain between 1 and 80 characters." };

  return {
    input: {
      callDnc: formData.get("callDnc") === "on",
      companyId: rawCompanyId || null,
      emailDnc: formData.get("emailDnc") === "on",
      firstName: firstName || null,
      lastName: lastName || null,
      primaryEmail: rawPrimaryEmail || null,
      replyTemperature,
      smsDnc: formData.get("smsDnc") === "on",
      stage,
      status,
    },
  };
}

/** Creates a contact, returns a small form state, and refreshes the server-rendered directory on success. */
export async function createContactAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const parsed = contactInput(formData);

  if ("message" in parsed) return { message: parsed.message, status: "error" };

  const result = await createWorkspaceContact(parsed.input);

  if (result.type === "error") return { message: result.message ?? "The contact could not be created.", status: "error" };

  revalidatePath("/contacts");
  return { message: "Contact created.", status: "success" };
}

/** Edits a contact only after validating the browser-provided id and reauthorizing in the data layer. */
export async function updateContactAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = String(formData.get("contactId") ?? "").trim();
  const parsed = contactInput(formData);

  if (!uuidPattern.test(contactId)) return { message: "This contact reference is invalid. Refresh the directory and try again.", status: "error" };
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  const result = await updateWorkspaceContact(contactId, parsed.input);

  if (result.type === "error") return { message: result.message ?? "The contact could not be saved.", status: "error" };

  revalidatePath("/contacts");
  return { message: "Contact saved.", status: "success" };
}
