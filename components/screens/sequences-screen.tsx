import { ActivityTimeline } from "@/components/domain/activity-timeline";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { StatusPill } from "@/components/domain/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sequences = [
  { name: "Operations leaders — Q2", steps: 4, enrolled: 842, health: "On track", tone: "success" as const, next: "126 ready today" },
  { name: "SaaS finance follow-up", steps: 3, enrolled: 317, health: "Needs review", tone: "warning" as const, next: "48 ready today" },
  { name: "Re-engagement — dormant", steps: 2, enrolled: 93, health: "Paused", tone: "danger" as const, next: "Manual hold" },
];

export function SequencesScreen() {
  return (
    <div className="space-y-6">
      <PageHeader actions={<Button>New sequence</Button>} description="Sequence health makes scheduling, capacity and reply interruptions legible at a glance before an operator changes an active campaign." eyebrow="Outreach / Automation" title="Sequences" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard detail="across current outreach programs" label="Active sequences" tone="positive" value="8" /><MetricCard detail="scheduled inside sending windows" label="Ready today" value="1,274" /><MetricCard detail="stopped by inbound replies" label="Reply stops" tone="teal" value="67" /><MetricCard detail="blocked by policy or data" label="Needs review" tone="attention" value="14" /></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <DataTable label="Sequence health">
          <TableHeader><tr><TableHead>Sequence</TableHead><TableHead>Steps</TableHead><TableHead>Enrolled</TableHead><TableHead>Health</TableHead><TableHead>Next activity</TableHead><TableHead className="w-12"><span className="sr-only">Open</span></TableHead></tr></TableHeader>
          <tbody className="divide-y divide-[var(--line)]">{sequences.map((sequence) => <tr className="hover:bg-[var(--surface-subtle)]" key={sequence.name}><TableCell><span className="block font-semibold text-[var(--ink)]">{sequence.name}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">Updated today</span></TableCell><TableCell className="font-semibold text-[var(--ink)]">{sequence.steps}</TableCell><TableCell className="font-semibold text-[var(--ink)]">{sequence.enrolled.toLocaleString()}</TableCell><TableCell><StatusPill tone={sequence.tone}>{sequence.health}</StatusPill></TableCell><TableCell className="text-[var(--ink-muted)]">{sequence.next}</TableCell><TableCell><Button size="sm" variant="secondary">Open</Button></TableCell></tr>)}</tbody>
        </DataTable>
        <Card><CardHeader><CardTitle>Dispatch timeline</CardTitle></CardHeader><CardContent><ActivityTimeline items={[
          { title: "Step 2 queued", detail: "126 contacts passed mailbox capacity and schedule checks.", status: "Ready", tone: "teal", time: "Today, 09:10" },
          { title: "Inbound reply received", detail: "Sequence stopped safely for Mara Iqbal.", status: "Stopped", tone: "success", time: "Today, 08:56" },
          { title: "Mailbox policy applied", detail: "One mailbox was held below its health threshold.", status: "Watching", tone: "warning", time: "Today, 08:30" },
        ]} /></CardContent></Card>
      </div>
    </div>
  );
}
