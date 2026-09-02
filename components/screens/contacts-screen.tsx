"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";

import { createContactAction, type ContactActionState, updateContactAction } from "@/app/actions/contacts";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { FilterBar } from "@/components/domain/filter-bar";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { ScreenState } from "@/components/domain/screen-state";
import { StatusPill } from "@/components/domain/status-pill";
import { MoreIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { WorkspaceRole } from "@/lib/auth/roles";
import type { CompanyOption, ContactListItem } from "@/lib/crm/contacts";

type ContactAction = (previousState: ContactActionState, formData: FormData) => Promise<ContactActionState>;

type DrawerState =
  | { mode: "create" }
  | { contact: ContactListItem; mode: "view" }
  | null;

type ContactsScreenProps = {
  canManageContacts: boolean;
  companies: CompanyOption[];
  contacts: ContactListItem[];
  filter?: string;
  page: number;
  search: string;
  total: number;
  workspaceRole: WorkspaceRole;
};

const actionInitialState: ContactActionState = { message: "", status: "idle" };
const filters = [
  { value: "all", label: "All contacts" },
  { value: "with_email", label: "Has email" },
  { value: "without_email", label: "Needs email" },
  { value: "unassigned", label: "Unassigned" },
] as const;

/** Formats an actual database timestamp for compact directory scanning. */
function updatedLabel(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Updated recently"
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Preserves the current search and filter while giving the directory durable, linkable pagination. */
function paginationHref(page: number, filter: string, search: string) {
  const params = new URLSearchParams();

  if (filter !== "all") params.set("filter", filter);
  if (search.trim()) params.set("search", search.trim());
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/contacts?${query}` : "/contacts";
}

/** Renders the create/edit form and surfaces server-side validation or persistence feedback next to the fields. */
function ContactForm({
  action,
  companies,
  contact,
  onComplete,
}: {
  action: ContactAction;
  companies: CompanyOption[];
  contact?: ContactListItem;
  onComplete: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, actionInitialState);
  // Preserve an older company selection even when the picker is intentionally capped for initial page load.
  const selectableCompanies = contact?.companyId && contact.companyName && !companies.some((company) => company.id === contact.companyId)
    ? [{ id: contact.companyId, name: contact.companyName }, ...companies]
    : companies;

  useEffect(() => {
    if (state.status === "success") onComplete();
  }, [onComplete, state.status]);

  return (
    <form action={formAction} className="space-y-6">
      {contact ? <input name="contactId" type="hidden" value={contact.id} /> : null}
      <div className="grid gap-4">
        <Field label="Contact name" hint="Required. This is how the contact is shown in the directory.">
          <Input defaultValue={contact?.fullName} maxLength={200} name="fullName" required />
        </Field>
        <Field label="Company" hint="Choose an existing company in this workspace, or leave this contact independent.">
          <Select defaultValue={contact?.companyId ?? ""} name="companyId">
            <option value="">No company</option>
            {selectableCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </Select>
        </Field>
        <Field label="Primary email" hint="Optional. Saving a new value replaces this contact's current primary email.">
          <Input defaultValue={contact?.primaryEmail ?? ""} maxLength={320} name="primaryEmail" type="email" />
        </Field>
      </div>
      {state.status !== "idle" ? (
        <p aria-live="polite" className={state.status === "error" ? "rounded-lg border border-[#ecc7cf] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]" : "rounded-lg border border-[#cce4d6] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]"}>
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5">
        <Button disabled={pending} onClick={onComplete} variant="secondary">Cancel</Button>
        <Button disabled={pending} type="submit">{pending ? "Saving…" : contact ? "Save changes" : "Create contact"}</Button>
      </div>
    </form>
  );
}

/** Presents read-only detail for members, while owners and admins receive the server-backed contact editor. */
function ContactDrawerContent({
  canManageContacts,
  companies,
  contact,
  onClose,
}: {
  canManageContacts: boolean;
  companies: CompanyOption[];
  contact: ContactListItem;
  onClose: () => void;
}) {
  if (canManageContacts) {
    return <ContactForm action={updateContactAction} companies={companies} contact={contact} key={contact.id} onComplete={onClose} />;
  }

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 text-sm">
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Company</dt><dd className="mt-1 font-medium text-[var(--ink)]">{contact.companyName ?? "No company"}</dd></div>
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Primary email</dt><dd className="mt-1 font-medium text-[var(--ink)]">{contact.primaryEmail ?? "No primary email"}</dd></div>
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Ownership</dt><dd className="mt-1"><StatusPill tone={contact.isAssigned ? "success" : "neutral"}>{contact.isAssigned ? "Assigned" : "Unassigned"}</StatusPill></dd></div>
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Last updated</dt><dd className="mt-1 font-medium text-[var(--ink)]">{updatedLabel(contact.updatedAt)}</dd></div>
      </dl>
      <div className="flex justify-end border-t border-[var(--line)] pt-5"><Button onClick={onClose} variant="secondary">Close</Button></div>
    </div>
  );
}

/** Replaces the Contacts prototype with a paginated, database-backed workspace directory. */
export function ContactsScreen({ canManageContacts, companies, contacts, filter, page, search, total, workspaceRole }: ContactsScreenProps) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const selectedFilter = filters.some((option) => option.value === filter) ? filter ?? "all" : "all";
  const firstContact = total === 0 ? 0 : (page - 1) * 25 + 1;
  const lastContact = total === 0 ? 0 : firstContact + contacts.length - 1;
  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-6">
      <PageHeader
        actions={canManageContacts ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />New contact</Button> : undefined}
        description="Search and manage contacts that belong to your active workspace. Results and permissions are enforced by Supabase."
        eyebrow="CRM / Directory"
        title="Contacts"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard detail="matching the current search and filters" label="Contacts found" value={total.toLocaleString()} />
        <MetricCard detail={total === 0 ? "no matching contacts" : `${firstContact.toLocaleString()}–${lastContact.toLocaleString()} of ${total.toLocaleString()}`} label="Visible now" tone="teal" value={contacts.length.toLocaleString()} />
        <MetricCard detail={canManageContacts ? "you can create and edit contacts" : "you have read-only contact access"} label="Workspace role" tone={canManageContacts ? "positive" : "attention"} value={workspaceRole === "owner" ? "Owner" : workspaceRole === "admin" ? "Admin" : "Member"} />
      </div>

      <FilterBar filters={filters} key={`${selectedFilter}-${search}`} searchValue={search} selectedFilter={selectedFilter} />

      {contacts.length === 0 ? (
        <ScreenState
          action={canManageContacts ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />Create contact</Button> : undefined}
          description={search || selectedFilter !== "all" ? "No contacts match the current search or filter. Clear it or try a different term." : "This workspace has no contacts yet."}
          title="No contacts found"
          type="empty"
        />
      ) : (
        <>
          <DataTable label="Contact directory">
            <TableHeader>
              <tr>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Primary email</TableHead>
                <TableHead>Ownership</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-12"><span className="sr-only">Open contact</span></TableHead>
              </tr>
            </TableHeader>
            <tbody className="divide-y divide-[var(--line)]">
              {contacts.map((contact) => (
                <tr className="transition-colors hover:bg-[var(--surface-subtle)]" key={contact.id}>
                  <TableCell>
                    <button className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => setDrawer({ contact, mode: "view" })} type="button">
                      <span className="block font-semibold text-[var(--ink)]">{contact.fullName}</span>
                    </button>
                  </TableCell>
                  <TableCell className="font-medium text-[var(--ink)]">{contact.companyName ?? <span className="text-[var(--ink-muted)]">No company</span>}</TableCell>
                  <TableCell className="text-[var(--ink-muted)]">{contact.primaryEmail ?? "No primary email"}</TableCell>
                  <TableCell><StatusPill tone={contact.isAssigned ? "success" : "neutral"}>{contact.isAssigned ? "Assigned" : "Unassigned"}</StatusPill></TableCell>
                  <TableCell className="text-[var(--ink-muted)]">{updatedLabel(contact.updatedAt)}</TableCell>
                  <TableCell><Button aria-label={`Open ${contact.fullName}`} onClick={() => setDrawer({ contact, mode: "view" })} size="icon" variant="ghost"><MoreIcon className="size-4" /></Button></TableCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <nav aria-label="Contacts pagination" className="flex items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
            <span>Page {page} of {pageCount}</span>
            <div className="flex gap-2">
              {page > 1 ? <Link className="inline-flex h-9 items-center rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]" href={paginationHref(page - 1, selectedFilter, search)}>Previous</Link> : null}
              {page < pageCount ? <Link className="inline-flex h-9 items-center rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]" href={paginationHref(page + 1, selectedFilter, search)}>Next</Link> : null}
            </div>
          </nav>
        </>
      )}

      <Drawer
        description={drawer?.mode === "create" ? "Create a contact in the active workspace." : "Review the contact record and, if you are an owner or admin, update its core details."}
        onClose={() => setDrawer(null)}
        open={drawer !== null}
        title={drawer?.mode === "create" ? "New contact" : drawer?.contact.fullName ?? "Contact"}
      >
        {drawer?.mode === "create" ? <ContactForm action={createContactAction} companies={companies} key="create-contact" onComplete={() => setDrawer(null)} /> : null}
        {drawer?.mode === "view" ? <ContactDrawerContent canManageContacts={canManageContacts} companies={companies} contact={drawer.contact} onClose={() => setDrawer(null)} /> : null}
      </Drawer>
    </div>
  );
}
