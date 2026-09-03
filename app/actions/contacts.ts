"use server";

import { revalidatePath } from "next/cache";

import {
  addContactEmail,
  addContactPhone,
  addContactSocialProfile,
  createWorkspaceContact,
  getContactDetail,
  getWorkspaceMembers,
  removeContactEmail,
  removeContactPhone,
  removeContactSocialProfile,
  setContactAssignment,
  setContactFollowing,
  setContactReplyState,
  type ContactWriteInput,
  updateWorkspaceContact,
} from "@/lib/crm/contacts";

export type ContactActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+[1-9][0-9]{1,14}$/;
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

function contactIdFromForm(formData: FormData): string | null {
  const contactId = String(formData.get("contactId") ?? "").trim();
  return uuidPattern.test(contactId) ? contactId : null;
}

function methodIdFromForm(formData: FormData): string | null {
  const methodId = String(formData.get("methodId") ?? "").trim();
  return uuidPattern.test(methodId) ? methodId : null;
}

function commandFailure(message: string): ContactActionState {
  return { message, status: "error" };
}

function revalidateContactRoutes() {
  revalidatePath("/contacts");
  revalidatePath("/companies");
}

/** Reauthorizes and returns the client drawer's narrow detail DTO. */
export async function getContactDetailAction(contactId: string) {
  if (!uuidPattern.test(contactId)) return { message: "This contact reference is invalid.", type: "error" as const };
  return getContactDetail(contactId);
}

/** Returns database-authorized, active membership identities for the assignee picker. */
export async function getWorkspaceMembersAction() {
  return getWorkspaceMembers();
}

export async function addContactEmailAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const label = String(formData.get("label") ?? "work").trim();
  if (!contactId) return commandFailure("This contact reference is invalid. Refresh and try again.");
  if (!emailPattern.test(email) || email.length > 320) return commandFailure("Enter a valid email address.");
  if (!label || label.length > 40) return commandFailure("Email label must contain between 1 and 40 characters.");
  const result = await addContactEmail(contactId, { email, isPrimary: formData.get("isPrimary") === "on", label });
  if (result.type === "error") return commandFailure(result.message ?? "The email could not be added.");
  revalidateContactRoutes();
  return { message: "Email saved.", status: "success" };
}

export async function removeContactEmailAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const methodId = methodIdFromForm(formData);
  if (!contactId || !methodId) return commandFailure("This email reference is invalid. Refresh and try again.");
  const result = await removeContactEmail(contactId, methodId);
  if (result.type === "error") return commandFailure(result.message ?? "The email could not be removed.");
  revalidateContactRoutes();
  return { message: "Email removed.", status: "success" };
}

export async function addContactPhoneAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim();
  const label = String(formData.get("label") ?? "work").trim();
  if (!contactId) return commandFailure("This contact reference is invalid. Refresh and try again.");
  if (!phonePattern.test(phoneNumber)) return commandFailure("Enter an E.164 phone number, for example +14155552671.");
  if (!label || label.length > 40) return commandFailure("Phone label must contain between 1 and 40 characters.");
  const result = await addContactPhone(contactId, { isPrimary: formData.get("isPrimary") === "on", label, phoneNumber });
  if (result.type === "error") return commandFailure(result.message ?? "The phone number could not be added.");
  revalidateContactRoutes();
  return { message: "Phone number saved.", status: "success" };
}

export async function removeContactPhoneAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const methodId = methodIdFromForm(formData);
  if (!contactId || !methodId) return commandFailure("This phone reference is invalid. Refresh and try again.");
  const result = await removeContactPhone(contactId, methodId);
  if (result.type === "error") return commandFailure(result.message ?? "The phone number could not be removed.");
  revalidateContactRoutes();
  return { message: "Phone number removed.", status: "success" };
}

export async function addContactSocialProfileAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const platform = String(formData.get("platform") ?? "").trim();
  const profileUrl = String(formData.get("profileUrl") ?? "").trim();
  if (!contactId) return commandFailure("This contact reference is invalid. Refresh and try again.");
  if (!platform || platform.length > 40) return commandFailure("Social platform must contain between 1 and 40 characters.");
  if (!/^https?:\/\/[^\s]+$/i.test(profileUrl) || profileUrl.length > 500) return commandFailure("Enter a valid http or https social profile URL.");
  const result = await addContactSocialProfile(contactId, { platform, profileUrl });
  if (result.type === "error") return commandFailure(result.message ?? "The social profile could not be added.");
  revalidateContactRoutes();
  return { message: "Social profile saved.", status: "success" };
}

export async function removeContactSocialProfileAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const methodId = methodIdFromForm(formData);
  if (!contactId || !methodId) return commandFailure("This social profile reference is invalid. Refresh and try again.");
  const result = await removeContactSocialProfile(contactId, methodId);
  if (result.type === "error") return commandFailure(result.message ?? "The social profile could not be removed.");
  revalidateContactRoutes();
  return { message: "Social profile removed.", status: "success" };
}

export async function setContactAssignmentAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const rawAssigneeUserId = String(formData.get("assigneeUserId") ?? "").trim();
  if (!contactId) return commandFailure("This contact reference is invalid. Refresh and try again.");
  if (rawAssigneeUserId && !uuidPattern.test(rawAssigneeUserId)) return commandFailure("Choose an active workspace member.");
  const result = await setContactAssignment(contactId, rawAssigneeUserId || null);
  if (result.type === "error") return commandFailure(result.message ?? "The assignment could not be saved.");
  revalidateContactRoutes();
  return { message: "Assignment saved.", status: "success" };
}

export async function setContactReplyStateAction(_previousState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = contactIdFromForm(formData);
  const rawReplyTemperature = String(formData.get("replyTemperature") ?? "").trim();
  const replyTemperature = rawReplyTemperature === "" ? null : Number(rawReplyTemperature);
  if (!contactId) return commandFailure("This contact reference is invalid. Refresh and try again.");
  if (rawReplyTemperature && (replyTemperature === null || !Number.isInteger(replyTemperature) || replyTemperature < 0 || replyTemperature > 4)) return commandFailure("Choose a valid reply classification.");
  const result = await setContactReplyState(contactId, { emailDnc: formData.get("emailDnc") === "on", replyTemperature });
  if (result.type === "error") return commandFailure(result.message ?? "The reply state could not be saved.");
  revalidateContactRoutes();
  return { message: "Reply and email DNC state saved.", status: "success" };
}

export async function setContactFollowingAction(contactId: string, follow: boolean): Promise<ContactActionState> {
  if (!uuidPattern.test(contactId)) return commandFailure("This contact reference is invalid. Refresh and try again.");
  const result = await setContactFollowing(contactId, follow);
  if (result.type === "error") return commandFailure(result.message ?? "Following could not be updated.");
  revalidateContactRoutes();
  return { message: follow ? "Following this contact." : "Stopped following this contact.", status: "success" };
}
