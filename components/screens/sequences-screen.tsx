"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  archiveSequenceAction,
  createSequenceAction,
  deleteSequenceAction,
  deleteSequenceVariantAction,
  saveSequenceConfigurationAction,
  saveSequenceVariantAction,
  setCampaignStatusAction,
  type SequenceActionState,
} from "@/app/actions/sequences";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { ScreenState } from "@/components/domain/screen-state";
import { StatusPill } from "@/components/domain/status-pill";
import { ChevronDownIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  CampaignSequenceListItem,
  CampaignSequenceStatus,
  CampaignSequenceVariant,
  SequenceScheduleWindow,
} from "@/lib/sequences/sequences";

type DrawerTarget = { mode: "create" } | { mode: "detail" | "remove"; sequenceId: string } | null;

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

/** Identifies lifecycle states in which managers may safely edit or remove a step. */
function stepIsEditable(sequence: CampaignSequenceListItem) {
  return sequence.status === "draft" || sequence.status === "paused";
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

/** Creates the next database-numbered Step N draft that a manager can complete with schedule settings and direct variants. */
function SequenceCreateForm({ onComplete }: { onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(createSequenceAction, actionInitialState);

  useEffect(() => {
    if (state.status === "success") onComplete();
  }, [onComplete, state.status]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--ink-muted)]">
        This creates the next configuration-only step in the current campaign, automatically named Step 1, Step 2, and so on. After creating it, expand its variants row to add template variants; it does not enroll contacts, choose a mailbox, route mail, schedule work, or send anything.
      </div>
      <Field label="Schedule timezone" hint="IANA timezone for future schedule windows.">
        <Input autoFocus defaultValue="UTC" maxLength={100} name="scheduleTimezone" placeholder="Asia/Singapore" required />
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
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">These are durable rules for a future scheduler. This form saves schedule and timing only; manage template variants from the expandable row beneath this step. Future delivery capacity comes from configured campaign mailboxes and their policies. Saving never starts automation.</p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <div className="grid gap-4">
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
      {variant ? <p className="text-sm font-semibold text-[var(--ink)]">Variant {variant.variantKey.toUpperCase()}</p> : <p className="text-sm leading-6 text-[var(--ink-muted)]">The database assigns the next variant label automatically when you save.</p>}
      <Field label="Subject"><Input defaultValue={variant?.subject ?? ""} maxLength={250} name="subject" required /></Field>
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
    <div className="w-full space-y-3 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-subtle)] p-3 lg:w-3/4 sm:p-4">
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

  return <form action={formAction} className="inline-flex"><input name="sequenceId" type="hidden" value={sequenceId} /><input name="variantId" type="hidden" value={variantId} /><Button disabled={pending} size="sm" type="submit" variant="danger">Delete variant</Button>{state.status === "error" ? <span className="sr-only" role="status">{state.message}</span> : null}</form>;
}

/** Requires an explicit confirmation before removing an editable Step N record and closing its drawer after success. */
function RemoveStepControl({ initiallyConfirming = false, onCancel, onRemoved, sequence }: { initiallyConfirming?: boolean; onCancel?: () => void; onRemoved: () => void; sequence: CampaignSequenceListItem }) {
  const [confirming, setConfirming] = useState(initiallyConfirming);
  const [state, formAction, pending] = useActionState(deleteSequenceAction, actionInitialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      onRemoved();
      router.refresh();
    }
  }, [onRemoved, router, state.status]);

  if (!confirming) return <Button onClick={() => setConfirming(true)} size="sm" type="button" variant="ghost">Remove step</Button>;

  return (
    <section aria-labelledby={`remove-step-${sequence.id}`} className="space-y-3 rounded-xl border border-[var(--danger)] bg-[var(--surface)] p-4">
      <div><p className="font-semibold text-[var(--ink)]" id={`remove-step-${sequence.id}`}>Remove {sequence.name}?</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">This permanently removes its schedule and {sequence.variants.length} saved template {sequence.variants.length === 1 ? "variant" : "variants"}. A step with enrollment history cannot be removed. Remaining generated Step N labels will be compacted.</p></div>
      <form action={formAction} className="flex flex-wrap items-center justify-end gap-2"><input name="sequenceId" type="hidden" value={sequence.id} /><Button disabled={pending} onClick={() => { setConfirming(false); onCancel?.(); }} size="sm" type="button" variant="secondary">Cancel</Button><Button disabled={pending} size="sm" type="submit" variant="danger">{pending ? "Removing…" : "Remove step"}</Button></form>
      <ActionMessage state={state} />
    </section>
  );
}

