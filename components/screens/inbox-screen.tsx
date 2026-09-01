import { ArrowUpRightIcon } from "@/components/icons";
import { ActivityTimeline } from "@/components/domain/activity-timeline";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { StatusPill } from "@/components/domain/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const conversations = [
  { from: "Mara Iqbal", account: "Cobalt Works", preview: "Could you send a short outline before our planning meeting?", status: "Reply needed", tone: "success" as const, time: "14 min" },
  { from: "Theo Park", account: "Nimbus Systems", preview: "Thanks for reaching out — I will take a look next week.", status: "Warm", tone: "warning" as const, time: "52 min" },
  { from: "Owen Bell", account: "Juniper Desk", preview: "I am away until Thursday with limited access to my inbox.", status: "Auto-reply", tone: "info" as const, time: "Yesterday" },
  { from: "Rina Costa", account: "Fieldstone Labs", preview: "Please remove me from future outreach.", status: "DNC", tone: "danger" as const, time: "Yesterday" },
];

export function InboxScreen() {
  return (
    <div className="space-y-6">
      <PageHeader actions={<Button variant="secondary"><ArrowUpRightIcon className="size-4" />Review queue</Button>} description="A reply-first work queue surfaces buyer intent and opt-out risk before thread detail. Preview content is illustrative only." eyebrow="Inbox / Reply queue" title="Conversations" />
      <div className="grid gap-3 sm:grid-cols-3"><MetricCard detail="require a human response" label="Reply needed" tone="positive" value="12" /><MetricCard detail="received in the last 24 hours" label="New inbound" value="47" /><MetricCard detail="protected from future sends" label="DNC updates" tone="attention" value="3" /></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <DataTable label="Inbox conversations">
          <TableHeader><tr><TableHead>Contact</TableHead><TableHead>Latest message</TableHead><TableHead>Reply signal</TableHead><TableHead>Received</TableHead><TableHead className="w-12"><span className="sr-only">Open</span></TableHead></tr></TableHeader>
          <tbody className="divide-y divide-[var(--line)]">
            {conversations.map((conversation) => <tr className="hover:bg-[var(--surface-subtle)]" key={conversation.from}>
              <TableCell><span className="block font-semibold text-[var(--ink)]">{conversation.from}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{conversation.account}</span></TableCell>
              <TableCell className="max-w-xs truncate text-[var(--ink-muted)]">{conversation.preview}</TableCell>
              <TableCell><StatusPill tone={conversation.tone}>{conversation.status}</StatusPill></TableCell><TableCell className="text-[var(--ink-muted)]">{conversation.time}</TableCell><TableCell><Button size="sm" variant="secondary">Open</Button></TableCell>
            </tr>)}
          </tbody>
        </DataTable>
        <Card>
          <CardHeader><CardTitle>Latest workflow</CardTitle></CardHeader>
          <CardContent><ActivityTimeline items={[
            { title: "Reply classified", detail: "Mara Iqbal marked as reply needed for the account owner.", status: "Engaged", tone: "success", time: "14 min ago" },
            { title: "Sequence paused", detail: "Outbound activity stopped after a new inbound message.", status: "Paused", tone: "warning", time: "14 min ago" },
            { title: "DNC protected", detail: "Fieldstone Labs is excluded from all future sends.", status: "DNC", tone: "danger", time: "Yesterday" },
          ]} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
