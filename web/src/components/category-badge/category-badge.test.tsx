import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CategoryBadge } from './category-badge';

describe('CategoryBadge', () => {
  it('renders a readable label for a failure category', () => {
    render(<CategoryBadge category="payload_validation" />);
    expect(screen.getByText('Payload validation')).toBeDefined();
  });

  it('labels insufficient_evidence honestly rather than as a verdict', () => {
    render(<CategoryBadge category="insufficient_evidence" />);
    expect(screen.getByText('Insufficient evidence')).toBeDefined();
  });
});
