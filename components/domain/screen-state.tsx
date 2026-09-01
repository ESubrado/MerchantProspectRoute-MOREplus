import type { ReactNode } from "react";

import { ArrowUpRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ScreenStateProps = {
  action?: ReactNode;
  description: string;
  title: string;
  type: "empty" | "error" | "loading";
};

const stateStyles = {
  empty: "bg-[var(--surface)]",
  error: "border-[#ecc7cf] bg-[var(--danger-soft)]",
  loading: "bg-[var(--surface-subtle)]",
};

export function ScreenState({ action, description, title, type }: ScreenStateProps) {
  return (
    <Card className={cn("min-h-52", stateStyles[type])}>
      <CardHeader>
        <span aria-hidden="true" className={cn("grid size-9 place-items-center rounded-lg text-sm font-bold", type === "error" ? "bg-white text-[var(--danger)]" : "bg-[var(--primary-soft)] text-[var(--primary)]")}>
          {type === "loading" ? "…" : type === "error" ? "!" : "0"}
        </span>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{action ?? (type === "error" ? <Button variant="secondary"><ArrowUpRightIcon className="size-4" />Try again</Button> : null)}</CardContent>
    </Card>
  );
}
