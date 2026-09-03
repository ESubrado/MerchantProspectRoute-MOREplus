import { isWorkspaceManagerRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const COMPANIES_PAGE_SIZE = 25;

export type CompanyListItem = {
  address: string | null;
  contactCount: number;
  createdAt: string;
  id: string;
  legalName: string | null;
  name: string;
  phoneNumber: string | null;
  updatedAt: string;
  websiteDomain: string | null;
  websiteUrl: string | null;
};

export type CompanyContact = {
  emailDnc: boolean;
  fullName: string;
  id: string;
  primaryEmail: string | null;
  updatedAt: string;
};

export type CompanyDetail = Omit<CompanyListItem, "contactCount"> & {
  linkedContacts: CompanyContact[];
};

export type CompanyWriteInput = {
  address: string | null;
  legalName: string | null;
  name: string;
  phoneNumber: string | null;
  websiteUrl: string | null;
};

export type CompaniesPageResult =
  | {
    canManageCompanies: boolean;
    companies: CompanyListItem[];
    page: number;
    total: number;
    type: "success";
    workspaceRole: WorkspaceRole;
  }
  | { message: string; type: "error" };

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function companyFromRow(value: unknown): CompanyListItem | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const name = stringValue(row?.name);
  const createdAt = stringValue(row?.created_at);
  const updatedAt = stringValue(row?.updated_at);

  if (!row || !id || !name || !createdAt || !updatedAt) return null;

  return {
    address: stringValue(row.address),
    contactCount: numberValue(row.contact_count) ?? 0,
    createdAt,
    id,
    legalName: stringValue(row.legal_name),
    name,
    phoneNumber: stringValue(row.phone_number),
    updatedAt,
    websiteDomain: stringValue(row.website_domain),
    websiteUrl: stringValue(row.website_url),
  };
}

function companyContactFromRow(value: unknown): CompanyContact | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const fullName = stringValue(row?.full_name);
  const updatedAt = stringValue(row?.updated_at);

  if (!row || !id || !fullName || !updatedAt) return null;

  return {
    emailDnc: row.email_dnc === true,
    fullName,
    id,
    primaryEmail: stringValue(row.primary_email),
    updatedAt,
  };
}

function companyDetailFromRow(value: unknown): CompanyDetail | null {
  const company = companyFromRow(value);
  const row = record(value);
  const linkedContacts = Array.isArray(row?.linked_contacts)
    ? row.linked_contacts.map(companyContactFromRow).filter((contact): contact is CompanyContact => contact !== null)
    : [];

  return company ? { ...company, linkedContacts } : null;
}

function normalizeListInput(input: { page?: number; search?: string }) {
  const page = Number.isInteger(input.page) && (input.page ?? 0) > 0 ? input.page as number : 1;
  return { page, search: (input.search ?? "").trim().slice(0, 120) };
}

/** Loads a paginated company directory using an RPC that independently checks active membership. */
export async function getCompaniesPage(input: { page?: number; search?: string }): Promise<CompaniesPageResult> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) {
    return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };
  }

  const { page, search } = normalizeListInput(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_search_companies", {
    p_limit: COMPANIES_PAGE_SIZE,
    p_offset: (page - 1) * COMPANIES_PAGE_SIZE,
    p_search: search,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  if (error) return { message: "Companies could not be loaded right now. Refresh the page or try again shortly.", type: "error" };

  const companies = (data ?? []).map((value: unknown) => companyFromRow(value)).filter((company: CompanyListItem | null): company is CompanyListItem => company !== null);
  const total = companies.length === 0 ? 0 : numberValue(record(data?.[0])?.total_count) ?? 0;

  return {
    canManageCompanies: isWorkspaceManagerRole(workspaceAccess.role),
    companies,
    page,
    total,
    type: "success",
    workspaceRole: workspaceAccess.role,
  };
}

/** Reads one company and its linked contacts after reauthorizing the active workspace. */
export async function getCompanyDetail(companyId: string): Promise<{ detail?: CompanyDetail; message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) {
    return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_get_company_detail", {
    p_company_id: companyId,
    p_workspace_id: workspaceAccess.workspaceId,
  });
  const detail = companyDetailFromRow(data?.[0]);

  if (error || !detail) return { message: "This company is no longer available. Refresh the directory and try again.", type: "error" };
  return { detail, type: "success" };
}

/** Creates a company only after the data layer and the database command both authorize a manager role. */
export async function createWorkspaceCompany(input: CompanyWriteInput): Promise<{ message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can create companies.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_create_company", {
    p_address: input.address,
    p_legal_name: input.legalName,
    p_name: input.name,
    p_phone_number: input.phoneNumber,
    p_website_url: input.websiteUrl,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? { message: companySaveError(error.code), type: "error" } : { type: "success" };
}

/** Updates one company using its opaque browser reference plus the data layer's current workspace authorization. */
export async function updateWorkspaceCompany(companyId: string, input: CompanyWriteInput): Promise<{ message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can edit companies.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_update_company", {
    p_address: input.address,
    p_company_id: companyId,
    p_legal_name: input.legalName,
    p_name: input.name,
    p_phone_number: input.phoneNumber,
    p_website_url: input.websiteUrl,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? { message: companySaveError(error.code), type: "error" } : { type: "success" };
}

function companySaveError(code: string | undefined) {
  if (code === "22023") return "Check the company name, website, phone, and address, then save again.";
  if (code === "23505") return "A company with that name already exists in this workspace.";
  if (code === "P0002") return "This company is no longer available. Refresh the directory and try again.";
  if (code === "42501") return "Your workspace permissions changed. Sign in again and try once more.";
  return "The company could not be saved. Try again shortly.";
}
