import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../theme-provider';
import { AppShell } from './app-shell';

// AppShell is a layout route (renders an <Outlet/>), so it needs a router context and a child route
// to project into. ThemeProvider backs the nested ThemeToggle.
function renderShell() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>outlet content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('renders the brand, primary nav, and the routed outlet', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /webhook failure investigator/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /submit event/i })).toBeDefined();
    expect(screen.getByText('outlet content')).toBeDefined();
  });
});
