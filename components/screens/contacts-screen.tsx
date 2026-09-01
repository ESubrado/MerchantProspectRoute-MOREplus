"use client";

import { useMemo, useState } from "react";

import { MoreIcon, PlusIcon } from "@/components/icons";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { FilterBar } from "@/components/domain/filter-bar";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { StatusPill } from "@/components/domain/status-pill";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ReplyStatus = "Engaged" | "Awaiting reply" | "DNC" | "Auto-reply";

type Contact = {
  company: string;
  email: string;
  lastActivity: string;
  name: string;
  owner: string;
  status: ReplyStatus;
};

const contacts: readonly Contact[] = [
  { name: "Mara Iqbal", company: "Cobalt Works", email: "mara@cobalt.example", owner: "JD", status: "Engaged", lastActivity: "14 min ago" },
  { name: "Theo Park", company: "Nimbus Systems", email: "theo@nimbus.example", owner: "AL", status: "Awaiting reply", lastActivity: "52 min ago" },
  { name: "Rina Costa", company: "Fieldstone Labs", email: "rina@fieldstone.example", owner: "—", status: "DNC", lastActivity: "Yesterday" },
  { name: "Owen Bell", company: "Juniper Desk", email: "owen@juniper.example", owner: "MK", status: "Auto-reply", lastActivity: "Yesterday" },
  { name: "Linh Tran", company: "Alder & Row", email: "linh@alderrow.example", owner: "JD", status: "Engaged", lastActivity: "Mon" },
];

const filters = [
  { value: "all", label: "All contacts" },
  { value: "engaged", label: "Engaged" },
  { value: "attention", label: "Needs attention" },
  { value: "unassigned", label: "Unassigned" },
] as const;

const replyTone: Record<ReplyStatus, "success" | "warning" | "danger" | "info"> = {
  Engaged: "success",
  "Awaiting reply": "warning",
  DNC: "danger",
  "Auto-reply": "info",
};

export function ContactsScreen() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Contact>(contacts[0]);

  const visibleContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesTerm = !term || [contact.name, contact.company, contact.email].some((value) => value.toLowerCase().includes(term));
      const matchesFilter = filter === "all"
        || (filter === "engaged" && contact.status === "Engaged")
        || (filter === "attention" && ["Awaiting reply", "DNC"].includes(contact.status))
        || (filter === "unassigned" && contact.owner === "—");
      return matchesTerm && matchesFilter;
    });
  }, [filter, search]);

  function inspect(contact: Contact) {
    setSelected(contact);
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<Button onClick={() => setOpen(true)}><PlusIcon className="size-4" />New contact</Button>}
        description="Preview the scanning hierarchy for ownership, reply posture, and next action. This data is illustrative until the CRM backend is connected."
        eyebrow="CRM / Directory"
        title="Contacts"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard detail="across active workspace records" label="Active contacts" value="12,480" />
        <MetricCard detail="flagged for a human response" label="Reply queue" tone="attention" value="38" />
        <MetricCard detail="enforced before outbound sends" label="DNC protected" tone="teal" value="214" />
      </div>

      <FilterBar filters={filters} onFilterChange={setFilter} onSearchChange={setSearch} searchValue={search} selectedFilter={filter} />

      <DataTable label="Contact directory">
        <TableHeader>
          <tr>
            <TableHead>Contact</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Reply posture</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Latest signal</TableHead>
            <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
          </tr>
        </TableHeader>
        <tbody className="divide-y divide-[var(--line)]">
          {visibleContacts.map((contact) => (
            <tr className="transition-colors hover:bg-[var(--surface-subtle)]" key={contact.email}>
              <TableCell>
                <button className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => inspect(contact)} type="button">
                  <span className="block font-semibold text-[var(--ink)]">{contact.name}</span>
                  <span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{contact.email}</span>
                </button>
              </TableCell>
              <TableCell className="font-medium text-[var(--ink)]">{contact.company}</TableCell>
              <TableCell><StatusPill tone={replyTone[contact.status]}>{contact.status}</StatusPill></TableCell>
              <TableCell>
                {contact.owner === "—" ? <span className="text-[var(--ink-muted)]">Unassigned</span> : <span className="grid size-7 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)]">{contact.owner}</span>}
              </TableCell>
              <TableCell className="text-[var(--ink-muted)]">{contact.lastActivity}</TableCell>
              <TableCell><Button aria-label={`Inspect ${contact.name}`} onClick={() => inspect(contact)} size="icon" variant="ghost"><MoreIcon className="size-4" /></Button></TableCell>
            </tr>
          ))}
          {visibleContacts.length === 0 ? (
            <tr><TableCell className="py-12 text-center text-[var(--ink-muted)]" colSpan={6}>No contacts match this view. Clear a filter or adjust the search.</TableCell></tr>
          ) : null}
        </tbody>
      </DataTable>

      <Drawer description="A consistent drawer pattern for contact inspection and focused editing." onClose={() => setOpen(false)} open={open} title={selected.name}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2"><StatusPill tone={replyTone[selected.status]}>{selected.status}</StatusPill><span className="text-sm text-[var(--ink-muted)]">{selected.company}</span></div>
          <div className="grid gap-4">
            <Field label="Work email" hint="Validation and canonical-address history will be connected with the CRM data layer."><Input defaultValue={selected.email} type="email" /></Field>
            <Field label="Company"><Input defaultValue={selected.company} /></Field>
            <Field label="Context note" hint="Use a clear next action rather than a long narrative."><Textarea defaultValue="Preview-only form control. No data is saved in the initial scaffold." /></Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5"><Button onClick={() => setOpen(false)} variant="secondary">Cancel</Button><Button disabled>Save changes</Button></div>
        </div>
      </Drawer>
    </div>
  );
}
