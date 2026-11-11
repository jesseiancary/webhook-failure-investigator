import { PagePlaceholder } from './placeholder';

export default function DashboardPage() {
  return (
    <PagePlaceholder
      title="Events"
      description="Captured and seeded webhook failures, newest first."
      lands="The enriched GET /events list with client-side filters (failure category, investigated-state, source, HTTP status), category/confidence badges, and links into each investigation."
    />
  );
}
