import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell', () => {
  it('renders the brand and the dashboard route at /', async () => {
    render(<App />);
    // The shell chrome (brand link) is present immediately...
    expect(screen.getByRole('link', { name: /webhook failure investigator/i })).toBeDefined();
    // ...and the dashboard route resolves at '/' (it's lazy-loaded, so await the heading appearing).
    expect(await screen.findByRole('heading', { name: /events/i })).toBeDefined();
  });
});
