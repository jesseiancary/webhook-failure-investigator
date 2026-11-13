import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RouteError } from './route-error';

// RouteError is the router's error boundary. The key regression guard here is Fix 1: its recovery
// control must be a full-document navigation (a plain <a href="/">), not a client-side <Link>. After
// a failed lazy chunk load React caches the rejected import, so an SPA nav back would re-throw — only
// a real page load refetches the chunk. We pin the `href` so a future refactor can't quietly swap it
// back to a client Link.

function Boom(): never {
  throw new Error('kaboom');
}

function renderErrored() {
  const router = createMemoryRouter([
    { path: '/', element: <Boom />, errorElement: <RouteError /> },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('RouteError', () => {
  it('renders a friendly recovery message when a route throws', () => {
    renderErrored();
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it('recovers via a full-document navigation to "/", not a client-side Link', () => {
    renderErrored();
    const recovery = screen.getByRole('link', { name: /back to dashboard/i });
    // A real anchor with a bare href triggers a full page load → refetches a failed lazy chunk.
    expect(recovery.getAttribute('href')).toBe('/');
    expect(recovery.tagName).toBe('A');
  });
});
