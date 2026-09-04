"use client";

import { useActionState, useEffect, useState } from "react";

import { createMailboxAction, type MailboxActionState, updateMailboxAction } from "@/app/actions/mailboxes";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
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
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceRole } from "@/lib/auth/roles";
import type { MailboxListItem } from "@/lib/mailboxes/mailboxes";

type MailboxAction = (previousState: MailboxActionState, formData: FormData) => Promise<MailboxActionState>;
type DrawerState = { mailbox?: MailboxListItem; mode: "create" | "view" } | null;

type MailboxesScreenProps = {
  canManageMailboxes: boolean;
  mailboxes: MailboxListItem[];
  workspaceRole: WorkspaceRole;
};

const actionInitialState: MailboxActionState = { message: "", status: "idle" };

function usedCapacity(mailbox: MailboxListItem) {
  return mailbox.reservedCount + mailbox.consumedCount;
}

function capacityLabel(mailbox: MailboxListItem) {
  return `${usedCapacity(mailbox).toLocaleString()} / ${mailbox.effectiveDailyCapacity.toLocaleString()}`;
}

function observationLabel(mailbox: MailboxListItem) {
  if (!mailbox.healthObservedAt) return "No observation";
  if (mailbox.healthScore === null) return "Observed";
  return `Observed ${mailbox.healthScore.toFixed(0)}%`;
}

function observationDetail(mailbox: MailboxListItem) {
  if (!mailbox.healthObservedAt) return "No provider or health source is connected.";
  const date = new Date(mailbox.healthObservedAt);
  const recordedAt = Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
  return `${mailbox.healthSource ?? "Recorded source"} · ${recordedAt}`;
}

function mailboxStatus(mailbox: MailboxListItem) {
  if (mailbox.manualPause) return { label: "Manual pause", tone: "danger" as const };
  return mailbox.status === "active"
    ? { label: "Active", tone: "success" as const }
    : { label: "Paused", tone: "warning" as const };
}

