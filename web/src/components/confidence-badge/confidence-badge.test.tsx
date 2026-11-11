import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfidenceBadge } from './confidence-badge';

describe('ConfidenceBadge', () => {
  it('bands a high score as High with its percentage', () => {
    render(<ConfidenceBadge score={0.92} />);
    expect(screen.getByText(/High · 92%/)).toBeDefined();
  });

  it('bands a mid score as Medium', () => {
    render(<ConfidenceBadge score={0.5} />);
    expect(screen.getByText(/Medium · 50%/)).toBeDefined();
  });

  it('bands a low score as Low so thin diagnoses never read as certain', () => {
    render(<ConfidenceBadge score={0.2} />);
    expect(screen.getByText(/Low · 20%/)).toBeDefined();
  });
});
