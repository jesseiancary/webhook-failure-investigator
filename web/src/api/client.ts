import type {
  EventDetail,
  EventSummary,
  Investigation,
  InvestigationRecord,
  InvestigationSummary,
  ManualSubmissionInput,
} from './types';

// A thin typed wrapper over fetch. Paths are relative ('/events', …), so in dev they hit the Vite
// proxy (see vite.config.ts) and in a same-origin deployment they hit the API directly — no base-URL
// config needed. Non-2xx responses are turned into a thrown ApiError carrying the server's stable
// error envelope ({ error, details }); TanStack Query surfaces that to the UI.

/** The error envelope the API returns on 4xx/5xx (see server/src/http/error-handler.ts and routes). */
export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  /** The stable server label, e.g. 'ValidationError' | 'NotFound' | 'InternalServerError'. */
  readonly code: string;
  /** Field-level detail for a ValidationError (Zod `flatten()` output), when present. */
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(`${body.error} (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error;
    this.details = body.details;
  }
}

/**
 * Thrown when a 2xx response carries no body on an endpoint whose contract guarantees a JSON payload
 * (every `request<T>` endpoint does). This is a client/server *contract* violation on an otherwise
 * successful status — deliberately NOT an `ApiError`, which models the server's 4xx/5xx error
 * envelope. Keeping it a separate type means `instanceof ApiError` consumers (e.g. the chat panel's
 * "Request failed (status)" render, submit.tsx's ValidationError branch) can't misread it as a
 * server-reported failure, and its `status` field isn't mistaken for a real error status. When a
 * genuinely void endpoint lands it should use a dedicated `requestVoid` helper instead of
 * `request<T>`, and will never reach this path.
 */
export class EmptyResponseError extends Error {
  /** The 2xx status that unexpectedly carried no body (e.g. 204). */
  readonly status: number;
  /** The request path, for diagnostics. */
  readonly path: string;

  constructor(path: string, status: number) {
    super(`The API returned ${status} with no body for ${path}, but a JSON payload was expected.`);
    this.name = 'EmptyResponseError';
    this.status = status;
    this.path = path;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  // The error body is JSON for every path we control, but guard against a proxy/HTML error page.
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body);
  } catch {
    return new ApiError(res.status, { error: res.statusText || 'RequestFailed' });
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  // Every typed endpoint below returns a JSON body, so a 204/No Content response is a contract
  // violation, not a success value — surface it as a distinct EmptyResponseError (not an ApiError,
  // which is for genuine server error envelopes) instead of silently casting `undefined` to T. When a
  // genuinely void write endpoint first lands (likely the Phase 10 auth/write gate; see the ROADMAP
  // Phase 7 follow-up), add a dedicated `requestVoid` helper for it rather than widening this path.
  if (res.status === 204) {
    throw new EmptyResponseError(path, res.status);
  }
  return (await res.json()) as T;
}

export const apiClient = {
  listEvents: () => request<EventSummary[]>('/events'),
  getEvent: (id: string) => request<EventDetail>(`/events/${encodeURIComponent(id)}`),
  submitEvent: (input: ManualSubmissionInput) =>
    request<EventDetail>('/events', { method: 'POST', body: JSON.stringify(input) }),
  listInvestigations: (eventId: string) =>
    request<InvestigationSummary[]>(`/events/${encodeURIComponent(eventId)}/investigations`),
  investigate: (eventId: string) =>
    request<InvestigationRecord>(`/events/${encodeURIComponent(eventId)}/investigate`, {
      method: 'POST',
    }),
  getInvestigation: (id: string) =>
    request<Investigation>(`/investigations/${encodeURIComponent(id)}`),
};
