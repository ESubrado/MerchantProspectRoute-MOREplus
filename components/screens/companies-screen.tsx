"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import Link from "next/link";

import { createCompanyAction, getCompanyDetailAction, type CompanyActionState, updateCompanyAction } from "@/app/actions/companies";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { FilterBar } from "@/components/domain/filter-bar";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { ScreenState } from "@/components/domain/screen-state";
import { StatusPill } from "@/components/domain/status-pill";
import { BuildingIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceRole } from "@/lib/auth/roles";
import type { CompanyDetail, CompanyListItem } from "@/lib/crm/companies";

type CompanyAction = (previousState: CompanyActionState, formData: FormData) => Promise<CompanyActionState>;
type DrawerState = { mode: "create" } | { company: CompanyListItem; mode: "view" } | null;

type CompaniesScreenProps = {
  canManageCompanies: boolean;
  companies: CompanyListItem[];
  page: number;
  search: string;
  total: number;
  workspaceRole: WorkspaceRole;
};

const actionInitialState: CompanyActionState = { message: "", status: "idle" };
const filters = [{ label: "All companies", value: "all" }] as const;

function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Updated recently" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function paginationHref(page: number, search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/companies?${query}` : "/companies";
}

function websiteLabel(company: CompanyListItem) {
  return company.websiteDomain ?? company.websiteUrl ?? "No website";
}

/** Server-backed company form shared by the create and manager edit drawers. */
function CompanyForm({ action, company, onComplete }: { action: CompanyAction; company?: CompanyListItem; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(action, actionInitialState);
  useEffect(() => { if (state.status === "success") onComplete(); }, [onComplete, state.status]);

  return (
    <form action={formAction} className="space-y-6">
      {company ? <input name="companyId" type="hidden" value={company.id} /> : null}
      <div className="grid gap-4">
        <Field label="Company name" hint="Required. Names are unique within the workspace."><Input defaultValue={company?.name ?? ""} maxLength={200} name="name" required /></Field>
        <Field label="Legal name" hint="Optional registered name."><Input defaultValue={company?.legalName ?? ""} maxLength={200} name="legalName" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website" hint="Optional. Include http:// or https://."><Input defaultValue={company?.websiteUrl ?? ""} maxLength={500} name="websiteUrl" type="url" /></Field>
          <Field label="Phone" hint="Optional E.164 number, e.g. +14155552671."><Input defaultValue={company?.phoneNumber ?? ""} maxLength={16} name="phoneNumber" type="tel" /></Field>
        </div>
        <Field label="Address" hint="Optional office or mailing address."><Textarea defaultValue={company?.address ?? ""} maxLength={500} name="address" /></Field>
      </div>
      {state.status !== "idle" ? <p aria-live="polite" className={state.status === "error" ? "rounded-lg border border-[#ecc7cf] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]" : "rounded-lg border border-[#cce4d6] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]"}>{state.message}</p> : null}
      <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5"><Button disabled={pending} onClick={onComplete} variant="secondary">Cancel</Button><Button disabled={pending} type="submit">{pending ? "Saving…" : company ? "Save changes" : "Create company"}</Button></div>
    </form>
  );
}

/** Resolves detail on demand so the directory remains paginated while the drawer includes linked contacts. */
function CompanyDrawerContent({ canManageCompanies, company, onClose }: { canManageCompanies: boolean; company: CompanyListItem; onClose: () => void }) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    startTransition(() => {
      void getCompanyDetailAction(company.id).then((result) => {
        if (!mounted) return;
        if (result.type === "success" && result.detail) setDetail(result.detail);
        else setDetailError(result.message ?? "Company detail could not be loaded.");
      });
    });
    return () => { mounted = false; };
  }, [company.id]);

  if (canManageCompanies) return <div className="space-y-8"><CompanyForm action={updateCompanyAction} company={company} onComplete={onClose} /><LinkedContacts detail={detail} error={detailError} /></div>;
  return <div className="space-y-6"><dl className="grid gap-4 text-sm"><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Legal name</dt><dd className="mt-1 font-medium text-[var(--ink)]">{company.legalName ?? "Not recorded"}</dd></div><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Website</dt><dd className="mt-1 font-medium text-[var(--ink)]">{websiteLabel(company)}</dd></div><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Phone</dt><dd className="mt-1 font-medium text-[var(--ink)]">{company.phoneNumber ?? "Not recorded"}</dd></div><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Address</dt><dd className="mt-1 whitespace-pre-wrap font-medium text-[var(--ink)]">{company.address ?? "Not recorded"}</dd></div></dl><LinkedContacts detail={detail} error={detailError} /><div className="flex justify-end border-t border-[var(--line)] pt-5"><Button onClick={onClose} variant="secondary">Close</Button></div></div>;
}

