import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({ detail, label, tone = "default", value }: { detail: string; label: string; tone?: "default" | "positive" | "attention" | "teal"; value: string }) {
  const toneClass = {
    default: "border-[var(--line)]",
    positive: "border-[#cce4d6]",
    attention: "border-[#f0d5a6]",
    teal: "border-[#c3e0db]",
  }[tone];

  return (
    <Card className={cn("min-w-0", toneClass)}>
      <CardContent className="p-4">
        <p className="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink)]">{value}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{detail}</p>
      </CardContent>
    </Card>
  );
}
