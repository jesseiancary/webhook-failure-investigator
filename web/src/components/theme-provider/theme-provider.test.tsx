import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './theme-provider';

// A throwaway consumer so the tests exercise the real context, not provider internals.
function Consumer() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  it('resolves to light by default (matchMedia reports no dark preference) and renders children', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies the .dark class and persists the choice when set to dark', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));

    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('wfi-theme')).toBe('dark');
  });

  it('throws when useTheme is used outside the provider', () => {
    // React logs the throw to console.error; silence it so the expected failure isn't noisy.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/useTheme must be used within a ThemeProvider/);
    spy.mockRestore();
  });
});