function LinkedContacts({ detail, error }: { detail: CompanyDetail | null; error: string | null }) {
  if (error) return <p className="rounded-lg border border-[#ecc7cf] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>;
  if (!detail) return <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--ink-muted)]">Loading linked contacts…</p>;
  return <section className="space-y-3 border-t border-[var(--line)] pt-6"><div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Relationships</p><h3 className="mt-1 text-base font-semibold text-[var(--ink)]">Linked contacts</h3></div>{detail.linkedContacts.length === 0 ? <p className="text-sm text-[var(--ink-muted)]">No contacts are currently linked to this company.</p> : <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">{detail.linkedContacts.map((contact) => <li className="flex items-center justify-between gap-3 px-3 py-3" key={contact.id}><span><span className="block text-sm font-semibold text-[var(--ink)]">{contact.fullName}</span><span className="block text-xs text-[var(--ink-muted)]">{contact.primaryEmail ?? "No primary email"}</span></span>{contact.emailDnc ? <StatusPill tone="danger">Email DNC</StatusPill> : null}</li>)}</ul>}</section>;
}

/** Replaces the Companies prototype with a paginated, tenant-backed company directory. */
export function CompaniesScreen({ canManageCompanies, companies, page, search, total }: CompaniesScreenProps) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const firstCompany = total === 0 ? 0 : (page - 1) * 25 + 1;
  const lastCompany = total === 0 ? 0 : firstCompany + companies.length - 1;
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const linkedContacts = companies.reduce((count, company) => count + company.contactCount, 0);

  return <div className="space-y-6"><PageHeader actions={canManageCompanies ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />New company</Button> : undefined} description="Search and manage companies in your active workspace, with linked contact coverage visible at a glance." eyebrow="CRM / Accounts" title="Companies" /><div className="grid gap-3 sm:grid-cols-3"><MetricCard detail="matching the current search" label="Companies found" value={total.toLocaleString()} /><MetricCard detail={total === 0 ? "no matching companies" : `${firstCompany.toLocaleString()}–${lastCompany.toLocaleString()} of ${total.toLocaleString()}`} label="Visible now" tone="teal" value={companies.length.toLocaleString()} /><MetricCard detail="across the companies currently shown" label="Linked contacts" tone="positive" value={linkedContacts.toLocaleString()} /></div><FilterBar filterLabel="Company filters" filters={filters} searchLabel="Search companies" searchPlaceholder="Search companies or websites" searchValue={search} selectedFilter="all" />{companies.length === 0 ? <ScreenState action={canManageCompanies ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />Create company</Button> : undefined} description={search ? "No companies match this search. Clear it or try another company name." : "This workspace has no companies yet."} title="No companies found" type="empty" /> : <><DataTable label="Company directory"><TableHeader><tr><TableHead>Company</TableHead><TableHead>Contact coverage</TableHead><TableHead>Phone</TableHead><TableHead>Updated</TableHead><TableHead className="w-12"><span className="sr-only">Open company</span></TableHead></tr></TableHeader><tbody className="divide-y divide-[var(--line)]">{companies.map((company) => <tr className="transition-colors hover:bg-[var(--surface-subtle)]" key={company.id}><TableCell><button className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => setDrawer({ company, mode: "view" })} type="button"><span className="grid size-8 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]"><BuildingIcon className="size-4" /></span><span><span className="block font-semibold text-[var(--ink)]">{company.name}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{websiteLabel(company)}</span></span></button></TableCell><TableCell className="font-semibold text-[var(--ink)]">{company.contactCount.toLocaleString()} {company.contactCount === 1 ? "contact" : "contacts"}</TableCell><TableCell className="text-[var(--ink-muted)]">{company.phoneNumber ?? "No phone"}</TableCell><TableCell className="text-[var(--ink-muted)]">{updatedLabel(company.updatedAt)}</TableCell><TableCell><Button aria-label={`Open ${company.name}`} onClick={() => setDrawer({ company, mode: "view" })} size="icon" variant="ghost"><MoreIcon className="size-4" /></Button></TableCell></tr>)}</tbody></DataTable><nav aria-label="Companies pagination" className="flex items-center justify-between gap-3 text-sm text-[var(--ink-muted)]"><span>Page {page} of {pageCount}</span><div className="flex gap-2">{page > 1 ? <Link className="inline-flex h-9 items-center rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]" href={paginationHref(page - 1, search)}>Previous</Link> : null}{page < pageCount ? <Link className="inline-flex h-9 items-center rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]" href={paginationHref(page + 1, search)}>Next</Link> : null}</div></nav></>}<Drawer description={drawer?.mode === "create" ? "Create a company in the active workspace." : "Review company details, linked contacts, and manager-only edit fields."} onClose={() => setDrawer(null)} open={drawer !== null} title={drawer?.mode === "create" ? "New company" : drawer?.company.name ?? "Company"}>{drawer?.mode === "create" ? <CompanyForm action={createCompanyAction} onComplete={() => setDrawer(null)} /> : null}{drawer?.mode === "view" ? <CompanyDrawerContent canManageCompanies={canManageCompanies} company={drawer.company} key={drawer.company.id} onClose={() => setDrawer(null)} /> : null}</Drawer></div>;
}