/** Renders one direct variant as a compact table row, opening the full editor only when a manager requests it. */
function VariantTableRows({ canManageVariants, sequenceId, variant }: { canManageVariants: boolean; sequenceId: string; variant: CampaignSequenceVariant }) {
  const [editing, setEditing] = useState(false);
  const editorId = "variant-editor-" + variant.id;
  const closeEditor = useCallback(() => setEditing(false), []);

  return (
    <>
      <tr className="transition-colors hover:bg-[var(--surface-subtle)]">
        <TableCell><span className="font-semibold text-[var(--ink)]">Variant {variant.variantKey.toUpperCase()}</span></TableCell>
        <TableCell className="max-w-xs whitespace-normal"><span className="font-medium text-[var(--ink)]">{variant.subject}</span></TableCell>
        <TableCell className="max-w-md text-[var(--ink-muted)]"><span className="block truncate" title={variant.body}>{variant.body}</span></TableCell>
        <TableCell className="w-40"><div className="flex items-center justify-end gap-1.5">{canManageVariants ? <><Button aria-controls={editorId} aria-expanded={editing} onClick={() => setEditing((current) => !current)} size="sm" type="button" variant="secondary">{editing ? "Close" : "Edit"}</Button><DeleteVariantForm sequenceId={sequenceId} variantId={variant.id} /></> : <span className="text-xs text-[var(--ink-muted)]">Read-only</span>}</div></TableCell>
      </tr>
      {editing ? <tr className="bg-[var(--surface-subtle)]"><TableCell className="whitespace-normal" colSpan={4}><div className="variant-editor-enter"><div className="variant-editor-motion-content border-t border-[var(--line)] py-4" id={editorId}><VariantForm onSuccess={closeEditor} sequenceId={sequenceId} variant={variant} /></div></div></TableCell></tr> : null}
    </>
  );
}

