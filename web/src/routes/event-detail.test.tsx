import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Evidence } from '../api/types';
import { EvidenceCard, citedAttemptIndex } from './event-detail';

// The evidence→log link is the grounding invariant made visible: a citation whose `field` names a
// delivery attempt must be a clickable affordance that opens that attempt, while a citation that
// names no attempt stays inert text. These tests pin both the parsing and the rendered behaviour.

describe('citedAttemptIndex', () => {
  it('extracts the index from a leading attempts[N] path', () => {
    expect(citedAttemptIndex('attempts[0].responseStatus', 1)).toBe(0);
    expect(citedAttemptIndex('attempts[2].responseHeaders.date', 3)).toBe(2);
  });

  it('returns null when the field names no attempt index', () => {
    expect(citedAttemptIndex('payload.action', 2)).toBeNull();
    expect(citedAttemptIndex('event.source', 2)).toBeNull();
  });

  it('returns null when the index is out of range (no such attempt to open)', () => {
    expect(citedAttemptIndex('attempts[5].responseStatus', 2)).toBeNull();
  });
});

const EVIDENCE: Evidence[] = [
  {
    field: 'attempts[0].responseStatus',
    value: '401',
    note: 'The endpoint returned 401 Unauthorized.',
  },
  { field: 'payload.action', value: 'opened', note: 'The event action, not an attempt field.' },
];

describe('EvidenceCard', () => {
  it('renders an attempt-indexed citation as a button that cites the matching attempt', () => {
    const onCiteAttempt = vi.fn();
    render(<EvidenceCard evidence={EVIDENCE} attemptCount={1} onCiteAttempt={onCiteAttempt} />);

    const link = screen.getByRole('button', { name: /attempts\[0\]\.responseStatus/ });
    fireEvent.click(link);
    expect(onCiteAttempt).toHaveBeenCalledWith(0);
  });

  it('renders a non-attempt citation as plain text, not a link', () => {
    const onCiteAttempt = vi.fn();
    render(<EvidenceCard evidence={EVIDENCE} attemptCount={1} onCiteAttempt={onCiteAttempt} />);

    // The non-indexed field is present…
    expect(screen.getByText('payload.action')).toBeDefined();
    // …but only the indexed one is a button.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('shows a non-destructive empty state when nothing was cited', () => {
    render(<EvidenceCard evidence={[]} attemptCount={0} onCiteAttempt={vi.fn()} />);
    expect(screen.getByText(/No evidence was cited/)).toBeDefined();
  });
});