/** A manager form that records an externally provisioned mailbox and its database-enforced capacity policy. */
function MailboxForm({ action, mailbox, onComplete }: { action: MailboxAction; mailbox?: MailboxListItem; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(action, actionInitialState);
  const [manualPause, setManualPause] = useState(mailbox?.manualPause ?? false);
  const [rampEnabled, setRampEnabled] = useState(mailbox?.rampEnabled ?? false);

  useEffect(() => {
    if (state.status === "success") onComplete();
  }, [onComplete, state.status]);

  return (
    <form action={formAction} className="space-y-7">
      {mailbox ? <input name="mailboxId" type="hidden" value={mailbox.id} /> : null}
      <section className="space-y-4">
        <div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Operator-managed mailbox</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">This records an account provisioned outside this app. It stores no provider credential and cannot send email.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mailbox email" hint="Unique within this workspace."><Input defaultValue={mailbox?.emailAddress ?? ""} maxLength={320} name="emailAddress" required type="email" /></Field>
          <Field label="Display name" hint="Optional operator-facing label."><Input defaultValue={mailbox?.displayName ?? ""} maxLength={120} name="displayName" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" hint={manualPause ? "Manual pause overrides an active status until cleared." : "Paused is the safe default; status never initiates sending on its own."}>
            <Select defaultValue={mailbox?.status ?? "paused"} name="status"><option value="paused">Paused</option><option value="active">Active</option></Select>
          </Field>
          <Field label="Local-day timezone" hint="IANA name used for daily capacity accounting."><Input defaultValue={mailbox?.localDayTimezone ?? "UTC"} maxLength={100} name="localDayTimezone" placeholder="Asia/Singapore" required /></Field>
        </div>
      </section>

      <section className="space-y-4 border-t border-[var(--line)] pt-6">
        <div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Capacity policy</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Reservations are counted against the mailbox local day. This screen only configures limits; dispatch is not enabled.</p></div>
        <Field label="Daily capacity limit" hint="Hard maximum before any ramp reduction; 1 to 10,000."><Input defaultValue={mailbox?.dailyCapacityLimit ?? 50} max={10000} min={1} name="dailyCapacityLimit" required step={1} type="number" /></Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm text-[var(--ink)]"><input checked={rampEnabled} className="mt-0.5 size-4 accent-[var(--primary)]" name="rampEnabled" onChange={(event) => setRampEnabled(event.target.checked)} type="checkbox" /><span><span className="block font-semibold">Use a daily ramp</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">Increase from a starting capacity by a fixed amount until the ramp maximum.</span></span></label>
        {rampEnabled ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Ramp start date"><Input defaultValue={mailbox?.rampStartDate ?? ""} name="rampStartDate" required type="date" /></Field><Field label="Starting capacity"><Input defaultValue={mailbox?.rampInitialDailyCapacity ?? ""} min={1} name="rampInitialDailyCapacity" required step={1} type="number" /></Field><Field label="Daily increase"><Input defaultValue={mailbox?.rampDailyIncrement ?? ""} min={0} name="rampDailyIncrement" required step={1} type="number" /></Field><Field label="Ramp maximum"><Input defaultValue={mailbox?.rampMaxDailyCapacity ?? ""} min={1} name="rampMaxDailyCapacity" required step={1} type="number" /></Field></div> : null}
      </section>

      <section className="space-y-4 border-t border-[var(--line)] pt-6">
        <div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Manual pause</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">A manual pause always prevents future capacity reservations, regardless of mailbox status or any later health integration.</p></div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm text-[var(--ink)]"><input checked={manualPause} className="mt-0.5 size-4 accent-[var(--danger)]" name="manualPause" onChange={(event) => setManualPause(event.target.checked)} type="checkbox" /><span><span className="block font-semibold">Manually pause this mailbox</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">Clearing it restores the selected status, but does not send email.</span></span></label>
        {manualPause ? <Field label="Pause reason" hint="Required for the immutable configuration audit event."><Textarea defaultValue={mailbox?.manualPauseReason ?? ""} maxLength={500} name="manualPauseReason" required /></Field> : null}
      </section>

      {state.status !== "idle" ? <p aria-live="polite" className={state.status === "error" ? "rounded-lg border border-[#ecc7cf] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]" : "rounded-lg border border-[#cce4d6] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]"}>{state.message}</p> : null}
      <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5"><Button disabled={pending} onClick={onComplete} type="button" variant="secondary">Cancel</Button><Button disabled={pending} type="submit">{pending ? "Saving…" : mailbox ? "Save configuration" : "Record mailbox"}</Button></div>
    </form>
  );
}

function ReadOnlyMailbox({ mailbox, onClose }: { mailbox: MailboxListItem; onClose: () => void }) {
  const healthText = mailbox.healthSummary ?? "No health observation has been recorded. A provider and health source have not been selected.";
  return <div className="space-y-6"><dl className="grid gap-4 text-sm"><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Status</dt><dd className="mt-1"><StatusPill tone={mailboxStatus(mailbox).tone}>{mailboxStatus(mailbox).label}</StatusPill></dd></div><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Local-day capacity</dt><dd className="mt-1 font-medium text-[var(--ink)]">{capacityLabel(mailbox)} reserved or consumed · {mailbox.localDayTimezone}</dd></div><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Ramp</dt><dd className="mt-1 font-medium text-[var(--ink)]">{mailbox.rampEnabled ? `${mailbox.rampInitialDailyCapacity} + ${mailbox.rampDailyIncrement}/day up to ${mailbox.rampMaxDailyCapacity}` : "Not enabled"}</dd></div><div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Health observation</dt><dd className="mt-1 leading-6 text-[var(--ink)]">{healthText}</dd></div>{mailbox.manualPauseReason ? <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Manual pause reason</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-[var(--ink)]">{mailbox.manualPauseReason}</dd></div> : null}</dl><div className="flex justify-end border-t border-[var(--line)] pt-5"><Button onClick={onClose} variant="secondary">Close</Button></div></div>;
}

/** Replaces the static mailbox prototype with the workspace-scoped Phase 5 mailbox and policy view. */
export function MailboxesScreen({ canManageMailboxes, mailboxes }: MailboxesScreenProps) {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const activeCount = mailboxes.filter((mailbox) => mailbox.status === "active" && !mailbox.manualPause).length;
  const manuallyPausedCount = mailboxes.filter((mailbox) => mailbox.manualPause).length;
  const observedCount = mailboxes.filter((mailbox) => mailbox.healthObservedAt !== null).length;
  const consumedOrReserved = mailboxes.reduce((total, mailbox) => total + usedCapacity(mailbox), 0);
  const effectiveCapacity = mailboxes.reduce((total, mailbox) => total + mailbox.effectiveDailyCapacity, 0);

  return <div className="space-y-6"><PageHeader actions={canManageMailboxes ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />Record mailbox</Button> : undefined} description="Operator-recorded mailbox capacity and pause controls. Email provider connections, health automation, and dispatch remain intentionally disabled." eyebrow="Outreach / Delivery" title="Mailboxes" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard detail="not manually paused" label="Active mailboxes" tone="positive" value={activeCount.toLocaleString()} /><MetricCard detail="for each mailbox's local day" label="Reserved or consumed" value={`${consumedOrReserved.toLocaleString()} / ${effectiveCapacity.toLocaleString()}`} /><MetricCard detail="informational only; no automated action" label="Health observations" tone="teal" value={`${observedCount.toLocaleString()} recorded`} /><MetricCard detail="capacity reservation is blocked" label="Manual pauses" tone="attention" value={manuallyPausedCount.toLocaleString()} /></div>{!canManageMailboxes ? <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--ink-muted)]">Mailbox configuration is limited to workspace owners and admins. You can review the current workspace state below.</p> : null}{mailboxes.length === 0 ? <ScreenState action={canManageMailboxes ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />Record mailbox</Button> : undefined} description={canManageMailboxes ? "Record an externally provisioned mailbox and set its safe local-day capacity policy." : "No mailbox records exist in this workspace."} title="No mailboxes recorded" type="empty" /> : <DataTable label="Mailbox policy and capacity"><TableHeader><tr><TableHead>Mailbox</TableHead><TableHead>Status</TableHead><TableHead>Local-day capacity</TableHead><TableHead>Ramp</TableHead><TableHead>Health observation</TableHead><TableHead className="w-12"><span className="sr-only">Open mailbox</span></TableHead></tr></TableHeader><tbody className="divide-y divide-[var(--line)]">{mailboxes.map((mailbox) => { const state = mailboxStatus(mailbox); return <tr className="transition-colors hover:bg-[var(--surface-subtle)]" key={mailbox.id}><TableCell><button className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => setDrawer({ mailbox, mode: "view" })} type="button"><span className="block font-semibold text-[var(--ink)]">{mailbox.displayName ?? mailbox.emailAddress}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{mailbox.displayName ? mailbox.emailAddress : "Externally provisioned"}</span></button></TableCell><TableCell><StatusPill tone={state.tone}>{state.label}</StatusPill></TableCell><TableCell><span className="block font-semibold text-[var(--ink)]">{capacityLabel(mailbox)}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{mailbox.localDay} · {mailbox.localDayTimezone}</span></TableCell><TableCell className="text-[var(--ink-muted)]">{mailbox.rampEnabled ? `${mailbox.rampInitialDailyCapacity} + ${mailbox.rampDailyIncrement}/day` : "Fixed limit"}</TableCell><TableCell><span className="block font-medium text-[var(--ink)]">{observationLabel(mailbox)}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{observationDetail(mailbox)}</span></TableCell><TableCell><Button aria-label={`Open ${mailbox.emailAddress}`} onClick={() => setDrawer({ mailbox, mode: "view" })} size="icon" variant="ghost"><MoreIcon className="size-4" /></Button></TableCell></tr>; })}</tbody></DataTable>}<Drawer description={drawer?.mode === "create" ? "Record an externally provisioned mailbox. No email provider is connected." : "Review mailbox capacity and, for owners and admins, update its audited policy."} onClose={() => setDrawer(null)} open={drawer !== null} title={drawer?.mode === "create" ? "Record mailbox" : drawer?.mailbox?.displayName ?? drawer?.mailbox?.emailAddress ?? "Mailbox"}>{drawer?.mode === "create" ? <MailboxForm action={createMailboxAction} onComplete={() => setDrawer(null)} /> : null}{drawer?.mode === "view" && drawer.mailbox ? (canManageMailboxes ? <MailboxForm action={updateMailboxAction} key={drawer.mailbox.id} mailbox={drawer.mailbox} onComplete={() => setDrawer(null)} /> : <ReadOnlyMailbox mailbox={drawer.mailbox} onClose={() => setDrawer(null)} />) : null}</Drawer></div>;
}
