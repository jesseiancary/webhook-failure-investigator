import { describe, expect, it } from 'vitest';
import { app } from './app.js';

describe('server app', () => {
  it('exposes an express application', () => {
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });
});
