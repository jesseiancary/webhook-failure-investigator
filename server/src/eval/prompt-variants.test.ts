import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT, PROMPT_VERSION, SYSTEM_PROMPT } from '../diagnosis/prompt.js';
import { PROMPT_VARIANTS, resolveVariant } from './prompt-variants.js';

// Unit tests for the prompt A/B registry. Pure (no DB, no model): they assert the selector resolves
// the right variant and that the regressed variant is a real regression — the production prompt with
// its grounding invariant removed, derived from SYSTEM_PROMPT so it can't silently drift into a copy
// of the default (which would make the end-to-end teeth test pass vacuously).

describe('resolveVariant', () => {
  it('maps no argument to the default (production) prompt', () => {
    expect(resolveVariant(undefined).prompt).toBe(DEFAULT_PROMPT);
  });

  it('maps the default version string to the default variant (pre-PR3 compatibility)', () => {
    expect(resolveVariant(PROMPT_VERSION).prompt).toBe(DEFAULT_PROMPT);
  });

  it('resolves the regressed variant by name', () => {
    const variant = resolveVariant('regressed-no-grounding');
    expect(variant.name).toBe('regressed-no-grounding');
    expect(variant.prompt.version).toBe(`${PROMPT_VERSION}-regressed-nogrounding`);
  });

  it('throws on an unknown variant, listing the available ones', () => {
    expect(() => resolveVariant('bogus')).toThrow(/unknown prompt variant "bogus"/);
    expect(() => resolveVariant('bogus')).toThrow(/regressed-no-grounding/);
  });
});

describe('the regressed-no-grounding variant', () => {
  const regressed = PROMPT_VARIANTS['regressed-no-grounding']!.prompt;

  it('removes the grounding invariant the production prompt enforces', () => {
    expect(SYSTEM_PROMPT).toContain('GROUNDING RULE');
    expect(regressed.systemPrompt).not.toContain('GROUNDING RULE');
    // It is genuinely a different, shorter prompt — not an accidental copy of the default.
    expect(regressed.systemPrompt).not.toBe(SYSTEM_PROMPT);
    expect(regressed.systemPrompt.length).toBeLessThan(SYSTEM_PROMPT.length);
  });

  it('keeps the classification taxonomy and the later sections intact', () => {
    // Only the grounding block is excised; the surrounding instructions (and the few-shots) remain,
    // isolating the removed rule as the single variable under test.
    expect(regressed.systemPrompt).toContain('Classify the failure into exactly one of these');
    expect(regressed.systemPrompt).toContain('CONFIDENCE:');
    expect(regressed.fewShotMessages).toBe(DEFAULT_PROMPT.fewShotMessages);
  });

  it('carries its own version so its scorecard exports under a distinct filename', () => {
    expect(regressed.version).not.toBe(DEFAULT_PROMPT.version);
  });
});
