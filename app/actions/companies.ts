"use server";

import { revalidatePath } from "next/cache";

import { createWorkspaceCompany, getCompanyDetail, type CompanyWriteInput, updateWorkspaceCompany } from "@/lib/crm/companies";

export type CompanyActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const phonePattern = /^\+[1-9][0-9]{1,14}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function companyInput(formData: FormData): { input: CompanyWriteInput } | { message: string } {
  const name = String(formData.get("name") ?? "").trim();
  const legalName = String(formData.get("legalName") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  if (!name || name.length > 200) return { message: "Company name must contain between 1 and 200 characters." };
  if (legalName.length > 200) return { message: "Legal name must be 200 characters or fewer." };
  if (websiteUrl && !/^https?:\/\/[^/:?#]+/i.test(websiteUrl)) return { message: "Website must start with http:// or https:// and include a host." };
  if (phoneNumber && !phonePattern.test(phoneNumber)) return { message: "Company phone must use E.164 format, for example +14155552671." };
  if (address.length > 500) return { message: "Company address must be 500 characters or fewer." };

  return {
    input: {
      address: address || null,
      legalName: legalName || null,
      name,
      phoneNumber: phoneNumber || null,
      websiteUrl: websiteUrl || null,
    },
  };
}

export async function createCompanyAction(_previousState: CompanyActionState, formData: FormData): Promise<CompanyActionState> {
  const parsed = companyInput(formData);
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  const result = await createWorkspaceCompany(parsed.input);
  if (result.type === "error") return { message: result.message ?? "The company could not be created.", status: "error" };

  revalidatePath("/companies");
  return { message: "Company created.", status: "success" };
}

export async function updateCompanyAction(_previousState: CompanyActionState, formData: FormData): Promise<CompanyActionState> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  const parsed = companyInput(formData);

  if (!uuidPattern.test(companyId)) return { message: "This company reference is invalid. Refresh the directory and try again.", status: "error" };
  if ("message" in parsed) return { message: parsed.message, status: "error" };

  const result = await updateWorkspaceCompany(companyId, parsed.input);
  if (result.type === "error") return { message: result.message ?? "The company could not be saved.", status: "error" };

  revalidatePath("/companies");
  revalidatePath("/contacts");
  return { message: "Company saved.", status: "success" };
}

/** Reauthorizes and returns a narrow company detail DTO for the client-side drawer. */
export async function getCompanyDetailAction(companyId: string) {
  if (!uuidPattern.test(companyId)) return { message: "This company reference is invalid.", type: "error" as const };
  return getCompanyDetail(companyId);
}
