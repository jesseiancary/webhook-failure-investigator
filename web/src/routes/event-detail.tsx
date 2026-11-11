import { useParams } from 'react-router-dom';
import { PagePlaceholder } from './placeholder';

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PagePlaceholder
      title="Investigation"
      description={`Event ${id ?? '—'}`}
      lands="The diagnosis (root cause, confidence badge, reachability, evidence citations that link to the delivery logs), remediation checklist, token/cost, the delivery-attempts panel, and the streaming follow-up chat."
    />
  );
}
