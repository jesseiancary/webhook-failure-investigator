import type { ManualSubmissionInput } from '../api/types';

// Pure validation + marshalling for the manual-submission form (src/routes/submit.tsx). Kept out of
// the component so it's unit-testable without rendering. The server's Zod `ManualSubmissionSchema`
// remains the contract of record (it re-validates on POST); these are lightweight local checks for
// fast feedback. Keep the shapes in lockstep with ManualSubmissionInput.

/** One delivery attempt as the form holds it — every field a string the user types. */
export interface AttemptForm {
  /** Stable identity for the React key, so mid-list removal doesn't reorder DOM positionally. */
  id: string;
  requestUrl: string;
  requestMethod: string;
  requestHeaders: string; // JSON
  requestBody: string; // JSON, optional
  responseStatus: string; // integer, optional
  responseHeaders: string; // JSON, optional
  responseBody: string; // JSON, optional
  latencyMs: string; // integer, optional
  errorText: string; // optional
}

/** The whole form's raw string state. */
export interface SubmissionForm {
  source: string;
  eventType: string;
  payload: string; // JSON
  headers: string; // JSON
  attempts: AttemptForm[];
}

export function emptyAttempt(): AttemptForm {
  return {
    id: crypto.randomUUID(),
    requestUrl: '',
    requestMethod: 'POST',
    requestHeaders: '{}',
    requestBody: '',
    responseStatus: '',
    responseHeaders: '',
    responseBody: '',
    latencyMs: '',
    errorText: '',
  };
}

/** Parse a JSON text field. `required` distinguishes "must be present" from "optional, skip if blank". */
function parseJson(
  text: string,
  required: boolean,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    if (required) return { ok: false, error: 'Required.' };
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
}

/**
 * Validate the form and marshal it into the API's `ManualSubmissionInput`. Error keys are
 * `source` / `eventType` / `payload` / `headers` and `attempt{i}.{field}` so each input can surface
 * its own message. `input` is the built payload when there are no errors, otherwise `null`.
 */
export function validateSubmission(form: SubmissionForm): {
  errors: Record<string, string>;
  input: ManualSubmissionInput | null;
} {
  const next: Record<string, string> = {};

  if (form.source.trim().length === 0) next.source = 'Required.';
  if (form.eventType.trim().length === 0) next.eventType = 'Required.';

  const payloadParsed = parseJson(form.payload, true);
  if (!payloadParsed.ok) next.payload = payloadParsed.error;

  const headersParsed = parseJson(form.headers, true);
  if (!headersParsed.ok) next.headers = headersParsed.error;

  const builtAttempts: ManualSubmissionInput['attempts'] = [];
  form.attempts.forEach((attempt, i) => {
    const prefix = `attempt${i}`;
    if (attempt.requestUrl.trim().length === 0) {
      next[`${prefix}.requestUrl`] = 'Required.';
    } else {
      try {
        // A webhook delivery target is http(s); `new URL` alone would accept mailto:/foo: too.
        const parsed = new URL(attempt.requestUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next[`${prefix}.requestUrl`] = 'Must be an http(s) URL.';
        }
      } catch {
        next[`${prefix}.requestUrl`] = 'Must be a valid URL.';
      }
    }
    if (attempt.requestMethod.trim().length === 0) next[`${prefix}.requestMethod`] = 'Required.';

    const reqHeaders = parseJson(attempt.requestHeaders, true);
    if (!reqHeaders.ok) next[`${prefix}.requestHeaders`] = reqHeaders.error;
    const reqBody = parseJson(attempt.requestBody, false);
    if (!reqBody.ok) next[`${prefix}.requestBody`] = reqBody.error;
    const resHeaders = parseJson(attempt.responseHeaders, false);
    if (!resHeaders.ok) next[`${prefix}.responseHeaders`] = resHeaders.error;
    const resBody = parseJson(attempt.responseBody, false);
    if (!resBody.ok) next[`${prefix}.responseBody`] = resBody.error;

    let responseStatus: number | undefined;
    if (attempt.responseStatus.trim().length > 0) {
      responseStatus = Number(attempt.responseStatus);
      if (!Number.isInteger(responseStatus))
        next[`${prefix}.responseStatus`] = 'Must be an integer.';
    }
    let latencyMs: number | undefined;
    if (attempt.latencyMs.trim().length > 0) {
      latencyMs = Number(attempt.latencyMs);
      if (!Number.isInteger(latencyMs) || latencyMs < 0) {
        next[`${prefix}.latencyMs`] = 'Must be a non-negative integer.';
      }
    }

    builtAttempts.push({
      requestUrl: attempt.requestUrl.trim(),
      requestMethod: attempt.requestMethod.trim(),
      requestHeaders: (reqHeaders.ok ? reqHeaders.value : {}) as Record<string, string | string[]>,
      ...(reqBody.ok && reqBody.value !== undefined ? { requestBody: reqBody.value } : {}),
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      ...(resHeaders.ok && resHeaders.value !== undefined
        ? { responseHeaders: resHeaders.value as Record<string, string | string[]> }
        : {}),
      ...(resBody.ok && resBody.value !== undefined ? { responseBody: resBody.value } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(attempt.errorText.trim().length > 0 ? { errorText: attempt.errorText.trim() } : {}),
    });
  });

  if (Object.keys(next).length > 0) {
    return { errors: next, input: null };
  }

  return {
    errors: next,
    input: {
      source: form.source.trim(),
      eventType: form.eventType.trim(),
      payload: payloadParsed.ok ? payloadParsed.value : undefined,
      headers: (headersParsed.ok ? headersParsed.value : {}) as Record<string, string | string[]>,
      attempts: builtAttempts,
    },
  };
}
