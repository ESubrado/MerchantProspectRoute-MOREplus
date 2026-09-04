"use client";

import { useActionState, useEffect, useState } from "react";

import { createSequenceAction, type SequenceActionState } from "@/app/actions/sequences";
import { DataTable, TableCell, TableHead, TableHeader } from "@/components/domain/data-table";
import { MetricCard } from "@/components/domain/metric-card";
import { PageHeader } from "@/components/domain/page-header";
import { ScreenState } from "@/components/domain/screen-state";
import { StatusPill } from "@/components/domain/status-pill";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CampaignSequenceListItem } from "@/lib/sequences/sequences";

type SequenceAction = (previousState: SequenceActionState, formData: FormData) => Promise<SequenceActionState>;

type SequencesScreenProps = {
  campaignName: string;
  canManageSequences: boolean;
  sequences: CampaignSequenceListItem[];
};

const actionInitialState: SequenceActionState = { message: "", status: "idle" };

function sequenceStatus(status: CampaignSequenceListItem["status"]) {
  if (status === "active") return { label: "Active", tone: "success" as const };
  if (status === "paused") return { label: "Paused", tone: "warning" as const };
  if (status === "archived") return { label: "Archived", tone: "neutral" as const };
  return { label: "Draft", tone: "info" as const };
}

function updatedLabel(updatedAt: string) {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "Updated recently" : `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
}

function SequenceForm({ action, onComplete }: { action: SequenceAction; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(action, actionInitialState);

  useEffect(() => {
    if (state.status === "success") onComplete();
  }, [onComplete, state.status]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--ink-muted)]">
        This creates an inert draft inside the current campaign and gives it an empty campaign-owned schedule. It does not enroll contacts, route mail, or enable sending.
      </div>
      <Field label="Sequence name" hint="Unique within the current campaign; up to 160 characters.">
        <Input autoFocus maxLength={160} name="name" required />
      </Field>
      <Field label="Schedule timezone" hint="IANA timezone reserved for this sequence’s future sending windows.">
        <Input defaultValue="UTC" maxLength={100} name="scheduleTimezone" placeholder="Asia/Singapore" required />
      </Field>
      {state.status !== "idle" ? <p aria-live="polite" className={state.status === "error" ? "text-sm text-[var(--danger)]" : "text-sm text-[var(--success)]"}>{state.message}</p> : null}
      <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5">
        <Button disabled={pending} onClick={onComplete} type="button" variant="secondary">Cancel</Button>
        <Button disabled={pending} type="submit">{pending ? "Creating…" : "Create draft sequence"}</Button>
      </div>
    </form>
  );
}

/** The sequence screen scopes every visible sequence to the one resolved workspace campaign. */
export function SequencesScreen({ campaignName, canManageSequences, sequences }: SequencesScreenProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeSequenceCount = sequences.filter((sequence) => sequence.status === "active").length;
  const draftSequenceCount = sequences.filter((sequence) => sequence.status === "draft").length;
  const activeEnrollmentCount = sequences.reduce((total, sequence) => total + sequence.activeEnrollmentCount, 0);
  const configuredStepCount = sequences.reduce((total, sequence) => total + sequence.stepCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={canManageSequences ? <Button onClick={() => setDrawerOpen(true)}>New sequence</Button> : undefined}
        description="Manage the sequences in this workspace’s single campaign. Its campaign-owned mailboxes are one shared routing pool; delivery and routing remain disabled."
        eyebrow="Outreach / Current campaign"
        title="Sequences"
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard detail="in the current campaign" label="Active sequences" tone="positive" value={activeSequenceCount.toLocaleString()} />
        <MetricCard detail="safe to configure; no dispatch" label="Draft sequences" value={draftSequenceCount.toLocaleString()} />
        <MetricCard detail="database-enforced one active sequence per contact" label="Active enrollments" tone="teal" value={activeEnrollmentCount.toLocaleString()} />
        <MetricCard detail="variants and schedules remain inert" label="Configured steps" tone="attention" value={configuredStepCount.toLocaleString()} />
      </div>
      {!canManageSequences ? <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--ink-muted)]">Sequence creation is limited to workspace owners and admins. You can review the current campaign below.</p> : null}
      {sequences.length === 0 ? (
        <ScreenState
          action={canManageSequences ? <Button onClick={() => setDrawerOpen(true)}>New sequence</Button> : undefined}
          description={canManageSequences ? "Create the first inert draft sequence for this campaign. Step, variant, schedule-window, enrollment, routing, and delivery workflows remain deliberately separated from this boundary." : "No sequence records exist in the current campaign."}
          title="No sequences created"
          type="empty"
        />
      ) : (
        <DataTable label={`Sequences in ${campaignName}`}>
          <TableHeader><tr><TableHead>Sequence</TableHead><TableHead>Status</TableHead><TableHead>Steps</TableHead><TableHead>Active enrollments</TableHead><TableHead>Schedule timezone</TableHead></tr></TableHeader>
          <tbody className="divide-y divide-[var(--line)]">
            {sequences.map((sequence) => {
              const status = sequenceStatus(sequence.status);

              return <tr className="hover:bg-[var(--surface-subtle)]" key={sequence.id}>
                <TableCell><span className="block font-semibold text-[var(--ink)]">{sequence.name}</span><span className="block pt-0.5 text-xs text-[var(--ink-muted)]">{updatedLabel(sequence.updatedAt)}</span></TableCell>
                <TableCell><StatusPill tone={status.tone}>{status.label}</StatusPill></TableCell>
                <TableCell className="font-semibold text-[var(--ink)]">{sequence.stepCount.toLocaleString()}</TableCell>
                <TableCell className="font-semibold text-[var(--ink)]">{sequence.activeEnrollmentCount.toLocaleString()}</TableCell>
                <TableCell className="text-[var(--ink-muted)]">{sequence.scheduleTimezone}</TableCell>
              </tr>;
            })}
          </tbody>
        </DataTable>
      )}
      <Drawer description="Create a draft only in the current workspace campaign. No campaign switching or creation is available in this release." onClose={() => setDrawerOpen(false)} open={drawerOpen} title="New sequence">
        <SequenceForm action={createSequenceAction} onComplete={() => setDrawerOpen(false)} />
      </Drawer>
    </div>
  );
}
