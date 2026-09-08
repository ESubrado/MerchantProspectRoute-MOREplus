import { RouteLoading } from "@/components/domain/route-loading";

/** Shows an immediate Contacts-specific loading state while the server directory query resolves. */
export default function ContactsLoading() {
  return <RouteLoading description="Retrieving contacts and workspace permissions." title="Loading contacts" />;
}
