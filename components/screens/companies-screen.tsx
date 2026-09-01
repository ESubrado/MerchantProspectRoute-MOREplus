import { BuildingIcon, PlusIcon } from "@/components/icons";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { StatusPill } from "@/components/domain/status-pill";
import { Button } from "@/components/ui/button";

const companies = [
  { name: "Cobalt Works", domain: "cobalt.example", contacts: 18, signal: "Strong intent", tone: "success" as const, activity: "14 min ago" },
  { name: "Nimbus Systems", domain: "nimbus.example", contacts: 7, signal: "Watching", tone: "warning" as const, activity: "52 min ago" },
  { name: "Fieldstone Labs", domain: "fieldstone.example", contacts: 5, signal: "Suppressed", tone: "danger" as const, activity: "Yesterday" },
  { name: "Alder & Row", domain: "alderrow.example", contacts: 11, signal: "New account", tone: "info" as const, activity: "Mon" },
];

export function CompaniesScreen() {
  return (
    <div className="space-y-6">
      <PageHeader actions={<Button><PlusIcon className="size-4" />New company</Button>} description="A company view keeps account-level relationship signals visible without obscuring the people who own the conversation." eyebrow="CRM / Accounts" title="Companies" />
      <div className="grid gap-3 sm:grid-cols-3"><MetricCard detail="with at least one active contact" label="Active companies" value="3,206" /><MetricCard detail="showing reply activity this week" label="Engaged accounts" tone="positive" value="246" /><MetricCard detail="require ownership review" label="Unassigned accounts" tone="attention" value="19" /></div>
      <DataTable label="Company directory">
        <TableHeader><tr><TableHead>Company</TableHead><TableHead>Contact coverage</TableHead><TableHead>Account signal</TableHead><TableHead>Latest activity</TableHead><TableHead className="w-12"><span className="sr-only">Open</span></TableHead></tr></TableHeader>
        <tbody className="divide-y divide-[var(--line)]">
          {companies.map((company) => <tr className="hover:bg-[var(--surface-subtle)]" key={company.domain}>
            <TableCell><span className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]"><BuildingIcon className="size-4" /></span><span><span className="block font-semibold text-[var(--ink)]">{company.name}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{company.domain}</span></span></span></TableCell>
            <TableCell className="font-semibold text-[var(--ink)]">{company.contacts} contacts</TableCell><TableCell><StatusPill tone={company.tone}>{company.signal}</StatusPill></TableCell><TableCell className="text-[var(--ink-muted)]">{company.activity}</TableCell><TableCell><Button size="sm" variant="secondary">Open</Button></TableCell>
          </tr>)}
        </tbody>
      </DataTable>
    </div>
  );
}
