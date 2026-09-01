import Link from "next/link";

import { ActivityTimeline } from "@/components/domain/activity-timeline";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { StatusPill } from "@/components/domain/status-pill";
import { ArrowUpRightIcon } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const activityDays = [
  { label: "Mon", replies: 14 },
  { label: "Tue", replies: 19 },
  { label: "Wed", replies: 17 },
  { label: "Thu", replies: 26 },
  { label: "Fri", replies: 23 },
  { label: "Sat", replies: 31 },
  { label: "Sun", replies: 38 },
] as const;

const attentionItems = [
  { detail: "Three interested replies are waiting for a first response.", label: "Reply queue", tone: "warning" as const, value: "3" },
  { detail: "One active sequence is below its mailbox health threshold.", label: "Sequence health", tone: "danger" as const, value: "1" },
  { detail: "New contacts are ready to be assigned to an owner.", label: "Unassigned contacts", tone: "info" as const, value: "12" },
] as const;

const actionLinkClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:border-[var(--primary-strong)] hover:bg-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]";

function ReplyTrendChart() {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[var(--ink-muted)]">
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--teal)]" />Positive replies</span>
          <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--line-strong)]" />Seven-day view</span>
        </div>
        <p className="text-xs font-semibold text-[var(--success)]">+31% from prior week</p>
      </div>

      <svg aria-label="Positive replies rose from 14 on Monday to 38 on Sunday." className="h-auto w-full overflow-visible" role="img" viewBox="0 0 560 210">
        <title>Positive replies over the last seven days</title>
        <defs>
          <linearGradient id="reply-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[42, 82, 122, 162].map((y) => <line key={y} stroke="var(--line)" strokeDasharray="3 5" x1="22" x2="538" y1={y} y2={y} />)}
        <path d="M 28 158 L 112 133 L 196 145 L 280 99 L 364 116 L 448 73 L 532 45 L 532 178 L 28 178 Z" fill="url(#reply-area)" />
        <path d="M 28 158 L 112 133 L 196 145 L 280 99 L 364 116 L 448 73 L 532 45" fill="none" stroke="var(--teal)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {[{ x: 28, y: 158 }, { x: 112, y: 133 }, { x: 196, y: 145 }, { x: 280, y: 99 }, { x: 364, y: 116 }, { x: 448, y: 73 }, { x: 532, y: 45 }].map((point, index) => <circle cx={point.x} cy={point.y} fill="var(--surface)" key={activityDays[index].label} r="4.5" stroke="var(--teal)" strokeWidth="2.5" />)}
        <text fill="var(--ink)" fontSize="13" fontWeight="700" textAnchor="end" x="532" y="27">38</text>
      </svg>

      <div aria-hidden="true" className="mt-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-[var(--ink-muted)]">
        {activityDays.map((day) => <span key={day.label}>{day.label}</span>)}
      </div>
      <dl className="sr-only">
        {activityDays.map((day) => <div key={day.label}><dt>{day.label}</dt><dd>{day.replies} positive replies</dd></div>)}
      </dl>
    </div>
  );
}

export function HomeScreen() {
  return (
    <div className="space-y-6">
      <PageHeader
        actions={<><Link className={actionLinkClass} href="/outreach/inbox">Open reply queue <ArrowUpRightIcon className="size-4" /></Link><Link className="inline-flex items-center justify-center rounded-lg border border-[var(--line-strong)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]" href="/outreach/sequences">Review sequences</Link></>}
        description="A compact operating view for response priority, mailbox capacity, and the next outreach work that needs a decision."
        eyebrow="Workspace overview"
        title="Today’s outbound picture"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard detail="eligible for active outreach" label="Routable contacts" value="12,480" />
        <MetricCard detail="stopped safely by inbound messages" label="Reply-protected" tone="teal" value="67" />
        <MetricCard detail="inside mailbox sending windows" label="Ready today" tone="positive" value="1,274" />
        <MetricCard detail="require an operator decision" label="Needs review" tone="attention" value="14" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Reply momentum</CardTitle>
              <CardDescription>Positive replies across the last seven days</CardDescription>
            </div>
            <StatusPill tone="teal">Improving</StatusPill>
          </CardHeader>
          <CardContent className="pt-5"><ReplyTrendChart /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Morning brief</CardTitle>
            <CardDescription>Prioritize these operating signals first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 pt-3">
            {attentionItems.map((item) => (
              <div className="flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[var(--surface-subtle)]" key={item.label}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--primary-soft)] text-sm font-bold text-[var(--primary)]">{item.value}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[var(--ink)]">{item.label}</p><StatusPill tone={item.tone}>Review</StatusPill></div>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{item.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div><CardTitle>Sequence capacity</CardTitle><CardDescription>Mailbox room and outreach readiness at a glance.</CardDescription></div>
            <Link className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" href="/outreach/mailboxes">View mailboxes <ArrowUpRightIcon className="size-3.5" /></Link>
          </CardHeader>
          <CardContent className="grid gap-3 pt-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4"><p className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Healthy mailboxes</p><p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">18 / 20</p><p className="mt-1 text-xs text-[var(--success)]">Two more than last week</p></div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4"><p className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Daily capacity</p><p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">71%</p><p className="mt-1 text-xs text-[var(--ink-muted)]">of safe send limit reserved</p></div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4"><p className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Paused sends</p><p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">8</p><p className="mt-1 text-xs text-[var(--warning)]">waiting on reply or policy checks</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Latest workflow</CardTitle><CardDescription>Signals that changed the work queue.</CardDescription></CardHeader>
          <CardContent className="pt-3"><ActivityTimeline items={[
            { title: "Reply marked interested", detail: "Mara Iqbal is ready for follow-up from the reply queue.", status: "Respond", tone: "success", time: "14 min ago" },
            { title: "Sequence paused", detail: "SaaS finance follow-up reached a mailbox health safeguard.", status: "Review", tone: "warning", time: "42 min ago" },
            { title: "New contacts routed", detail: "12 qualified contacts are awaiting owner assignment.", status: "Assigned", tone: "info", time: "1 hr ago" },
          ]} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
