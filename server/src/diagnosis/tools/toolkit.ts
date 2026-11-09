import type OpenAI from 'openai';
import { zodFunction } from 'openai/helpers/zod';
import type { ZodError, ZodTypeAny } from 'zod';
import type { DiagnosisToolkit } from '../openai.js';
import { fetchApiDocs } from './api-docs.js';
import { getDeliveryHistory, getEventPayload } from './event-tools.js';
import { EventToolParamsSchema, FetchApiDocsParamsSchema } from './schemas.js';

// The diagnosis toolkit: the three retrieval tools advertised to the model, plus the dispatcher that
// validates a model-supplied call and runs it. Built per-investigation and bound to one eventId, so
// the event-scoped tools can never be steered at a different event — the whole point of the Phase-5
// grounding story is that the model reads only the event it was asked about. The Zod param schemas
// from ./schemas.ts are the single source for BOTH the advertised JSON Schema (via zodFunction) and
// the runtime argument validation here, per the CLAUDE.md "define Zod once" rule.

/**
 * Build a strict-but-UNBRANDED OpenAI function tool from a Zod param schema. We derive the JSON
 * Schema from the Zod object via `zodFunction` (keeping the CLAUDE.md "define Zod once" rule: the
 * same schema drives the advertised shape and the runtime validation in `execute`), but return a
 * plain tool object rather than `zodFunction`'s auto-parseable (branded) result. The brand matters:
 *
 * - `strict: true` is required — `client.chat.completions.parse` rejects non-strict tools, and it
 *   makes the model emit arguments matching the shape.
 * - Dropping the brand is deliberate. An auto-parseable tool makes `.parse()` run the Zod schema on
 *   the model's arguments *inside* the SDK, and a failure (e.g. an empty string vs `.min(1)`) throws
 *   out of the whole completion — aborting the investigation. Unbranded, `.parse()` only JSON-parses
 *   the arguments, so semantic validation falls to `execute` below, where a bad or out-of-scope call
 *   becomes a graceful error tool-result the model can recover from within the bounded loop.
 */
function functionTool(
  name: string,
  parameters: ZodTypeAny,
  description: string,
): OpenAI.Chat.Completions.ChatCompletionTool {
  const { function: fn } = zodFunction({ name, parameters, description });
  return {
    type: 'function',
    function: { name: fn.name, description, parameters: fn.parameters, strict: true },
  };
}

// Static: the schemas are fixed, so build the advertised definitions once.
const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  functionTool(
    'get_event_payload',
    EventToolParamsSchema,
    'Retrieve the event envelope (source, eventType, payload, headers) for the event under ' +
      'investigation. Pass the exact eventId from the investigation request.',
  ),
  functionTool(
    'get_delivery_history',
    EventToolParamsSchema,
    'Retrieve every delivery attempt for the event under investigation, oldest-first, with citable ' +
      'attempts[i].field paths. Pass the exact eventId from the investigation request.',
  ),
  functionTool(
    'fetch_api_docs',
    FetchApiDocsParamsSchema,
    "Search a provider's webhook reference docs (signature verification, authentication, rate " +
      'limits, payload shape) by keyword. Reference material to inform the explanation and ' +
      'remediation — NOT delivery-log evidence.',
  ),
];

/** Flatten a Zod validation error into a one-line, model-readable reason. */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Construct the toolkit for one investigation, bound to `eventId`. This dispatcher is the *primary*
 * argument validator (the tools are unbranded, so `.parse()` only JSON-parses args and defers the
 * rest here): it Zod-validates every model-supplied argument set, enforces that the event-scoped
 * tools target the bound event (a mismatched id returns an error tool-result rather than querying
 * another event), and otherwise runs the PR1 executor. Every failure mode returns an explanatory
 * string so the model gets an honest signal it can retry on, instead of an exception that aborts the
 * investigation.
 */
export function buildDiagnosisToolkit(eventId: string): DiagnosisToolkit {
  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name: string, argsJson: string): Promise<string> {
      let rawArgs: unknown;
      try {
        rawArgs = JSON.parse(argsJson);
      } catch {
        return `Tool "${name}" received arguments that are not valid JSON.`;
      }

      switch (name) {
        case 'get_event_payload':
        case 'get_delivery_history': {
          const parsed = EventToolParamsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return `Invalid arguments for "${name}": ${formatZodError(parsed.error)}.`;
          }
          if (parsed.data.eventId !== eventId) {
            return (
              `This investigation is scoped to event "${eventId}"; refusing to read a different ` +
              `event ("${parsed.data.eventId}"). Call ${name} with eventId "${eventId}".`
            );
          }
          // Use the bound eventId (now verified to match) so the toolkit can never query elsewhere.
          return name === 'get_event_payload'
            ? getEventPayload(eventId)
            : getDeliveryHistory(eventId);
        }
        case 'fetch_api_docs': {
          const parsed = FetchApiDocsParamsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return `Invalid arguments for "${name}": ${formatZodError(parsed.error)}.`;
          }
          return fetchApiDocs(parsed.data.provider, parsed.data.query);
        }
        default:
          return `Unknown tool "${name}". Available tools: get_event_payload, get_delivery_history, fetch_api_docs.`;
      }
    },
  };
}
