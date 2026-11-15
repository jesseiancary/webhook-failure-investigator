import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import {
  formatDeliveryHistoryBlock,
  formatEventPayloadBlock,
  type SerializableAttempt,
} from '../diagnosis/serialize.js';
import type { Scenario } from '../ingest/scenarios/index.js';

// Grounding scorer — the crux of the harness. It answers the CLAUDE.md invariant quantitatively:
// does a diagnosis's `evidence[]` cite the real log fields the scenario's `expected.evidence[]` says
// matter? The two sides don't line up trivially: the diagnosis cites structured `{field, value}`
// paths (serialize.ts vocabulary, e.g. `attempts[0].responseStatus` / `401`), while the labels are
// human-authored assertion strings like `attempts[0].responseStatus == 401`,
// `attempts[0].requestHeaders["x-hub-signature-256"] present`, or the absence sentence
// `attempts[0] has no responseStatus (no reply received)`. So we parse each label into field-path
// tokens (+ an optional expected value), discard the prose, and match tolerantly against the cited
// fields. Exact-string equality would be far too brittle.

// The serializer roots and attempt-level leaves (serialize.ts). A real citable field path either
// starts at one of these roots (`attempts[0]...`, `payload...`, `headers...`) or is a bare leaf
// (`responseStatus`) as the labels sometimes write them. Used both to tell field-path tokens apart
// from prose words when parsing a label, and to flag a diagnosis citation whose root resolves to no
// real field (one kind of hallucination; the other — a concrete value on a genuinely-absent field —
// is caught against the serialized logs, see serializedFields).
const FIELD_ROOTS = new Set(['attempts', 'payload', 'headers', 'source', 'eventtype']);
const FIELD_LEAVES = new Set([
  'requesturl',
  'requestmethod',
  'requestheaders',
  'requestbody',
  'responsestatus',
  'responseheaders',
  'responsebody',
  'latencyms',
  'errortext',
  'attemptedat',
]);

// Values the serializer renders for a null/undefined field, and other ways a diagnosis might spell
// "this field isn't present" — a citation carrying one of these is not asserting a concrete value.
const ABSENT_MARKERS = new Set(['(absent)', 'absent', 'none', 'null', 'n/a', '']);

// A candidate field-path token: an identifier followed by any run of `[...]` subscripts and `.segment`
// parts. Matches `attempts[0].responseBody.error.code` and `responseHeaders["retry-after"]`, but also
// bare prose words — those are filtered out by their head segment (see extractFieldTokens).
const FIELD_PATH_TOKEN = /[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\]|\.[A-Za-z_][A-Za-z0-9_-]*)*/g;

/**
 * Normalize a field path to lowercase segments, flattening subscripts: `attempts[0]` and
 * `responseHeaders["www-authenticate"]` both become dotted segment arrays
 * (`['attempts','0']`, `['responseheaders','www-authenticate']`). Quotes inside subscripts are
 * dropped so a header key cited with or without quotes compares equal.
 */
