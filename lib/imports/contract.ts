/** Shared, browser-safe import contract. Server-only access and worker credentials remain outside this module. */
export const CONTACT_IMPORT_BUCKET = "contact-imports";
export const CONTACT_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CONTACT_IMPORT_ALLOWED_CONTENT_TYPES = ["text/csv", "application/csv", "application/vnd.ms-excel"] as const;
export const CONTACT_IMPORT_MAPPING_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "company",
  "company_website",
  "linkedin",
  "ignore",
] as const;
export const CONTACT_IMPORTS_COMING_SOON_MESSAGE = "Imports are coming soon. CSV uploads will be enabled after the private import worker is deployed for this workspace.";

export type ContactImportMappingField = typeof CONTACT_IMPORT_MAPPING_FIELDS[number];
export type ContactImportStatus = "awaiting_upload" | "processing" | "done" | "failed";
