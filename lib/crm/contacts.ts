import { isWorkspaceManagerRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const CONTACTS_PAGE_SIZE = 25;

export const contactFilters = ["all", "with_email", "without_email", "unassigned"] as const;

export type ContactFilter = typeof contactFilters[number];

export type ContactListItem = {
  callDnc: boolean;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  createdBy: string | null;
  emailDnc: boolean;
  firstName: string | null;
  fullName: string;
  id: string;
  isAssigned: boolean;
  primaryEmail: string | null;
  replyTemperature: number | null;
  smsDnc: boolean;
  stage: string;
  status: string;
  lastName: string | null;
  updatedAt: string;
};

export type CompanyOption = {
  id: string;
  name: string;
};

export type ContactWriteInput = {
  callDnc: boolean;
  companyId: string | null;
  emailDnc: boolean;
  firstName: string | null;
  lastName: string | null;
  primaryEmail: string | null;
  replyTemperature: number | null;
  smsDnc: boolean;
  stage: string;
  status: string;
};

export type ContactEmailMethod = {
  doNotContact: boolean;
  email: string;
  id: string;
  isPrimary: boolean;
  label: string;
};

export type ContactPhoneMethod = {
  id: string;
  isPrimary: boolean;
  label: string;
  phoneNumber: string;
};

export type ContactSocialProfile = {
  id: string;
  platform: string;
  profileUrl: string;
};

export type ContactDetail = {
  assigneeUserId: string | null;
  companyId: string | null;
  companyName: string | null;
  emailDnc: boolean;
  emailMethods: ContactEmailMethod[];
  firstName: string | null;
  followerUserIds: string[];
  fullName: string;
  id: string;
  isFollowing: boolean;
  lastName: string | null;
  phoneMethods: ContactPhoneMethod[];
  primaryEmail: string | null;
  replyTemperature: number | null;
  socialProfiles: ContactSocialProfile[];
  updatedAt: string;
};

export type WorkspaceMemberOption = {
  role: WorkspaceRole;
  userId: string;
};

export type ContactsPageResult =
  | {
    canManageContacts: boolean;
    companies: CompanyOption[];
    contacts: ContactListItem[];
    page: number;
    total: number;
    type: "success";
    workspaceRole: WorkspaceRole;
  }
  | { message: string; type: "error" };

type RecordValue = Record<string, unknown>;

/** Keeps the RPC boundary defensive because this project intentionally has no generated database types. */
function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

/** Converts a selected RPC row into the small DTO the client Contacts screen needs. */
function contactFromRow(value: unknown): ContactListItem | null {
  const row = record(value);
  const id = typeof row?.id === "string" ? row.id : null;
  const fullName = typeof row?.full_name === "string" ? row.full_name : null;
  const createdAt = typeof row?.created_at === "string" ? row.created_at : null;
  const updatedAt = typeof row?.updated_at === "string" ? row.updated_at : null;

  if (!row || !id || !fullName || !createdAt || !updatedAt) {
    return null;
  }

  return {
    callDnc: row.call_dnc === true,
    companyId: typeof row.company_id === "string" ? row.company_id : null,
    companyName: typeof row.company_name === "string" ? row.company_name : null,
    createdAt,
    createdBy: typeof row.created_by === "string" ? row.created_by : null,
    emailDnc: row.email_dnc === true,
    firstName: typeof row.first_name === "string" ? row.first_name : null,
    fullName,
    id,
    isAssigned: row.is_assigned === true,
    primaryEmail: typeof row.primary_email === "string" ? row.primary_email : null,
    replyTemperature: typeof row.reply_temperature === "number" ? row.reply_temperature : null,
    smsDnc: row.sms_dnc === true,
    stage: typeof row.stage === "string" ? row.stage : "new",
    status: typeof row.status === "string" ? row.status : "active",
    lastName: typeof row.last_name === "string" ? row.last_name : null,
    updatedAt,
  };
}

function objectList(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => item !== null) : [];
}

