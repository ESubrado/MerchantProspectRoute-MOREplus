"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createSequenceAction,
  deleteSequenceVariantAction,
  saveSequenceConfigurationAction,
  saveSequenceVariantAction,
  setSequenceStatusAction,
  type SequenceActionState,
} from "@/app/actions/sequences";
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
import type {
  CampaignSequenceListItem,
  CampaignSequenceStatus,
  CampaignSequenceVariant,
  SequenceScheduleWindow,
} from "@/lib/sequences/sequences";

type DrawerTarget = { mode: "create" } | { mode: "detail"; sequenceId: string } | null;

type SequencesScreenProps = {
  campaignName: string;
  canManageSequences: boolean;
  sequences: CampaignSequenceListItem[];
};

const actionInitialState: SequenceActionState = { message: "", status: "idle" };
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Selects the shared visual treatment for a database-owned lifecycle state. */
function sequenceStatus(status: CampaignSequenceStatus) {
  if (status === "active") return { label: "Active", tone: "success" as const };
  if (status === "paused") return { label: "Paused", tone: "warning" as const };
  if (status === "archived") return { label: "Archived", tone: "neutral" as const };
  return { label: "Draft", tone: "info" as const };
}

/** Formats an optional database timestamp without letting malformed values break the table. */
function updatedLabel(updatedAt: string) {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "Updated recently" : `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
}

/** Mirrors the direct-variant activation checklist while the database remains the transactional authority. */
function configurationReady(sequence: CampaignSequenceListItem) {
  return sequence.weeklyWindows.length > 0
    && sequence.variants.some((variant) => variant.subject.trim() && variant.body.trim());
}

/** Converts numeric weekday values from a schedule window into compact UI labels. */
function daysLabel(days: number[]) {
  return days.map((day) => weekdays[day] ?? "?").join(", ");
}

/** Produces the human-readable local-time label used in read-only configuration views. */
function windowLabel(window: SequenceScheduleWindow) {
  return `${daysLabel(window.days)} · ${window.startTime}–${window.endTime}`;
}

/** Renders accessible success and failure feedback shared by every configuration form. */
function ActionMessage({ state }: { state: SequenceActionState }) {
  if (state.status === "idle") return null;
  return <p aria-live="polite" className={state.status === "error" ? "text-sm text-[var(--danger)]" : "text-sm text-[var(--success)]"}>{state.message}</p>;
}

/** Creates the empty configuration draft that a manager can complete with schedule settings and direct variants. */
function SequenceCreateForm({ onComplete }: { onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(createSequenceAction, actionInitialState);

  useEffect(() => {
    if (state.status === "success") onComplete();
  }, [onComplete, state.status]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--ink-muted)]">
        This creates an empty configuration-only draft in the current campaign. Add template variants directly; it does not enroll contacts, choose a mailbox, route mail, schedule work, or send anything.
      </div>
      <Field label="Sequence name" hint="Unique within the current campaign; up to 160 characters.">
        <Input autoFocus maxLength={160} name="name" required />
      </Field>
      <Field label="Schedule timezone" hint="IANA timezone for future schedule windows.">
        <Input defaultValue="UTC" maxLength={100} name="scheduleTimezone" placeholder="Asia/Singapore" required />
      </Field>
      <ActionMessage state={state} />
      <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5">
        <Button disabled={pending} onClick={onComplete} type="button" variant="secondary">Cancel</Button>
        <Button disabled={pending} type="submit">{pending ? "Creating…" : "Create draft"}</Button>
      </div>
    </form>
  );
}

/** Edits schedule and future timing while configured campaign mailboxes remain the future capacity authority. */
function SequenceSettingsForm({ sequence }: { sequence: CampaignSequenceListItem }) {
  const [state, formAction, pending] = useActionState(saveSequenceConfigurationAction, actionInitialState);
  const [windows, setWindows] = useState<SequenceScheduleWindow[]>(sequence.weeklyWindows);

  const updateWindow = (index: number, update: Partial<SequenceScheduleWindow>) => {
    setWindows((current) => current.map((window, windowIndex) => windowIndex === index ? { ...window, ...update } : window));
  };

  const toggleDay = (windowIndex: number, day: number) => {
    const currentDays = windows[windowIndex]?.days ?? [];
    const nextDays = currentDays.includes(day) ? currentDays.filter((candidate) => candidate !== day) : [...currentDays, day].sort((left, right) => left - right);
    updateWindow(windowIndex, { days: nextDays });
  };

  return (
    <form action={formAction} className="space-y-6">
      <input name="sequenceId" type="hidden" value={sequence.id} />
      <input name="weeklyWindows" type="hidden" value={JSON.stringify(windows)} />
      <section className="space-y-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgb(19_33_45/0.04)] sm:p-6">
        <div>
          <p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Sequence settings</p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">These are durable rules for a future scheduler. This form saves schedule and timing only; template variants have their own save buttons below. Future delivery capacity comes from configured campaign mailboxes and their policies. Saving never starts automation.</p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <div className="grid gap-4">
            <Field label="Sequence name"><Input defaultValue={sequence.name} maxLength={160} name="name" required /></Field>
            <Field label="Schedule timezone" hint="IANA timezone used to interpret weekly windows."><Input defaultValue={sequence.scheduleTimezone} maxLength={100} name="scheduleTimezone" required /></Field>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4">
            <Field label="Jitter" hint="Future randomized delay; 0 to 1,440 minutes."><Input defaultValue={sequence.jitterMaxMinutes} max={1440} min={0} name="jitterMaxMinutes" required step={1} type="number" /></Field>
          </div>
        </div>
      </section>

      <section className="space-y-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgb(19_33_45/0.04)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Weekly windows</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Windows cannot overlap on the same weekday. A draft may remain empty; activation cannot.</p>
          </div>
          <Button className="shrink-0 whitespace-nowrap" onClick={() => setWindows((current) => [...current, { days: [1, 2, 3, 4, 5], endTime: "17:00", startTime: "09:00" }])} size="sm" type="button" variant="secondary"><PlusIcon className="size-3.5" />Add window</Button>
        </div>
        {windows.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-3 text-sm text-[var(--ink-muted)]">No sending windows saved. This sequence cannot be activated yet.</p> : null}
        <div className="grid gap-3 xl:grid-cols-2">
          {windows.map((window, index) => (
            <div className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4" key={`${index}-${window.startTime}-${window.endTime}`}>
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-[var(--ink)]">Window {index + 1}</span><Button aria-label={`Remove window ${index + 1}`} onClick={() => setWindows((current) => current.filter((_, windowIndex) => windowIndex !== index))} size="sm" type="button" variant="ghost">Remove</Button></div>
              <fieldset>
                <legend className="text-sm font-semibold text-[var(--ink)]">Weekdays</legend>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                  {weekdays.map((label, day) => <label className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink)]" key={label}><input checked={window.days.includes(day)} className="size-4 accent-[var(--primary)]" onChange={() => toggleDay(index, day)} type="checkbox" />{label}</label>)}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start"><Input onChange={(event) => updateWindow(index, { startTime: event.target.value })} type="time" value={window.startTime} /></Field>
                <Field label="End"><Input onChange={(event) => updateWindow(index, { endTime: event.target.value })} type="time" value={window.endTime} /></Field>
              </div>
            </div>
          ))}
        </div>
      </section>
      <ActionMessage state={state} />
      <div className="flex justify-end border-t border-[var(--line)] pt-5"><Button disabled={pending} type="submit">{pending ? "Saving…" : "Save schedule & timing only"}</Button></div>
    </form>
  );
}

/** Provides one direct create-or-update form and refreshes the database-backed variant projection after success. */
function VariantForm({ onSuccess, sequenceId, variant }: { onSuccess?: () => void; sequenceId: string; variant?: CampaignSequenceVariant }) {
  const [state, formAction, pending] = useActionState(saveSequenceVariantAction, actionInitialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      onSuccess?.();
      router.refresh();
    }
  }, [onSuccess, router, state.status]);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgb(19_33_45/0.04)]">
      <input name="sequenceId" type="hidden" value={sequenceId} />
      <input name="variantId" type="hidden" value={variant?.id ?? ""} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(11rem,0.38fr)_minmax(0,1fr)]">
        <Field label="Variant key" hint="For example: a or followup_b."><Input defaultValue={variant?.variantKey ?? "a"} maxLength={32} name="variantKey" required /></Field>
        <Field label="Subject"><Input defaultValue={variant?.subject ?? ""} maxLength={250} name="subject" required /></Field>
      </div>
      <Field label="Template body" hint="Stored as a provider-neutral template; no rendering or delivery is enabled."><Textarea defaultValue={variant?.body ?? ""} maxLength={20000} name="body" required rows={5} /></Field>
      <ActionMessage state={state} />
      <div className="flex justify-end"><Button disabled={pending} size="sm" type="submit">{pending ? "Saving…" : variant ? "Save template variant" : "Add template variant"}</Button></div>
    </form>
  );
}

/** Keeps unsaved template fields out of the sequence until a manager explicitly chooses to add one. */
function AddVariantForm({ sequenceId }: { sequenceId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!open) return <Button onClick={() => setOpen(true)} size="sm" type="button" variant="secondary"><PlusIcon className="size-3.5" />Add template variant</Button>;

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-subtle)] p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-[var(--ink)]">New template variant</p><Button onClick={close} size="sm" type="button" variant="ghost">Cancel</Button></div>
      <VariantForm onSuccess={close} sequenceId={sequenceId} />
    </div>
  );
}

/** Isolates a direct variant deletion and refreshes the database-backed projection after success. */
function DeleteVariantForm({ sequenceId, variantId }: { sequenceId: string; variantId: string }) {
  const [state, formAction, pending] = useActionState(deleteSequenceVariantAction, actionInitialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return <form action={formAction} className="inline-flex"><input name="sequenceId" type="hidden" value={sequenceId} /><input name="variantId" type="hidden" value={variantId} /><Button disabled={pending} size="sm" type="submit" variant="ghost">Delete variant</Button>{state.status === "error" ? <span className="sr-only" role="status">{state.message}</span> : null}</form>;
}

/** Presents saved direct variants and keeps creation opt-in so an empty draft stays empty. */
function SequenceVariantsEditor({ sequence }: { sequence: CampaignSequenceListItem }) {
  return (
    <section className="space-y-5 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] p-4 sm:p-6">
      <div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Template variants</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Saved variants appear below. To create another, click Add template variant. Schedule and timing saves do not submit template fields.</p></div>
      {sequence.variants.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-3 text-sm text-[var(--ink-muted)]">No template variants saved. Add one before activating this sequence.</p> : <div className="space-y-4">{sequence.variants.map((variant) => <div className="space-y-2" key={variant.id}><VariantForm sequenceId={sequence.id} variant={variant} /><div className="flex justify-end"><DeleteVariantForm sequenceId={sequence.id} variantId={variant.id} /></div></div>)}</div>}
      <AddVariantForm sequenceId={sequence.id} />
    </section>
  );
}

/** Presents only lifecycle transitions that the database will accept for the current state. */
function statusOptions(status: CampaignSequenceStatus) {
  if (status === "draft") return [{ label: "Activate configuration", value: "active" }, { label: "Archive", value: "archived" }];
  if (status === "active") return [{ label: "Pause for editing", value: "paused" }, { label: "Archive", value: "archived" }];
  if (status === "paused") return [{ label: "Return to draft", value: "draft" }, { label: "Activate configuration", value: "active" }, { label: "Archive", value: "archived" }];
  return [];
}

/** Lets a manager pause, archive, draft, or validate-activate a configuration without implying dispatch. */
function SequenceStatusControl({ sequence }: { sequence: CampaignSequenceListItem }) {
  const [state, formAction, pending] = useActionState(setSequenceStatusAction, actionInitialState);
  const options = statusOptions(sequence.status);
  if (options.length === 0) return <p className="text-sm text-[var(--ink-muted)]">Archived sequences are retained as read-only configuration records.</p>;

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgb(19_33_45/0.04)]">
      <input name="sequenceId" type="hidden" value={sequence.id} />
      <div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase">Configuration state</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Active means the draft passes configuration checks only. Automation is not configured, so active never dispatches.</p></div>
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-52 flex-1"><Field label="Change state"><Select name="status">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field></div><Button disabled={pending} type="submit" variant="secondary">{pending ? "Updating…" : "Update state"}</Button></div>
      <ActionMessage state={state} />
    </form>
  );
}

/** Shows a member-safe or active/archived configuration summary with no mutation controls. */
function SequenceReadOnly({ sequence, onClose, showAutomationMessage = true }: { sequence: CampaignSequenceListItem; onClose?: () => void; showAutomationMessage?: boolean }) {
  return (
    <div className="space-y-6">
      {showAutomationMessage ? <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--ink-muted)]">Automation is not configured. This page stores configuration only; it cannot enroll contacts, route a mailbox, schedule work, or send email.</div> : null}
      <dl className="grid gap-4 text-sm">
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">State</dt><dd className="mt-1"><StatusPill tone={sequenceStatus(sequence.status).tone}>{sequenceStatus(sequence.status).label}</StatusPill></dd></div>
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Schedule</dt><dd className="mt-1 leading-6 text-[var(--ink)]">{sequence.scheduleTimezone} · {sequence.weeklyWindows.length ? sequence.weeklyWindows.map(windowLabel).join("; ") : "No weekly windows"}</dd></div>
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Future timing</dt><dd className="mt-1 text-[var(--ink)]">Up to {sequence.jitterMaxMinutes.toLocaleString()} minutes jitter. Future delivery capacity is determined by configured campaign mailboxes and their policies.</dd></div>
        <div><dt className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Template variants</dt><dd className="mt-1 space-y-2 text-[var(--ink)]">{sequence.variants.length ? sequence.variants.map((variant) => <p key={variant.id}>{variant.variantKey} · {variant.subject}</p>) : "No saved template variants"}</dd></div>
      </dl>
      {onClose ? <div className="flex justify-end border-t border-[var(--line)] pt-5"><Button onClick={onClose} variant="secondary">Close</Button></div> : null}
    </div>
  );
}

/** Composes state controls with editable draft/paused configuration or an active/archived read-only summary. */
function SequenceEditor({ sequence }: { sequence: CampaignSequenceListItem }) {
  const editable = sequence.status === "draft" || sequence.status === "paused";
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        {editable ? <><SequenceSettingsForm key={`${sequence.id}-${sequence.updatedAt}`} sequence={sequence} /><SequenceVariantsEditor sequence={sequence} /></> : <SequenceReadOnly sequence={sequence} showAutomationMessage={false} />}
      </div>
      <aside className="space-y-4 xl:sticky xl:top-0">
        <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--ink-muted)]"><span className="font-semibold text-[var(--ink)]">Automation not configured.</span> This configuration has no enrollment state machine, routing, provider adapter, scheduler, queue, or sending path.</div>
        <SequenceStatusControl sequence={sequence} />
      </aside>
    </div>
  );
}

/** Campaign-scoped sequence configuration with direct variants and intentionally no enrollment or dispatch metrics. */
export function SequencesScreen({ campaignName, canManageSequences, sequences }: SequencesScreenProps) {
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const selectedSequence = drawer?.mode === "detail" ? sequences.find((sequence) => sequence.id === drawer.sequenceId) ?? null : null;
  const activeConfigurationCount = sequences.filter((sequence) => sequence.status === "active").length;
  const readyConfigurationCount = sequences.filter(configurationReady).length;
  const pausedCount = sequences.filter((sequence) => sequence.status === "paused").length;
  const totalVariantCount = sequences.reduce((total, sequence) => total + sequence.variants.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader actions={canManageSequences ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />New sequence</Button> : undefined} description="Configure this workspace’s single campaign sequences, schedules, timing, and template variants. Future email capacity is determined by configured campaign mailboxes; automation is not configured yet." eyebrow="Outreach / Current campaign" title="Sequences" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard detail="passes no dispatch implication" label="Active configurations" tone="positive" value={activeConfigurationCount.toLocaleString()} />
        <MetricCard detail="windows and complete variants" label="Activation-ready" value={readyConfigurationCount.toLocaleString()} />
        <MetricCard detail="safe to edit before reactivation" label="Paused configurations" tone="attention" value={pausedCount.toLocaleString()} />
        <MetricCard detail="stored only; never rendered or sent" label="Template variants" tone="teal" value={totalVariantCount.toLocaleString()} />
      </div>
      <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--surface-subtle)] px-4 py-3 text-sm leading-6 text-[var(--ink-muted)]"><span className="font-semibold text-[var(--ink)]">Automation not configured:</span> activation validates configuration only. Routing, enrollment state transitions, the provider adapter, scheduler, queue, and dispatch are intentionally absent.</div>
      {!canManageSequences ? <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--ink-muted)]">Sequence configuration is limited to workspace owners and admins. You can review the current campaign below.</p> : null}
      {sequences.length === 0 ? (
        <ScreenState action={canManageSequences ? <Button onClick={() => setDrawer({ mode: "create" })}><PlusIcon className="size-4" />New sequence</Button> : undefined} description={canManageSequences ? "Create a draft, then configure its weekly windows, timing, and template variants. Configured campaign mailboxes will determine future delivery capacity; no delivery workflow is available." : "No sequence records exist in the current campaign."} title="No sequences created" type="empty" />
      ) : (
        <DataTable label={`Sequences in ${campaignName}`}>
          <TableHeader><tr><TableHead>Sequence</TableHead><TableHead>State</TableHead><TableHead>Configuration</TableHead><TableHead>Schedule and timing</TableHead><TableHead>Automation</TableHead><TableHead className="w-12"><span className="sr-only">Open sequence</span></TableHead></tr></TableHeader>
          <tbody className="divide-y divide-[var(--line)]">
            {sequences.map((sequence) => {
              const state = sequenceStatus(sequence.status);
              return <tr className="transition-colors hover:bg-[var(--surface-subtle)]" key={sequence.id}>
                <TableCell><button className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => setDrawer({ mode: "detail", sequenceId: sequence.id })} type="button"><span className="block font-semibold text-[var(--ink)]">{sequence.name}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{updatedLabel(sequence.updatedAt)}</span></button></TableCell>
                <TableCell><StatusPill tone={state.tone}>{state.label}</StatusPill></TableCell>
                <TableCell><span className="block font-semibold text-[var(--ink)]">{sequence.variants.length} {sequence.variants.length === 1 ? "variant" : "variants"}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{configurationReady(sequence) ? "Ready to validate for activation" : "Configuration incomplete"}</span></TableCell>
                <TableCell><span className="block font-medium text-[var(--ink)]">{sequence.weeklyWindows.length} weekly {sequence.weeklyWindows.length === 1 ? "window" : "windows"} · {sequence.scheduleTimezone}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">Up to {sequence.jitterMaxMinutes.toLocaleString()}m jitter · mailbox policies set future capacity</span></TableCell>
                <TableCell className="text-[var(--ink-muted)]">Not configured</TableCell>
                <TableCell><Button aria-label={`Open ${sequence.name}`} onClick={() => setDrawer({ mode: "detail", sequenceId: sequence.id })} size="icon" variant="ghost"><MoreIcon className="size-4" /></Button></TableCell>
              </tr>;
            })}
          </tbody>
        </DataTable>
      )}
      <Drawer description={drawer?.mode === "create" ? "Create a campaign-owned draft only. It cannot start automation." : "Review configuration and, for owners and admins, edit the inactive draft or pause an active configuration first."} onClose={() => setDrawer(null)} open={drawer !== null} size={drawer?.mode === "detail" ? "wide" : "default"} title={drawer?.mode === "create" ? "New sequence" : selectedSequence?.name ?? "Sequence"}>
        {drawer?.mode === "create" ? <SequenceCreateForm onComplete={() => setDrawer(null)} /> : null}
        {selectedSequence ? (canManageSequences ? <SequenceEditor key={selectedSequence.id} sequence={selectedSequence} /> : <SequenceReadOnly onClose={() => setDrawer(null)} sequence={selectedSequence} />) : null}
      </Drawer>
    </div>
  );
}
