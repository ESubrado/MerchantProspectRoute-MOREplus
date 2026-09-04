import { MailboxesScreen } from "@/components/screens/mailboxes-screen";
import { PageHeader } from "@/components/domain/page-header";
import { RetryButton } from "@/components/domain/retry-button";
import { ScreenState } from "@/components/domain/screen-state";
import { getMailboxesPage } from "@/lib/mailboxes/mailboxes";

export default async function MailboxesPage() {
  const result = await getMailboxesPage();

  if (result.type === "error") {
    return <div className="space-y-6"><PageHeader description="Review operator-recorded mailbox capacity and pause controls in your active workspace." eyebrow="Outreach / Delivery" title="Mailboxes" /><ScreenState action={<RetryButton />} description={result.message} title="Mailboxes are unavailable" type="error" /></div>;
  }

  return <MailboxesScreen {...result} />;
}
