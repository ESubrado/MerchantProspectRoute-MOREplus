import { CompaniesScreen } from "@/components/screens/companies-screen";
import { PageHeader } from "@/components/domain/page-header";
import { RetryButton } from "@/components/domain/retry-button";
import { ScreenState } from "@/components/domain/screen-state";
import { getCompaniesPage } from "@/lib/crm/companies";

function firstValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; search?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedPage = Number(firstValue(query.page));
  const result = await getCompaniesPage({
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    search: firstValue(query.search),
  });

  if (result.type === "error") {
    return (
      <div className="space-y-6">
        <PageHeader description="Search and manage companies that belong to your active workspace." eyebrow="CRM / Accounts" title="Companies" />
        <ScreenState action={<RetryButton />} description={result.message} title="Companies are unavailable" type="error" />
      </div>
    );
  }

  return <CompaniesScreen {...result} search={firstValue(query.search) ?? ""} />;
}
