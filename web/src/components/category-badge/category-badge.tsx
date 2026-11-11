import type { ComponentProps } from 'react';
import type { FailureCategory } from '../../api/types';
import { Badge } from '../ui/badge';

// Presents a failure-taxonomy value as a readable, consistently-styled badge. The label and visual
// weight are centralised here so the dashboard and the detail page never drift on wording or colour.

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const CATEGORY_META: Record<FailureCategory, { label: string; variant: BadgeVariant }> = {
  authentication: { label: 'Authentication', variant: 'destructive' },
  payload_validation: { label: 'Payload validation', variant: 'secondary' },
  timeout: { label: 'Timeout', variant: 'destructive' },
  network_failure: { label: 'Network failure', variant: 'destructive' },
  rate_limit: { label: 'Rate limit', variant: 'secondary' },
  server_error: { label: 'Server error', variant: 'destructive' },
  application_logic: { label: 'Application logic', variant: 'secondary' },
  // Not a failure cause but an honest "we couldn't tell" — styled quietly so it never reads as a verdict.
  insufficient_evidence: { label: 'Insufficient evidence', variant: 'outline' },
};

export function CategoryBadge({ category }: { category: FailureCategory }) {
  const meta = CATEGORY_META[category];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
