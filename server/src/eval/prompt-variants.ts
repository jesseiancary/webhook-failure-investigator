import {
  DEFAULT_PROMPT,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type DiagnosisPrompt,
} from '../diagnosis/prompt.js';

// The eval's prompt A/B registry (Phase 8 PR3). The harness scores the real diagnosis pipeline, so a
// "prompt version" the `pnpm eval [variant]` arg selects is a full DiagnosisPrompt handed to
// `investigateEvent(..., { prompt })`. Two variants ship: `default` (delegates to the production
// prompt in diagnosis/prompt.ts) and a deliberately **regressed** one with the grounding invariant
// removed — the control that proves the harness has teeth end to end (a real model's grounding and
// accuracy drop; the deterministic proof is regressed-prompt.int.test.ts, which needs no key).
//
// The regressed prompt is DERIVED from the production SYSTEM_PROMPT by excising the grounding block,
// not hand-copied, so it can never silently drift out of sync with the prompt it regresses.

/** A named, selectable prompt for an eval run: what `pnpm eval [name]` resolves to. */
export interface PromptVariant {
  /** The canonical selector, e.g. `default` or `regressed-no-grounding`. */
  name: string;
  /** One line on what this variant is, shown in `--help`-style listings and the unknown-name error. */
  description: string;
  /** The full prompt handed to `investigateEvent`; its `version` is stamped on each Investigation. */
  prompt: DiagnosisPrompt;
}

// The grounding block runs from the "GROUNDING RULE" heading up to the next section ("CONFIDENCE:").
// Excising it yields a prompt that still classifies and retrieves but no longer forbids ungrounded
// claims — the single-rule regression we want to catch.
const GROUNDING_HEADING = 'GROUNDING RULE';
const NEXT_HEADING = 'CONFIDENCE:';

/** Produce the regressed system prompt: the production prompt with its grounding invariant removed. */
function stripGroundingRule(systemPrompt: string): string {
  const start = systemPrompt.indexOf(GROUNDING_HEADING);
  const end = systemPrompt.indexOf(NEXT_HEADING);
  if (start === -1 || end === -1 || end <= start) {
    // The anchors moved — fail loudly rather than ship a "regressed" variant identical to the default,
    // which would make the teeth test pass vacuously. Re-point the anchors at the new wording.
    throw new Error(
      `prompt-variants: could not locate the "${GROUNDING_HEADING}"…"${NEXT_HEADING}" block to strip; ` +
        'the system prompt wording changed — update the regressed variant anchors.',
    );
  }
  return systemPrompt.slice(0, start) + systemPrompt.slice(end);
}

const DEFAULT_VARIANT: PromptVariant = {
  name: 'default',
  description: `the production prompt (${PROMPT_VERSION})`,
  prompt: DEFAULT_PROMPT,
};

// Build the regressed prompt lazily and memoize it. `stripGroundingRule` throws if its anchors drift,
// so deriving it eagerly at module load would make that throw fire at *import* of this module — taking
// down the default `pnpm eval` and the fake `eval-smoke` CI gate, neither of which uses this variant.
// A getter confines the risk to callers that actually select the regressed variant.
let regressedPrompt: DiagnosisPrompt | undefined;

const REGRESSED_VARIANT: PromptVariant = {
  name: 'regressed-no-grounding',
  description:
    'the production prompt with the grounding invariant removed (a deliberate regression)',
  get prompt(): DiagnosisPrompt {
    // Keep the few-shots (a real-world regression is usually a system-prompt edit); the removed
    // grounding rule is the isolated variable under test.
    return (regressedPrompt ??= {
      systemPrompt: stripGroundingRule(SYSTEM_PROMPT),
      fewShotMessages: DEFAULT_PROMPT.fewShotMessages,
      version: `${PROMPT_VERSION}-regressed-nogrounding`,
    });
  },
};

/** Every selectable variant, keyed by its canonical name. */
export const PROMPT_VARIANTS: Record<string, PromptVariant> = {
  [DEFAULT_VARIANT.name]: DEFAULT_VARIANT,
  [REGRESSED_VARIANT.name]: REGRESSED_VARIANT,
};

/**
 * Resolve the `[variant]` CLI argument to a variant. `undefined` (no arg) and the default's version
 * string (`diagnosis-v2`) both map to `default`, preserving the pre-PR3 behavior where `pnpm eval`
 * and `pnpm eval diagnosis-v2` run the production prompt. Any unknown name throws with the list of
 * available variants.
 */
export function resolveVariant(name: string | undefined): PromptVariant {
  if (name === undefined || name === PROMPT_VERSION) {
    return DEFAULT_VARIANT;
  }
  const variant = PROMPT_VARIANTS[name];
  if (variant === undefined) {
    const available = Object.values(PROMPT_VARIANTS)
      .map((v) => `${v.name} (${v.description})`)
      .join('\n  ');
    throw new Error(`unknown prompt variant "${name}". Available variants:\n  ${available}`);
  }
  return variant;
}
