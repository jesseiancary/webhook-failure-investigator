import { describe, expect, it } from 'vitest';
import { buildDiagnosisToolkit } from './toolkit.js';

// Pure, DB-free checks on the toolkit's dispatcher: the advertised definitions, and every branch
// that rejects a call *before* it would touch the database (scope mismatch, bad JSON, invalid args,
// unknown tool). The happy path (a matching eventId reaching the executor) hits Postgres and is
// covered in tools.int.test.ts.

const EVENT_ID = 'evt_scoped_123';

describe('buildDiagnosisToolkit definitions', () => {
  const toolkit = buildDiagnosisToolkit(EVENT_ID);

  it('advertises the three retrieval tools', () => {
    const names = toolkit.definitions.map((d) => (d.type === 'function' ? d.function.name : ''));
    expect(names).toEqual(['get_event_payload', 'get_delivery_history', 'fetch_api_docs']);
  });

  it('advertises them as strict function tools (required by chat.completions.parse)', () => {
    for (const def of toolkit.definitions) {
      expect(def.type).toBe('function');
      if (def.type === 'function') expect(def.function.strict).toBe(true);
    }
  });
});

describe('buildDiagnosisToolkit dispatch guards', () => {
  const toolkit = buildDiagnosisToolkit(EVENT_ID);

  it('refuses an event-scoped call aimed at a different event (never querying it)', async () => {
    const result = await toolkit.execute(
      'get_event_payload',
      JSON.stringify({ eventId: 'some-other-event' }),
    );
    expect(result).toContain('refusing to read a different event');
    expect(result).toContain(EVENT_ID);
  });

  it('reports arguments that are not valid JSON', async () => {
    expect(await toolkit.execute('get_delivery_history', 'not json')).toContain('not valid JSON');
  });

  it('reports invalid arguments (missing/empty eventId) before touching the database', async () => {
    expect(await toolkit.execute('get_delivery_history', '{}')).toContain('Invalid arguments');
    expect(await toolkit.execute('get_event_payload', JSON.stringify({ eventId: '' }))).toContain(
      'Invalid arguments',
    );
  });

  it('reports invalid arguments for fetch_api_docs (missing query)', async () => {
    expect(
      await toolkit.execute('fetch_api_docs', JSON.stringify({ provider: 'stripe' })),
    ).toContain('Invalid arguments');
  });

  it('reports an unknown tool name', async () => {
    expect(await toolkit.execute('delete_everything', '{}')).toContain('Unknown tool');
  });
});
