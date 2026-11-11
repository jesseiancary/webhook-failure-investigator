import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../theme-provider';
import { ThemeToggle } from './theme-toggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('offers to switch to dark from the default light theme', () => {
    renderToggle();
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeDefined();
  });

  it('toggles the theme and flips its own label when clicked', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeDefined();
  });
});
