import { ScreenState } from "@/components/domain/screen-state";

/** Shows an immediate Contacts-specific loading state while the server directory query resolves. */
export default function ContactsLoading() {
  return <ScreenState description="Loading contacts for your active workspace." title="Loading contacts" type="loading" />;
}