export function normalizePath(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/\[\s*["']?([^\]"']*)["']?\s*\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Is `short` a contiguous run of segments within `long`? */
function isContiguousSub(short: string[], long: string[]): boolean {
  if (short.length === 0) return false;
  for (let i = 0; i + short.length <= long.length; i++) {
    let matches = true;
    for (let j = 0; j < short.length; j++) {
      if (long[i + j] !== short[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/**
 * Two field paths match when the shorter is a contiguous slice of the longer. This makes citing a
 * parent region count for a more specific label (`attempts[0].responseBody` ↔
 * `attempts[0].responseBody.error.code`) and a bare-leaf label count against a fully-qualified
 * citation (`responseHeaders["retry-after"]` ↔ `attempts[0].responseHeaders["retry-after"]`). A
 * consequence worth noting for scenario authors: a bare-leaf label drops its attempt index, so in a
 * multi-attempt scenario it can match a citation of the wrong attempt's field.
 */
export function pathsMatch(a: string[], b: string[]): boolean {
  return a.length <= b.length ? isContiguousSub(a, b) : isContiguousSub(b, a);
}

/** The head segment of a field-path token, lowercased (`attempts[0].responseStatus` -> `attempts`). */
function headSegment(token: string): string {
  return token.split(/[.[]/)[0]?.toLowerCase() ?? '';
}

/** Pull the real field-path tokens out of a label string, dropping prose words (`with`, `present`, …). */
function extractFieldTokens(raw: string): string[] {
  const tokens = raw.match(FIELD_PATH_TOKEN) ?? [];
  return tokens.filter((token) => {
    const head = headSegment(token);
    return FIELD_ROOTS.has(head) || FIELD_LEAVES.has(head);
  });
}

/**
 * Pull the expected observed value(s) out of a label — the `401` in `responseStatus == 401`, the
 * `"invalid_payload"` in `== "invalid_payload"`, or the `"ETIMEDOUT"` in `contains "ETIMEDOUT"`.
 * Subscripts are stripped first so bracketed header *keys* (`["retry-after"]`) and array indices
 * (`[0]`) are never mistaken for values.
 */
function extractExpectedValues(raw: string): string[] {
  const withoutSubscripts = raw.replace(/\[[^\]]*\]/g, ' ');
  const values: string[] = [];
  for (const match of withoutSubscripts.matchAll(/"([^"]+)"/g)) values.push(match[1]);
  for (const match of withoutSubscripts.matchAll(/\b\d+\b/g)) values.push(match[0]);
  return values.map((value) => value.toLowerCase());
}

/**
 * Does a cited value carry the expected value as a whole token? Word-boundary rather than substring,
 * so a short numeric expected value (`'2'`, `'0'`) is not credited by an unrelated cited value that
 * merely contains the digit (`'200'`, `'401'`) — the exact false-pass that would defeat the scorer's
 * teeth. Legitimate cases still match: a value embedded in a serialized body JSON (quote-bounded),
 * multi-word phrases, and exact numbers.
 */
function containsValue(citedValue: string, expected: string): boolean {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${escaped}($|\\W)`, 'i').test(citedValue);
}

interface ExpectedItem {
  paths: string[][];
  values: string[];
}

function parseExpectedItem(raw: string): ExpectedItem {
  return {
    paths: extractFieldTokens(raw).map(normalizePath),
    values: extractExpectedValues(raw),
  };
}

/**
 * The actual serialized log fields for a scenario, as `normalizedPath -> renderedValue` (lowercased).
 * Built by running the scenario's own (pre-redacted) submission through the SAME serializer the model
 * cites against (serialize.ts), so the field vocabulary and the `(absent)` rendering are identical to
 * what production shows the model. Lets us tell a fabricated value for a genuinely-absent field apart
 * from a real citation, without re-implementing field resolution.
 */
function serializedFields(scenario: Scenario): Map<string, string> {
  const { source, eventType, payload, headers, attempts } = scenario.submission;
  const text = [
    formatEventPayloadBlock({ source, eventType, payload, headers }),
    formatDeliveryHistoryBlock(attempts as SerializableAttempt[]),
  ].join('\n');

  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z0-9_.[\]"'-]+):\s(.*)$/.exec(line);
    if (match === null) continue;
    fields.set(normalizePath(match[1]).join('.'), match[2].trim().toLowerCase());
  }
  return fields;
}

/** The outcome of grounding one diagnosis against one scenario's expected evidence. */
export interface GroundingResult {
  grounded: boolean;
  /** Fraction of expected evidence items the diagnosis cited (0–1). */
  coverage: number;
  coveredItems: number;
  totalItems: number;
  /** Cited fields that resolve to no real log path, or assert a concrete value on an absent field. */
  hallucinatedFields: string[];
  /** Human-readable explanation when `grounded` is false (for the scorecard's failures list). */
  reason?: string;
}

/**
 * A cited field is hallucinated when its root isn't real log vocabulary at all, or when it asserts a
 * concrete value for a field the logs render as `(absent)` — i.e. the model invented a value for a
 * field that never arrived (e.g. a status code on a connection that got no response). A citation that
 * reports an absent field *as* absent is fine. Present-field values are not re-validated here, so a
 * model paraphrasing a real value is not punished as a hallucination.
 */
function isHallucinated(citedPath: string[], value: string, fields: Map<string, string>): boolean {
  const head = citedPath[0];
  if (head === undefined || !(FIELD_ROOTS.has(head) || FIELD_LEAVES.has(head))) return true;
  const serialized = fields.get(citedPath.join('.'));
  return serialized === '(absent)' && !ABSENT_MARKERS.has(value.trim().toLowerCase());
}

/**
 * Score one diagnosis's grounding against a scenario's ground-truth evidence.
 *
 * For the `insufficient_evidence` scenarios the "evidence" describes *missing* fields, so grounding
 * is not about citing a present field — the grounded behavior is a correct refusal. We therefore pass
 * iff the diagnosis both classifies as `insufficient_evidence` and flags `isSpeculative` (and, as for
 * every other category, cites no hallucinated field).
 *
 * For every other category, an expected item is "covered" when a *single* cited evidence entry both
 * matches one of the item's field-path tokens and (when the label names a value) carries that value —
 * the path and value must land on the same citation, not be satisfied by two unrelated entries. The
 * run is grounded when it covers at least one expected item and cites no hallucinated field.
 */
export function scoreGrounding(scenario: Scenario, diagnosis: Diagnosis): GroundingResult {
  const fields = serializedFields(scenario);
  const hallucinatedFields = diagnosis.evidence
    .filter((evidence) => isHallucinated(normalizePath(evidence.field), evidence.value, fields))
    .map((evidence) => evidence.field);

  if (scenario.expected.category === 'insufficient_evidence') {
    const refused =
      diagnosis.failureCategory === 'insufficient_evidence' && diagnosis.isSpeculative === true;
    const grounded = refused && hallucinatedFields.length === 0;
    return {
      grounded,
      coverage: grounded ? 1 : 0,
      coveredItems: grounded ? 1 : 0,
      totalItems: 1,
      hallucinatedFields,
      reason: grounded
        ? undefined
        : hallucinatedFields.length > 0
          ? `cites non-log fields: ${hallucinatedFields.join(', ')}`
          : `expected a speculative insufficient_evidence refusal (got ${diagnosis.failureCategory}, isSpeculative=${diagnosis.isSpeculative})`,
    };
  }

  // Only items that actually name a field are scorable. A purely-prose label can't be grounded by a
  // citation, so it is dropped from both numerator and denominator rather than auto-counted as
  // covered — otherwise a token-less label would silently pass grounding for any diagnosis. If a
  // scenario has no scorable items, the diagnosis fails grounding (fail-closed), surfacing the
  // label-authoring bug. No current label is token-less.
  const scorable = scenario.expected.evidence
    .map(parseExpectedItem)
    .filter((item) => item.paths.length > 0);
  const coveredItems = scorable.filter((item) =>
    diagnosis.evidence.some((evidence) => {
      const citedPath = normalizePath(evidence.field);
      const pathOk = item.paths.some((expected) => pathsMatch(expected, citedPath));
      if (!pathOk) return false;
      if (item.values.length === 0) return true;
      return item.values.some((value) => containsValue(evidence.value, value));
    }),
  ).length;

  const totalItems = scorable.length;
  const coverage = totalItems === 0 ? 0 : coveredItems / totalItems;
  const grounded = coveredItems >= 1 && hallucinatedFields.length === 0;

  let reason: string | undefined;
  if (!grounded) {
    if (hallucinatedFields.length > 0) {
      reason = `cites non-log fields: ${hallucinatedFields.join(', ')}`;
    } else if (diagnosis.evidence.length === 0) {
      reason = 'cites no evidence';
    } else {
      reason = 'cites none of the expected log fields';
    }
  }

  return { grounded, coverage, coveredItems, totalItems, hallucinatedFields, reason };
}