function contactDetailFromRow(value: unknown): ContactDetail | null {
  const row = record(value);
  const id = typeof row?.id === "string" ? row.id : null;
  const fullName = typeof row?.full_name === "string" ? row.full_name : null;
  const updatedAt = typeof row?.updated_at === "string" ? row.updated_at : null;
  if (!row || !id || !fullName || !updatedAt) return null;

  const emailMethods = objectList(row.email_methods).flatMap((method) => {
    const methodId = typeof method.id === "string" ? method.id : null;
    const email = typeof method.email === "string" ? method.email : null;
    const label = typeof method.label === "string" ? method.label : null;
    return methodId && email && label ? [{ doNotContact: method.do_not_contact === true, email, id: methodId, isPrimary: method.is_primary === true, label }] : [];
  });
  const phoneMethods = objectList(row.phone_methods).flatMap((method) => {
    const methodId = typeof method.id === "string" ? method.id : null;
    const phoneNumber = typeof method.phone_number === "string" ? method.phone_number : null;
    const label = typeof method.label === "string" ? method.label : null;
    return methodId && phoneNumber && label ? [{ id: methodId, isPrimary: method.is_primary === true, label, phoneNumber }] : [];
  });
  const socialProfiles = objectList(row.social_profiles).flatMap((profile) => {
    const profileId = typeof profile.id === "string" ? profile.id : null;
    const platform = typeof profile.platform === "string" ? profile.platform : null;
    const profileUrl = typeof profile.profile_url === "string" ? profile.profile_url : null;
    return profileId && platform && profileUrl ? [{ id: profileId, platform, profileUrl }] : [];
  });
  const followerUserIds = Array.isArray(row.follower_user_ids) ? row.follower_user_ids.filter((userId): userId is string => typeof userId === "string") : [];

  return {
    assigneeUserId: typeof row.assignee_user_id === "string" ? row.assignee_user_id : null,
    companyId: typeof row.company_id === "string" ? row.company_id : null,
    companyName: typeof row.company_name === "string" ? row.company_name : null,
    emailDnc: row.email_dnc === true,
    emailMethods,
    firstName: typeof row.first_name === "string" ? row.first_name : null,
    followerUserIds,
    fullName,
    id,
    isFollowing: row.is_following === true,
    lastName: typeof row.last_name === "string" ? row.last_name : null,
    phoneMethods,
    primaryEmail: typeof row.primary_email === "string" ? row.primary_email : null,
    replyTemperature: typeof row.reply_temperature === "number" ? row.reply_temperature : null,
    socialProfiles,
    updatedAt,
  };
}

/** Limits list-search parameters before they reach the tenant-scoped database command. */
function normalizeListInput(input: { filter?: string; page?: number; search?: string }) {
  const filter = contactFilters.includes(input.filter as ContactFilter) ? input.filter as ContactFilter : "all";
  const page = Number.isInteger(input.page) && (input.page ?? 0) > 0 ? input.page as number : 1;
  const search = (input.search ?? "").trim().slice(0, 120);

  return { filter, page, search };
}

/** Reads the Contacts directory and its company choices through the signed-in user's workspace session. */
export async function getContactsPage(input: { filter?: string; page?: number; search?: string }): Promise<ContactsPageResult> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();

  if (!workspaceAccess || !getSupabaseConfiguration()) {
    return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };
  }

  const { filter, page, search } = normalizeListInput(input);
  const supabase = await createClient();
  const offset = (page - 1) * CONTACTS_PAGE_SIZE;

  // Both requests include workspace_id; the RPC repeats the membership check before it reads any contact data.
  const [contactsResult, companiesResult] = await Promise.all([
    supabase.rpc("crm_search_contacts", {
      p_filter: filter,
      p_limit: CONTACTS_PAGE_SIZE,
      p_offset: offset,
      p_search: search,
      p_workspace_id: workspaceAccess.workspaceId,
    }),
    supabase
      .from("companies")
      .select("id, name")
      .eq("workspace_id", workspaceAccess.workspaceId)
      .order("name", { ascending: true })
      .limit(250),
  ]);

  if (contactsResult.error || companiesResult.error) {
    return { message: "Contacts could not be loaded right now. Refresh the page or try again shortly.", type: "error" };
  }

  const contacts = (contactsResult.data ?? []).map(contactFromRow).filter((contact: ContactListItem | null): contact is ContactListItem => contact !== null);
  const companies = (companiesResult.data ?? []).flatMap((company) => {
    const row = record(company);
    return typeof row?.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name }] : [];
  });
  const total = contacts.length === 0 ? 0 : Number(record(contactsResult.data?.[0])?.total_count ?? 0);

  return {
    canManageContacts: isWorkspaceManagerRole(workspaceAccess.role),
    companies,
    contacts,
    page,
    total: Number.isFinite(total) ? total : 0,
    type: "success",
    workspaceRole: workspaceAccess.role,
  };
}

/** Creates a contact only after rechecking the signed-in user's owner or admin membership on the server. */
export async function createWorkspaceContact(input: ContactWriteInput): Promise<{ message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();

  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can create contacts.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_create_contact", {
    p_call_dnc: input.callDnc,
    p_company_id: input.companyId,
    p_email_dnc: input.emailDnc,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_primary_email: input.primaryEmail,
    p_reply_temperature: input.replyTemperature,
    p_sms_dnc: input.smsDnc,
    p_stage: input.stage,
    p_status: input.status,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? { message: saveErrorMessage(error.code), type: "error" } : { type: "success" };
}

/** Updates one contact only after rechecking owner or admin membership and forwarding the current tenant identifier. */
export async function updateWorkspaceContact(contactId: string, input: ContactWriteInput): Promise<{ message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();

  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can edit contacts.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_update_contact_profile", {
    p_company_id: input.companyId,
    p_contact_id: contactId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_primary_email: input.primaryEmail,
    p_stage: input.stage,
    p_status: input.status,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? { message: saveErrorMessage(error.code), type: "error" } : { type: "success" };
}