/** Keeps direct variants with their owning step while preserving manager-only writes and read-only review. */
function SequenceVariantsDropdown({ canManageSequences, sequence, sectionId }: { canManageSequences: boolean; sequence: CampaignSequenceListItem; sectionId: string }) {
  const canManageVariants = canManageSequences && stepIsEditable(sequence);
  const immutableMessage = sequence.status === "active"
    ? "Pause the campaign before changing template variants."
    : sequence.status === "archived"
      ? "Archived step variants are retained as read-only configuration records."
      : "Only workspace owners and admins can change template variants.";

  return (
    <section aria-labelledby={`${sectionId}-title`} className="space-y-4" id={sectionId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold tracking-wide text-[var(--teal)] uppercase" id={`${sectionId}-title`}>Template variants</p><p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Database-assigned labels stay with this step in creation order: A, B, C, and so on. Add, edit, or remove variants here; schedule settings remain in the step drawer.</p></div>
        {canManageVariants ? <AddVariantForm sequenceId={sequence.id} /> : null}
      </div>
      {sequence.variants.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-3 text-sm text-[var(--ink-muted)]">No template variants saved. Add one before activating this step.</p> : <DataTable label={`Template variants for ${sequence.name}`}><TableHeader><tr><TableHead>Variant</TableHead><TableHead>Subject</TableHead><TableHead>Template body</TableHead><TableHead className="w-40"><span className="sr-only">Variant actions</span></TableHead></tr></TableHeader><tbody className="divide-y divide-[var(--line)]">{sequence.variants.map((variant) => <VariantTableRows canManageVariants={canManageVariants} key={variant.id} sequenceId={sequence.id} variant={variant} />)}</tbody></DataTable>}
      {!canManageVariants ? <p className="text-sm text-[var(--ink-muted)]">{immutableMessage}</p> : null}
    </section>
  );
}

/** Couples each expandable direct-variant panel to the visual row of its owning Step N record. */
function SequenceTableRows({ canManageSequences, onConfigure, onRemove, sequence }: { canManageSequences: boolean; onConfigure: () => void; onRemove: () => void; sequence: CampaignSequenceListItem }) {
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [variantsClosing, setVariantsClosing] = useState(false);
  const state = sequenceStatus(sequence.status);
  const variantsSectionId = `sequence-variants-${sequence.id}`;
  const variantsVisible = variantsOpen || variantsClosing;

  function toggleVariants() {
    if (!variantsOpen) {
      setVariantsClosing(false);
      setVariantsOpen(true);
      return;
    }

    setVariantsOpen(false);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setVariantsClosing(true);
  }

  return (
    <>
      <tr className="transition-colors hover:bg-[var(--surface-subtle)]">
        <TableCell className="w-12 px-3"><button aria-controls={variantsSectionId} aria-expanded={variantsOpen} aria-label={`${variantsOpen ? "Hide" : "Show"} variants for ${sequence.name}`} className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--primary)] transition-colors hover:bg-[var(--primary-soft)] hover:text-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={toggleVariants} title={`${variantsOpen ? "Hide" : "Show"} variants`} type="button"><ChevronDownIcon className={`size-4 transition-transform ${variantsOpen ? "rotate-180" : ""}`} /></button></TableCell>
        <TableCell><button className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={onConfigure} type="button"><span className="block font-semibold text-[var(--ink)]">{sequence.name}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{updatedLabel(sequence.updatedAt)}</span></button></TableCell>
        <TableCell><StatusPill tone={state.tone}>{state.label}</StatusPill></TableCell>
        <TableCell><span className="block font-semibold text-[var(--ink)]">{sequence.variants.length} {sequence.variants.length === 1 ? "variant" : "variants"}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{configurationReady(sequence) ? "Ready to validate for activation" : "Configuration incomplete"}</span></TableCell>
        <TableCell><span className="block font-medium text-[var(--ink)]">{sequence.weeklyWindows.length} weekly {sequence.weeklyWindows.length === 1 ? "window" : "windows"} · {sequence.scheduleTimezone}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">Up to {sequence.jitterMaxMinutes.toLocaleString()}m jitter · mailbox policies set future capacity</span></TableCell>
        <TableCell className="text-[var(--ink-muted)]">Not configured</TableCell>
        <TableCell><div className="flex items-center justify-end gap-1.5">{canManageSequences && stepIsEditable(sequence) ? <Button aria-label={`Remove ${sequence.name}`} onClick={onRemove} size="sm" variant="danger">Remove</Button> : null}<Button aria-label={`Configure ${sequence.name}`} onClick={onConfigure} size="icon" variant="ghost"><MoreIcon className="size-4" /></Button></div></TableCell>
      </tr>
      {variantsVisible ? <tr className="bg-[var(--surface-subtle)]"><TableCell className="whitespace-normal p-0" colSpan={7}><div className={variantsClosing ? "sequence-variants-exit" : "sequence-variants-enter"} onAnimationEnd={(event) => { if (variantsClosing && event.target === event.currentTarget) setVariantsClosing(false); }}><div className="sequence-variants-motion-content px-4 py-4 sm:px-6"><SequenceVariantsDropdown canManageSequences={canManageSequences} sectionId={variantsSectionId} sequence={sequence} /></div></div></TableCell></tr> : null}
    </>
  );
}

/** Names the one campaign-wide lifecycle transition based on every non-archived step. */
function primaryCampaignAction(sequences: CampaignSequenceListItem[]) {
  const mutableStepCount = sequences.filter((sequence) => sequence.status !== "archived").length;
  if (mutableStepCount === 0) return null;
  if (sequences.some((sequence) => sequence.status === "active")) return { description: "Pause every active step so campaign configuration can be edited.", label: "Pause campaign", pendingLabel: "Pausing campaign…", status: "paused" as const };
  if (sequences.some((sequence) => sequence.status === "paused")) return { description: `Validate all ${mutableStepCount} non-archived steps. Each needs a weekly window and a complete subject/body variant. Automation remains disabled.`, label: "Resume campaign", pendingLabel: "Resuming campaign…", status: "active" as const };
  if (sequences.some((sequence) => sequence.status === "draft")) return { description: `Validate all ${mutableStepCount} non-archived steps. Each needs a weekly window and a complete subject/body variant. Automation remains disabled.`, label: "Launch campaign", pendingLabel: "Launching campaign…", status: "active" as const };
  return null;
}

