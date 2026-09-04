"use client";

import { ArrowUpRightIcon } from "@/components/icons";
import { ScreenState } from "@/components/domain/screen-state";
import { Button } from "@/components/ui/button";

/** Contains unexpected Contacts render failures without replacing the authenticated application shell. */
export default function ContactsError({ retry }: { retry: () => void }) {
  return <ScreenState action={<Button onClick={retry} variant="secondary"><ArrowUpRightIcon className="size-4" />Try again</Button>} description="The Contacts directory could not be displayed. Try again, or return after the connection has recovered." title="Contacts are unavailable" type="error" />;
}
