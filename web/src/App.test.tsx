import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell', () => {
  it('renders the brand and the dashboard route at /', () => {
    render(<App />);
    // The shell chrome (brand link) is present...
    expect(screen.getByRole('link', { name: /webhook failure investigator/i })).toBeDefined();
    // ...with the dashboard route mounted at '/'.
    expect(screen.getByRole('heading', { name: /events/i })).toBeDefined();
  });
});
