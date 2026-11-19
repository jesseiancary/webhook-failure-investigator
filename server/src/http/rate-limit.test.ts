import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createJsonLimiter } from './rate-limit.js';

// The exported limiters skip enforcement under NODE_ENV=test (so the integration suite's bursts don't
// trip them), so the real 429 path is exercised here against a limiter built with `skip: () => false`.

describe('createJsonLimiter', () => {
  it('allows up to the limit, then 429s with the standard error envelope', async () => {
    const app = express();
    app.use(createJsonLimiter({ windowMs: 60_000, limit: 2, skip: () => false }));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    const agent = request(app);

    expect((await agent.get('/')).status).toBe(200);
    expect((await agent.get('/')).status).toBe(200);

    const blocked = await agent.get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'TooManyRequests' });
  });

  it('does not enforce when skip returns true (the default under NODE_ENV=test)', async () => {
    const app = express();
    app.use(createJsonLimiter({ windowMs: 60_000, limit: 1, skip: () => true }));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    const agent = request(app);

    for (let i = 0; i < 5; i++) {
      expect((await agent.get('/')).status).toBe(200);
    }
  });
});
