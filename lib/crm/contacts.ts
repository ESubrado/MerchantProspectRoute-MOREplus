import { isWorkspaceManagerRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const CONTACTS_PAGE_SIZE = 25;

export const contactFilters = ["all", "with_email", "without_email", "unassigned"] as const;

export type ContactFilter = typeof contactFilters[number];

export type ContactListItem = {
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  fullName: string;
  id: string;
  isAssigned: boolean;
  primaryEmail: string | null;
  updatedAt: string;
};

export type CompanyOption = {
  id: string;
  name: string;
};

export type ContactWriteInput = {
  companyId: string | null;
  fullName: string;
  primaryEmail: string | null;
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
    companyId: typeof row.company_id === "string" ? row.company_id : null,
    companyName: typeof row.company_name === "string" ? row.company_name : null,
    createdAt,
    fullName,
    id,
    isAssigned: row.is_assigned === true,
    primaryEmail: typeof row.primary_email === "string" ? row.primary_email : null,
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
    p_company_id: input.companyId,
    p_full_name: input.fullName,
    p_primary_email: input.primaryEmail,
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
  const { error } = await supabase.rpc("crm_update_contact", {
    p_company_id: input.companyId,
    p_contact_id: contactId,
    p_full_name: input.fullName,
    p_primary_email: input.primaryEmail,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? { message: saveErrorMessage(error.code), type: "error" } : { type: "success" };
}

/** Maps expected database command failures to errors that help an operator correct the form. */
function saveErrorMessage(code: string | undefined) {
  if (code === "22023") return "Check the contact name and primary email, then save again.";
  if (code === "23503") return "Choose a company that belongs to this workspace.";
  if (code === "P0002") return "This contact is no longer available. Refresh the directory and try again.";
  if (code === "42501") return "Your workspace permissions changed. Sign in again and try once more.";

  return "The contact could not be saved. Try again shortly.";
}
