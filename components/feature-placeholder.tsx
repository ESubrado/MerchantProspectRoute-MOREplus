import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type FeaturePlaceholderProps = {
  eyebrow: string;
  title: string;
  description: string;
  capabilities: readonly string[];
  nextStep: string;
};

export function FeaturePlaceholder({
  eyebrow,
  title,
  description,
  capabilities,
  nextStep,
}: FeaturePlaceholderProps) {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-xs font-bold tracking-[0.14em] text-[var(--teal)] uppercase">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[var(--ink)]">{title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planned capability</CardTitle>
          <CardDescription>
            This route is intentionally a standalone product placeholder, not a connection to the reference application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 text-sm text-[var(--ink-muted)] sm:grid-cols-2">
            {capabilities.map((capability) => (
              <li className="flex gap-2" key={capability}>
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--teal)]" />
                <span>{capability}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-[#c3e0db] bg-[var(--teal-soft)]">
        <CardHeader>
          <CardTitle>Next implementation boundary</CardTitle>
          <CardDescription>{nextStep}</CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}
