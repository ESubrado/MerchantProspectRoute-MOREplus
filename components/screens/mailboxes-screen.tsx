import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { StatusPill } from "@/components/domain/status-pill";
import { Button } from "@/components/ui/button";

const mailboxes = [
  { address: "alexa@harborline.example", provider: "Workspace mail", health: "Healthy", healthTone: "success" as const, limit: "41 / 65", policy: "Ramping" },
  { address: "jordan@harborline.example", provider: "Workspace mail", health: "Watching", healthTone: "warning" as const, limit: "38 / 65", policy: "Ramping" },
  { address: "marco@harborline.example", provider: "Workspace mail", health: "Paused", healthTone: "danger" as const, limit: "0 / 40", policy: "Manual pause" },
];

export function MailboxesScreen() {
  return (
    <div className="space-y-6">
      <PageHeader actions={<Button>Configure policy</Button>} description="Health and delivery capacity appear together so operators can identify exceptions before they spend their daily sending capacity." eyebrow="Outreach / Delivery" title="Mailboxes" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard detail="currently allowed to send" label="Active mailboxes" tone="positive" value="14" /><MetricCard detail="reserved or sent today" label="Daily capacity" value="1,284 / 1,920" /><MetricCard detail="below workspace threshold" label="Watching health" tone="attention" value="2" /><MetricCard detail="requires manual review" label="Paused" tone="teal" value="1" /></div>
      <DataTable label="Mailbox health and policy">
        <TableHeader><tr><TableHead>Mailbox</TableHead><TableHead>Provider</TableHead><TableHead>Health</TableHead><TableHead>Daily capacity</TableHead><TableHead>Send policy</TableHead><TableHead className="w-12"><span className="sr-only">Open</span></TableHead></tr></TableHeader>
        <tbody className="divide-y divide-[var(--line)]">
          {mailboxes.map((mailbox) => <tr className="hover:bg-[var(--surface-subtle)]" key={mailbox.address}>
            <TableCell><span className="block font-semibold text-[var(--ink)]">{mailbox.address}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">Last health check 12 min ago</span></TableCell><TableCell className="text-[var(--ink-muted)]">{mailbox.provider}</TableCell><TableCell><StatusPill tone={mailbox.healthTone}>{mailbox.health}</StatusPill></TableCell><TableCell className="font-semibold text-[var(--ink)]">{mailbox.limit}</TableCell><TableCell className="text-[var(--ink-muted)]">{mailbox.policy}</TableCell><TableCell><Button size="sm" variant="secondary">Inspect</Button></TableCell>
          </tr>)}
        </tbody>
      </DataTable>
    </div>
  );
}
