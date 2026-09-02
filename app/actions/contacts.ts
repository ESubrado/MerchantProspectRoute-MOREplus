"use server";

import { revalidatePath } from "next/cache";

import { createWorkspaceContact, type ContactWriteInput, updateWorkspaceContact } from "@/lib/crm/contacts";

export type ContactActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the only editable Phase 2 contact fields before the data layer calls an atomic database command. */
function contactInput(formData: FormData): { input: ContactWriteInput } | { message: string } {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const rawCompanyId = String(formData.get("companyId") ?? "").trim();
  const rawPrimaryEmail = String(formData.get("primaryEmail") ?? "").trim().toLowerCase();

  if (!fullName) return { message: "Enter a contact name." };
  if (fullName.length > 200) return { message: "Contact names must be 200 characters or fewer." };
  if (rawCompanyId && !uuidPattern.test(rawCompanyId)) return { message: "Choose a company from this workspace." };
  if (rawPrimaryEmail && (!emailPattern.test(rawPrimaryEmail) || rawPrimaryEmail.length > 320)) {
    return { message: "Enter a valid primary email address or leave it blank." };
  }

  return {
    input: {
      companyId: rawCompanyId || null,
      fullName,
      primaryEmail: rawPrimaryEmail || null,
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
