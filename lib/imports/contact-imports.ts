import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isWorkspaceManagerRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceAccess } from "@/lib/auth/session";
import {
  CONTACT_IMPORT_ALLOWED_CONTENT_TYPES,
  CONTACT_IMPORT_BUCKET,
  CONTACT_IMPORT_MAPPING_FIELDS,
  CONTACT_IMPORT_MAX_FILE_BYTES,
  CONTACT_IMPORTS_COMING_SOON_MESSAGE,
  type ContactImportMappingField,
  type ContactImportStatus,
} from "@/lib/imports/contract";
import { getSupabaseConfiguration } from "@/lib/supabase/config";

export {
  CONTACT_IMPORT_ALLOWED_CONTENT_TYPES,
  CONTACT_IMPORT_BUCKET,
  CONTACT_IMPORT_MAPPING_FIELDS,
  CONTACT_IMPORT_MAX_FILE_BYTES,
  CONTACT_IMPORTS_COMING_SOON_MESSAGE,
};
export type { ContactImportMappingField, ContactImportStatus };

export type ContactImportRequest = {
  fileName: string;
  fileSizeBytes: number;
  mapping: ContactImportMappingField[];
  contentType: string;
};

export type ContactImportUpload = {
  jobId: string;
  path: string;
  token: string;
};

export type ContactImportRowError = {
  code: string;
  message: string;
  rowNumber: number;
  severity: "error" | "warning";
};

export type ContactImportSnapshot = {
  attemptCount: number;
  companiesCreated: number;
  completedAt: string | null;
  createdAt: string;
  fileName: string;
  id: string;
  importedRows: number;
  phonesSkipped: number;
  processedRows: number;
  rowErrors: ContactImportRowError[];
  skippedDuplicateRows: number;
  skippedInvalidRows: number;
  status: ContactImportStatus;
  terminalError: string | null;
  totalRows: number | null;
  updatedAt: string;
};

type ImportResult<T> = { type: "success"; value: T } | { message: string; type: "error" };
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

function isMappingField(value: unknown): value is ContactImportMappingField {
  return typeof value === "string" && (CONTACT_IMPORT_MAPPING_FIELDS as readonly string[]).includes(value);
}

function validateImportRequest(input: ContactImportRequest): string | null {
  const fileName = input.fileName.trim();
  const contentType = input.contentType.trim().toLowerCase();
  const mapped = input.mapping.filter((field) => field !== "ignore");

  if (!fileName || fileName.length > 255 || /[\\/]/.test(fileName)) return "Choose a CSV file with a simple file name.";
  if (!CONTACT_IMPORT_ALLOWED_CONTENT_TYPES.includes(contentType as typeof CONTACT_IMPORT_ALLOWED_CONTENT_TYPES[number])) return "Only CSV files are accepted.";
  if (!Number.isSafeInteger(input.fileSizeBytes) || input.fileSizeBytes < 1 || input.fileSizeBytes > CONTACT_IMPORT_MAX_FILE_BYTES) return "CSV files must be between 1 byte and 10 MiB.";
  if (input.mapping.length < 1 || input.mapping.length > 100 || !input.mapping.every(isMappingField)) return "Check the CSV column mapping and try again.";
  if (new Set(mapped).size !== mapped.length) return "Each contact field can be mapped to only one CSV column.";
  if (!mapped.some((field) => field === "email" || field === "full_name" || field === "first_name" || field === "last_name")) return "Map an email or name column before importing.";
  return null;
}

