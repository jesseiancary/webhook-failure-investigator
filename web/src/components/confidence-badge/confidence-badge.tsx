import type { ComponentProps } from 'react';
import { type ConfidenceLevel, confidenceLevel, formatConfidence } from '../../lib/format';
import { Badge } from '../ui/badge';

// Turns the diagnosis's 0–1 confidence score into a banded badge (High/Medium/Low + the percentage).
// Keeping the band → style mapping here means the UI states certainty one way everywhere, honouring
// the project's confidence-handling goal (a Low score must look Low, never like a firm answer).

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const LEVEL_VARIANT: Record<ConfidenceLevel, BadgeVariant> = {
  High: 'default',
  Medium: 'secondary',
  Low: 'outline',
};

export function ConfidenceBadge({ score }: { score: number }) {
  const level = confidenceLevel(score);
  return (
    <Badge variant={LEVEL_VARIANT[level]}>
      {level} · {formatConfidence(score)}
    </Badge>
  );
}
