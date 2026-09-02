import { ContactsScreen } from "@/components/screens/contacts-screen";
import { PageHeader } from "@/components/domain/page-header";
import { RetryButton } from "@/components/domain/retry-button";
import { ScreenState } from "@/components/domain/screen-state";
import { getContactsPage } from "@/lib/crm/contacts";

/** Parses a single URL value so filtering and pagination remain server-rendered and bookmarkable. */
function firstValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[]; page?: string | string[]; search?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedPage = Number(firstValue(query.page));
  const result = await getContactsPage({
    filter: firstValue(query.filter),
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    search: firstValue(query.search),
  });

  if (result.type === "error") {
    return (
      <div className="space-y-6">
        <PageHeader description="Search and manage contacts that belong to your active workspace." eyebrow="CRM / Directory" title="Contacts" />
        <ScreenState action={<RetryButton />} description={result.message} title="Contacts are unavailable" type="error" />
      </div>
    );
  }

  return <ContactsScreen {...result} filter={firstValue(query.filter)} search={firstValue(query.search) ?? ""} />;
}
