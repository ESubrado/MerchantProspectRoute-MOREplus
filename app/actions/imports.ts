"use server";

import { revalidatePath } from "next/cache";

import {
  createContactImportUpload,
  getContactImportJob,
  retryContactImportJob,
  type ContactImportMappingField,
  type ContactImportRequest,
} from "@/lib/imports/contact-imports";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function importRequest(value: unknown): ContactImportRequest {
  const input = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    contentType: typeof input.contentType === "string" ? input.contentType : "",
    fileName: typeof input.fileName === "string" ? input.fileName : "",
    fileSizeBytes: typeof input.fileSizeBytes === "number" ? input.fileSizeBytes : Number.NaN,
    mapping: Array.isArray(input.mapping) ? input.mapping.filter((field): field is ContactImportMappingField => typeof field === "string") : [],
  };
}

/** Returns an opaque signed-upload token; the browser uploads bytes but never processes or retries rows. */
export async function createContactImportUploadAction(input: unknown) {
  return createContactImportUpload(importRequest(input));
}

/** Provides a small progress projection suitable for polling from the eventual import dialog. */
export async function getContactImportJobAction(jobId: string) {
  if (!uuidPattern.test(jobId)) return { message: "This import reference is invalid.", type: "error" as const };
  return getContactImportJob(jobId);
}

/** Schedules a retained failed job for worker pickup; no browser retries or processes import data. */
export async function retryContactImportJobAction(jobId: string) {
  if (!uuidPattern.test(jobId)) return { message: "This import reference is invalid.", type: "error" as const };
  const result = await retryContactImportJob(jobId);
  if (result.type === "success") {
    revalidatePath("/contacts");
    return { message: "The import was queued for the worker.", type: "success" as const };
  }
  return result;
}