/** Presents one campaign-level action rather than a per-step lifecycle control. */
function CampaignStatusControl({ action }: { action: NonNullable<ReturnType<typeof primaryCampaignAction>> }) {
  const [state, formAction, pending] = useActionState(setCampaignStatusAction, actionInitialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <span className="max-w-64 text-right text-xs leading-5 text-[var(--ink-muted)]">{action.description}</span>
      <Button disabled={pending} name="status" type="submit" value={action.status}>{pending ? action.pendingLabel : action.label}</Button>
      <ActionMessage state={state} />
    </form>
  );
}

/** Keeps per-step archiving separate from the campaign-wide lifecycle. */
function ArchiveStepControl({ sequence }: { sequence: CampaignSequenceListItem }) {
  const [state, formAction, pending] = useActionState(archiveSequenceAction, actionInitialState);
  if (sequence.status === "archived") return <p className="text-sm text-[var(--ink-muted)]">Archived steps are retained as read-only configuration records.</p>;

  return <form action={formAction} className="space-y-2"><input name="sequenceId" type="hidden" value={sequence.id} /><Button disabled={pending} name="status" size="sm" type="submit" value="archived" variant="ghost">Archive step</Button><ActionMessage state={state} /></form>;
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
      </dl>
      {onClose ? <div className="flex justify-end border-t border-[var(--line)] pt-5"><Button onClick={onClose} variant="secondary">Close</Button></div> : null}
    </div>
  );
}

/** Composes state controls with editable draft/paused configuration or an active/archived read-only summary. */
function SequenceEditor({ onRemoved, sequence }: { onRemoved: () => void; sequence: CampaignSequenceListItem }) {
  const editable = stepIsEditable(sequence);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        {editable ? <SequenceSettingsForm key={`${sequence.id}-${sequence.updatedAt}`} sequence={sequence} /> : <SequenceReadOnly sequence={sequence} showAutomationMessage={false} />}
      </div>
      <aside className="space-y-4 xl:sticky xl:top-0">
        <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--ink-muted)]"><span className="font-semibold text-[var(--ink)]">Automation not configured.</span> This configuration has no enrollment state machine, routing, provider adapter, scheduler, queue, or sending path.</div>
        <ArchiveStepControl sequence={sequence} />
        {editable ? <RemoveStepControl onRemoved={onRemoved} sequence={sequence} /> : null}
      </aside>
    </div>
  );
}

