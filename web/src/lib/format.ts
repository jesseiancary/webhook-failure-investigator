// Small presentation helpers shared across screens. The API returns dates as ISO strings and
// Prisma `Decimal` money (costUsd) as a JSON string, so formatting lives here once rather than in
// each component.

/** A coarse confidence band derived from the model's 0–1 score; drives the confidence badge. */
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

// Thresholds are deliberately conservative: a diagnosis only reads as "High" when the model is
// genuinely sure, so the UI never over-states certainty on a grounded-but-thin case.
export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'High';
  if (score >= 0.4) return 'Medium';
  return 'Low';
}

/** `0.9234` → `92%`. */
export function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** An ISO timestamp → a compact local date+time, e.g. `Nov 11, 2026, 2:04 PM`. Invalid input passes through. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a JSON-string money amount (Prisma `Decimal` over the wire) as USD. Costs are tiny
 * (fractions of a cent), so show enough precision to be meaningful rather than rounding to `$0.00`.
 */
export function formatCost(costUsd: string | null): string {
  if (costUsd == null) return '—';
  const amount = Number(costUsd);
  if (Number.isNaN(amount)) return costUsd;
  return `$${amount.toFixed(4)}`;
}

/** `1234` → `1,234`; `null` → `—`. Used for token counts. */
export function formatCount(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString();
}
