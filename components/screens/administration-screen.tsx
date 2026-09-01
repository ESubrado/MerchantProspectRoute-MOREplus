import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/page-header";
import { ScreenState } from "@/components/domain/screen-state";

export function AdministrationScreen() {
  return (
    <div className="space-y-6">
      <PageHeader actions={<Button>Save workspace</Button>} description="Administrative controls are visually separate from CRM and outreach work. This screen also makes the standard empty, loading and error patterns visible for review." eyebrow="Administration / Workspace" title="Workspace controls" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <Card>
          <CardHeader><CardTitle>Workspace profile</CardTitle><CardDescription>Form controls keep labels, constraints and the save boundary stable. Persistence is not connected in this prototype.</CardDescription></CardHeader>
          <CardContent className="grid gap-5"><Field label="Workspace name"><Input defaultValue="Harborline" /></Field><Field hint="This setting will control the local-day boundary for delivery policies." label="Operating timezone"><Input defaultValue="America/New_York" /></Field><div className="flex justify-end gap-2 border-t border-[var(--line)] pt-5"><Button variant="secondary">Discard</Button><Button disabled>Save changes</Button></div></CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Access boundary</CardTitle><CardDescription>The header exposes workspace and account controls. Authentication, role enforcement and account settings remain backend decisions.</CardDescription></CardHeader><CardContent><dl className="space-y-3 text-sm"><div className="flex justify-between gap-3 border-b border-[var(--line)] pb-3"><dt className="text-[var(--ink-muted)]">Current role</dt><dd className="font-semibold text-[var(--ink)]">Admin preview</dd></div><div className="flex justify-between gap-3 border-b border-[var(--line)] pb-3"><dt className="text-[var(--ink-muted)]">Authentication</dt><dd className="font-semibold text-[var(--warning)]">Not connected</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">Audit log</dt><dd className="font-semibold text-[var(--ink-muted)]">Planned</dd></div></dl></CardContent></Card>
      </div>
      <section aria-labelledby="state-patterns-title"><div className="mb-4"><p className="text-xs font-bold tracking-[0.14em] text-[var(--teal)] uppercase">Shared pattern</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]" id="state-patterns-title">Interface states</h2></div><div className="grid gap-4 md:grid-cols-3"><ScreenState description="Use when a query is in progress while preserving the expected content area." title="Loading records" type="loading" /><ScreenState description="Use when a user has no accessible records and needs a safe next action." title="No mailboxes yet" type="empty" action={<Button variant="secondary">Learn setup options</Button>} /><ScreenState description="Use when a request fails without discarding the surrounding page context." title="Could not load health" type="error" /></div></section>
    </div>
  );
}