/** Campaign-scoped sequence configuration with direct variants and intentionally no enrollment or dispatch metrics. */
export function SequencesScreen({ campaignName, canManageSequences, sequences }: SequencesScreenProps) {
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const openDrawer = useCallback((target: Exclude<DrawerTarget, null>) => {
    setDrawerClosing(false);
    setDrawer(target);
  }, []);
  const closeDrawer = useCallback(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDrawerClosing(false);
      setDrawer(null);
      return;
    }

    setDrawerClosing(true);
  }, []);
  const completeDrawerClose = useCallback(() => {
    setDrawerClosing(false);
    setDrawer(null);
  }, []);
  const selectedSequence = drawer?.mode === "detail" || drawer?.mode === "remove" ? sequences.find((sequence) => sequence.id === drawer.sequenceId) ?? null : null;
  const campaignAction = primaryCampaignAction(sequences);
  const activeConfigurationCount = sequences.filter((sequence) => sequence.status === "active").length;
  const campaignIsRunning = activeConfigurationCount > 0;
  const canCreateStep = canManageSequences && !campaignIsRunning;
  const readyConfigurationCount = sequences.filter(configurationReady).length;
  const pausedCount = sequences.filter((sequence) => sequence.status === "paused").length;
  const totalVariantCount = sequences.reduce((total, sequence) => total + sequence.variants.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader actions={canManageSequences && campaignAction ? <CampaignStatusControl action={campaignAction} /> : undefined} description="Configure this workspace’s single campaign sequences, schedules, timing, and template variants. Future email capacity is determined by configured campaign mailboxes; automation is not configured yet." eyebrow="Outreach / Current campaign" title="Sequences" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard detail="passes no dispatch implication" label="Active configurations" tone="positive" value={activeConfigurationCount.toLocaleString()} />
        <MetricCard detail="windows and complete variants" label="Activation-ready" value={readyConfigurationCount.toLocaleString()} />
        <MetricCard detail="safe to edit before reactivation" label="Paused configurations" tone="attention" value={pausedCount.toLocaleString()} />
        <MetricCard detail="stored only; never rendered or sent" label="Template variants" tone="teal" value={totalVariantCount.toLocaleString()} />
      </div>
      <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--surface-subtle)] px-4 py-3 text-sm leading-6 text-[var(--ink-muted)]"><span className="font-semibold text-[var(--ink)]">Automation not configured:</span> activation validates configuration only. Routing, enrollment state transitions, the provider adapter, scheduler, queue, and dispatch are intentionally absent.</div>
      {!canManageSequences ? <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--ink-muted)]">Sequence configuration is limited to workspace owners and admins. You can review the current campaign below.</p> : null}
      {sequences.length === 0 ? (
        <ScreenState action={canCreateStep ? <Button onClick={() => openDrawer({ mode: "create" })}><PlusIcon className="size-4" />New step</Button> : undefined} description={canManageSequences ? "Create a step, then configure its weekly windows, timing, and template variants. Configured campaign mailboxes will determine future delivery capacity; no delivery workflow is available." : "No sequence records exist in the current campaign."} title="No sequences created" type="empty" />
      ) : (
        <div className="space-y-4">
        <DataTable label={`Sequences in ${campaignName}`}>
          <TableHeader><tr><TableHead className="w-12 px-3"><span className="sr-only">Show template variants</span></TableHead><TableHead>Sequence</TableHead><TableHead>State</TableHead><TableHead>Configuration</TableHead><TableHead>Schedule and timing</TableHead><TableHead>Automation</TableHead><TableHead className="w-32"><span className="sr-only">Sequence actions</span></TableHead></tr></TableHeader>
          <tbody className="divide-y divide-[var(--line)]">
            {sequences.map((sequence) => <SequenceTableRows canManageSequences={canManageSequences} key={sequence.id} onConfigure={() => openDrawer({ mode: "detail", sequenceId: sequence.id })} onRemove={() => openDrawer({ mode: "remove", sequenceId: sequence.id })} sequence={sequence} />)}
          </tbody>
        </DataTable>
        {canManageSequences ? (
          campaignIsRunning
            ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[var(--ink-muted)]">Pause the active campaign before adding another step.</p><Button disabled><PlusIcon className="size-4" />New step</Button></div>
            : <div className="flex justify-end"><Button onClick={() => openDrawer({ mode: "create" })}><PlusIcon className="size-4" />New step</Button></div>
        ) : null}
        </div>
      )}
      <Drawer closing={drawerClosing} description={drawer?.mode === "create" ? "Create a campaign-owned step only. It cannot start automation." : drawer?.mode === "remove" ? "Confirm permanent removal of this draft or paused step. Enrollment history is always preserved." : "Review configuration and, for owners and admins, edit the inactive draft or pause an active configuration first."} onClose={closeDrawer} onCloseComplete={completeDrawerClose} open={drawer !== null} size={drawer?.mode === "detail" ? "wide" : "default"} title={drawer?.mode === "create" ? "New step" : drawer?.mode === "remove" ? `Remove ${selectedSequence?.name ?? "step"}` : selectedSequence?.name ?? "Sequence"}>
        {drawer?.mode === "create" ? <SequenceCreateForm onComplete={closeDrawer} /> : null}
        {drawer?.mode === "detail" && selectedSequence ? (canManageSequences ? <SequenceEditor key={selectedSequence.id} onRemoved={closeDrawer} sequence={selectedSequence} /> : <SequenceReadOnly onClose={closeDrawer} sequence={selectedSequence} />) : null}
        {drawer?.mode === "remove" && selectedSequence && canManageSequences ? <RemoveStepControl initiallyConfirming onCancel={closeDrawer} onRemoved={closeDrawer} sequence={selectedSequence} /> : null}
      </Drawer>
    </div>
  );
}