/** Reads a complete contact record, including tenant-local methods and ownership relationships. */
export async function getContactDetail(contactId: string): Promise<{ detail?: ContactDetail; message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_get_contact_detail", { p_contact_id: contactId, p_workspace_id: workspaceAccess.workspaceId });
  const detail = contactDetailFromRow(data?.[0]);
  if (error || !detail) return { message: "This contact is no longer available. Refresh the directory and try again.", type: "error" };
  return { detail, type: "success" };
}

/** Lists active membership identities only after the database independently checks the caller's workspace access. */
export async function getWorkspaceMembers(): Promise<{ members?: WorkspaceMemberOption[]; message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_list_workspace_members", { p_workspace_id: workspaceAccess.workspaceId });
  if (error) return { message: "Workspace members could not be loaded right now.", type: "error" };

  const members = (data ?? []).flatMap((value: unknown) => {
    const row = record(value);
    const userId = typeof row?.user_id === "string" ? row.user_id : null;
    const role = row?.role;
    return userId && (role === "owner" || role === "admin" || role === "member") ? [{ role, userId }] : [];
  });
  return { members, type: "success" };
}

type ContactCommandResult = { message?: string; type: "success" | "error" };

async function managerContactCommand(rpc: "crm_add_contact_email" | "crm_remove_contact_email" | "crm_add_contact_phone" | "crm_remove_contact_phone" | "crm_add_contact_social_profile" | "crm_remove_contact_social_profile" | "crm_set_contact_assignment" | "crm_set_contact_reply_state", args: Record<string, unknown>): Promise<ContactCommandResult> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) return { message: "Only workspace owners and admins can change this contact.", type: "error" };

  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, { ...args, p_workspace_id: workspaceAccess.workspaceId });
  return error ? { message: contactCommandError(error.code), type: "error" } : { type: "success" };
}

export function addContactEmail(contactId: string, input: { email: string; isPrimary: boolean; label: string }) {
  return managerContactCommand("crm_add_contact_email", { p_contact_id: contactId, p_email: input.email, p_is_primary: input.isPrimary, p_label: input.label });
}

export function removeContactEmail(contactId: string, methodId: string) {
  return managerContactCommand("crm_remove_contact_email", { p_contact_id: contactId, p_method_id: methodId });
}

export function addContactPhone(contactId: string, input: { isPrimary: boolean; label: string; phoneNumber: string }) {
  return managerContactCommand("crm_add_contact_phone", { p_contact_id: contactId, p_is_primary: input.isPrimary, p_label: input.label, p_phone_number: input.phoneNumber });
}

export function removeContactPhone(contactId: string, methodId: string) {
  return managerContactCommand("crm_remove_contact_phone", { p_contact_id: contactId, p_method_id: methodId });
}

export function addContactSocialProfile(contactId: string, input: { platform: string; profileUrl: string }) {
  return managerContactCommand("crm_add_contact_social_profile", { p_contact_id: contactId, p_platform: input.platform, p_profile_url: input.profileUrl });
}

export function removeContactSocialProfile(contactId: string, methodId: string) {
  return managerContactCommand("crm_remove_contact_social_profile", { p_contact_id: contactId, p_method_id: methodId });
}

export function setContactAssignment(contactId: string, assigneeUserId: string | null) {
  return managerContactCommand("crm_set_contact_assignment", { p_assigned_to_user_id: assigneeUserId, p_contact_id: contactId });
}

export function setContactReplyState(contactId: string, input: { emailDnc: boolean; replyTemperature: number | null }) {
  return managerContactCommand("crm_set_contact_reply_state", { p_contact_id: contactId, p_email_dnc: input.emailDnc, p_reply_temperature: input.replyTemperature });
}

/** Members may follow or unfollow only themselves; the database command binds the relationship to auth.uid(). */
export async function setContactFollowing(contactId: string, follow: boolean): Promise<ContactCommandResult> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_set_contact_following", { p_contact_id: contactId, p_follow: follow, p_workspace_id: workspaceAccess.workspaceId });
  return error ? { message: contactCommandError(error.code), type: "error" } : { type: "success" };
}

/** Maps expected database command failures to errors that help an operator correct the form. */
function saveErrorMessage(code: string | undefined) {
  if (code === "22023") return "Check the contact details and lifecycle fields, then save again.";
  if (code === "23503") return "Choose a company that belongs to this workspace.";
  if (code === "P0002") return "This contact is no longer available. Refresh the directory and try again.";
  if (code === "42501") return "Your workspace permissions changed. Sign in again and try once more.";

  return "The contact could not be saved. Try again shortly.";
}

function contactCommandError(code: string | undefined) {
  if (code === "22023") return "Check the contact method or reply state, then try again.";
  if (code === "23503") return "Choose an active workspace member for this assignment.";
  if (code === "23505") return "This contact method is already recorded.";
  if (code === "P0002") return "This contact or method is no longer available. Refresh and try again.";
  if (code === "42501") return "Your workspace permissions changed. Sign in again and try once more.";
  return "The contact change could not be saved. Try again shortly.";
}
