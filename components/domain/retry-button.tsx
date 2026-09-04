"use client";

import { useRouter } from "next/navigation";

import { ArrowUpRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/** Retries a failed server render without depending on a non-functional placeholder button. */
export function RetryButton() {
  const router = useRouter();

  return <Button onClick={() => router.refresh()} variant="secondary"><ArrowUpRightIcon className="size-4" />Try again</Button>;
}
