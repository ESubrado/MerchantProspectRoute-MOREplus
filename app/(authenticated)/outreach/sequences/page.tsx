import { SequencesScreen } from "@/components/screens/sequences-screen";
import { PageHeader } from "@/components/domain/page-header";
import { RetryButton } from "@/components/domain/retry-button";
import { ScreenState } from "@/components/domain/screen-state";
import { getSequencesPage } from "@/lib/sequences/sequences";

export default async function SequencesPage() {
  const result = await getSequencesPage();

  if (result.type === "error") {
    return <div className="space-y-6"><PageHeader description="Review the sequence records in the current workspace campaign." eyebrow="Outreach / Current campaign" title="Sequences" /><ScreenState action={<RetryButton />} description={result.message} title="Sequences are unavailable" type="error" /></div>;
  }

  return <SequencesScreen {...result} />;
}