function snapshotFromRow(value: unknown): ContactImportSnapshot | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const fileName = stringValue(row?.source_file_name);
  const status = stringValue(row?.status);
  const createdAt = stringValue(row?.created_at);
  const updatedAt = stringValue(row?.updated_at);

  if (!row || !id || !fileName || !createdAt || !updatedAt || !["awaiting_upload", "processing", "done", "failed"].includes(status ?? "")) return null;

  const rowErrors = Array.isArray(row.row_errors)
    ? row.row_errors.flatMap((value) => {
      const error = record(value);
      const rowNumber = numberValue(error?.row_number);
      const severity = stringValue(error?.severity);
      const code = stringValue(error?.code);
      const message = stringValue(error?.message);
      return rowNumber && (severity === "error" || severity === "warning") && code && message ? [{ code, message, rowNumber, severity: severity as "error" | "warning" }] : [];
    })
    : [];

  return {
    attemptCount: numberValue(row.attempt_count) ?? 0,
    companiesCreated: numberValue(row.companies_created) ?? 0,
    completedAt: stringValue(row.completed_at),
    createdAt,
    fileName,
    id,
    importedRows: numberValue(row.imported_rows) ?? 0,
    phonesSkipped: numberValue(row.phones_skipped) ?? 0,
    processedRows: numberValue(row.processed_rows) ?? 0,
    rowErrors,
    skippedDuplicateRows: numberValue(row.skipped_duplicate_rows) ?? 0,
    skippedInvalidRows: numberValue(row.skipped_invalid_rows) ?? 0,
    status: status as ContactImportStatus,
    terminalError: stringValue(row.terminal_error),
    totalRows: numberValue(row.total_rows),
    updatedAt,
  };
}

function importError(code: string | undefined) {
  if (code === "22023") return "Check the CSV file details and column mapping, then try again.";
  if (code === "23505") return "This workspace already has an active import job.";
  if (code === "42501") return "Only workspace owners and admins can manage imports.";
  if (code === "55000") return CONTACT_IMPORTS_COMING_SOON_MESSAGE;
  if (code === "P0002") return "This import is no longer available. Refresh and try again.";
  return "The import could not be prepared right now. Try again shortly.";
}

/** Prepares an owned private-storage upload only after server and database authorization succeeds. */
export async function createContactImportUpload(input: ContactImportRequest): Promise<ImportResult<ContactImportUpload>> {
  const validationMessage = validateImportRequest(input);
  if (validationMessage) return { message: validationMessage, type: "error" };

  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can manage imports.", type: "error" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_create_contact_import_job", {
    p_mapping: input.mapping,
    p_source_content_type: input.contentType.trim().toLowerCase(),
    p_source_file_name: input.fileName.trim(),
    p_source_file_size_bytes: input.fileSizeBytes,
    p_workspace_id: workspaceAccess.workspaceId,
  });
  const created = record(data?.[0]);
  const jobId = stringValue(created?.job_id);
  const path = stringValue(created?.storage_path);
  if (error || !jobId || !path) return { message: importError(error?.code), type: "error" };

  try {
    const service = createServiceClient();
    const { data: upload, error: uploadError } = await service.storage.from(CONTACT_IMPORT_BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (uploadError || !upload?.token) {
      await supabase.rpc("crm_cancel_contact_import_job", {
        p_job_id: jobId,
        p_reason: "Private upload authorization could not be created.",
        p_workspace_id: workspaceAccess.workspaceId,
      });
      return { message: "Private upload could not be authorized. Try again shortly.", type: "error" };
    }
    return { type: "success", value: { jobId, path, token: upload.token } };
  } catch {
    await supabase.rpc("crm_cancel_contact_import_job", {
      p_job_id: jobId,
      p_reason: "Private upload storage is not configured.",
      p_workspace_id: workspaceAccess.workspaceId,
    });
    return { message: "Private upload storage is not configured yet.", type: "error" };
  }
}

/** Returns a tenant-authorized, bounded progress snapshot for a browser polling an import job. */
export async function getContactImportJob(jobId: string): Promise<ImportResult<ContactImportSnapshot>> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_get_contact_import_job", { p_job_id: jobId, p_workspace_id: workspaceAccess.workspaceId });
  const snapshot = snapshotFromRow(data?.[0]);
  if (error || !snapshot) return { message: importError(error?.code), type: "error" };
  return { type: "success", value: snapshot };
}

/** Requests a retry for a retained terminal job; the worker, not the browser, performs the retry. */
export async function retryContactImportJob(jobId: string): Promise<ImportResult<null>> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) return { message: "Only workspace owners and admins can manage imports.", type: "error" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_retry_contact_import_job", { p_job_id: jobId, p_workspace_id: workspaceAccess.workspaceId });
  return error ? { message: importError(error.code), type: "error" } : { type: "success", value: null };
}
