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
  // 204/empty bodies aren't expected on the typed endpoints below, but tolerate them.
  if (res.status === 204) {
    return undefined as T;
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
