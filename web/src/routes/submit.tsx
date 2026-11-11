import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, apiClient } from '../api/client';
import type { ManualSubmissionInput } from '../api/types';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';

// The manual-submission form. The server's Zod `ManualSubmissionSchema` is the contract of record
// (and it re-validates on POST — its ValidationError is surfaced inline below); this form can't
// import that schema cross-workspace, so it does lightweight local checks for fast feedback and
// leaves authoritative validation to the server. Keep the shape in lockstep with ManualSubmissionInput.

interface AttemptForm {
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

function emptyAttempt(): AttemptForm {
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

/** The server's Zod `flatten()` payload, surfaced when a POST is rejected despite local checks. */
interface ServerErrors {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
}

export default function SubmitPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [source, setSource] = useState('');
  const [eventType, setEventType] = useState('');
  const [payload, setPayload] = useState('');
  const [headers, setHeaders] = useState('{}');
  const [attempts, setAttempts] = useState<AttemptForm[]>([emptyAttempt()]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<ServerErrors | null>(null);

  const submit = useMutation({
    mutationFn: (input: ManualSubmissionInput) => apiClient.submitEvent(input),
    onSuccess: (event) => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success('Event submitted');
      navigate(`/events/${event.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'ValidationError' && err.details) {
        setServerErrors(err.details as ServerErrors);
        toast.error('The server rejected this submission');
      } else {
        toast.error(err instanceof Error ? err.message : 'Submission failed');
      }
    },
  });

  const updateAttempt = (index: number, patch: Partial<AttemptForm>): void =>
    setAttempts((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  function handleSubmit(): void {
    const next: Record<string, string> = {};

    if (source.trim().length === 0) next.source = 'Required.';
    if (eventType.trim().length === 0) next.eventType = 'Required.';

    const payloadParsed = parseJson(payload, true);
    if (!payloadParsed.ok) next.payload = payloadParsed.error;

    const headersParsed = parseJson(headers, true);
    if (!headersParsed.ok) next.headers = headersParsed.error;

    // Per-attempt checks; keys are prefixed `attempt{i}.field` so each input can show its own error.
    const builtAttempts: ManualSubmissionInput['attempts'] = [];
    attempts.forEach((attempt, i) => {
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
        requestHeaders: (reqHeaders.ok ? reqHeaders.value : {}) as Record<
          string,
          string | string[]
        >,
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

    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    setServerErrors(null);
    submit.mutate({
      source: source.trim(),
      eventType: eventType.trim(),
      payload: payloadParsed.ok ? payloadParsed.value : undefined,
      headers: (headersParsed.ok ? headersParsed.value : {}) as Record<string, string | string[]>,
      attempts: builtAttempts,
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Submit an event</h1>
        <p className="text-muted-foreground">
          Paste a webhook event plus its delivery attempt(s) to investigate.
        </p>
      </div>

      {serverErrors && serverErrors.formErrors.length > 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {serverErrors.formErrors.join(' ')}
          </CardContent>
        </Card>
      ) : null}

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Event</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <LabeledInput
              label="Source"
              placeholder="e.g. github"
              value={source}
              onChange={setSource}
              error={errors.source ?? fieldError(serverErrors, 'source')}
            />
            <LabeledInput
              label="Event type"
              placeholder="e.g. push"
              value={eventType}
              onChange={setEventType}
              error={errors.eventType ?? fieldError(serverErrors, 'eventType')}
            />
            <LabeledTextarea
              className="sm:col-span-2"
              label="Payload (JSON)"
              placeholder='{ "action": "opened" }'
              value={payload}
              onChange={setPayload}
              error={errors.payload ?? fieldError(serverErrors, 'payload')}
            />
            <LabeledTextarea
              className="sm:col-span-2"
              label="Event headers (JSON)"
              value={headers}
              onChange={setHeaders}
              error={errors.headers ?? fieldError(serverErrors, 'headers')}
            />
          </CardContent>
        </Card>

        {attempts.map((attempt, index) => (
          <Card key={attempt.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Attempt #{index + 1}</CardTitle>
              {attempts.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttempts((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 /> Remove
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <LabeledInput
                className="sm:col-span-2"
                label="Request URL"
                placeholder="https://example.com/webhook"
                value={attempt.requestUrl}
                onChange={(v) => updateAttempt(index, { requestUrl: v })}
                error={errors[`attempt${index}.requestUrl`]}
              />
              <LabeledInput
                label="Method"
                value={attempt.requestMethod}
                onChange={(v) => updateAttempt(index, { requestMethod: v })}
                error={errors[`attempt${index}.requestMethod`]}
              />
              <LabeledInput
                label="Response status"
                placeholder="e.g. 401"
                value={attempt.responseStatus}
                onChange={(v) => updateAttempt(index, { responseStatus: v })}
                error={errors[`attempt${index}.responseStatus`]}
              />
              <LabeledTextarea
                label="Request headers (JSON)"
                value={attempt.requestHeaders}
                onChange={(v) => updateAttempt(index, { requestHeaders: v })}
                error={errors[`attempt${index}.requestHeaders`]}
              />
              <LabeledTextarea
                label="Request body (JSON, optional)"
                value={attempt.requestBody}
                onChange={(v) => updateAttempt(index, { requestBody: v })}
                error={errors[`attempt${index}.requestBody`]}
              />
              <LabeledTextarea
                label="Response headers (JSON, optional)"
                value={attempt.responseHeaders}
                onChange={(v) => updateAttempt(index, { responseHeaders: v })}
                error={errors[`attempt${index}.responseHeaders`]}
              />
              <LabeledTextarea
                label="Response body (JSON, optional)"
                value={attempt.responseBody}
                onChange={(v) => updateAttempt(index, { responseBody: v })}
                error={errors[`attempt${index}.responseBody`]}
              />
              <LabeledInput
                label="Latency (ms, optional)"
                value={attempt.latencyMs}
                onChange={(v) => updateAttempt(index, { latencyMs: v })}
                error={errors[`attempt${index}.latencyMs`]}
              />
              <LabeledInput
                label="Error text (optional)"
                placeholder="e.g. ECONNRESET"
                value={attempt.errorText}
                onChange={(v) => updateAttempt(index, { errorText: v })}
                error={errors[`attempt${index}.errorText`]}
              />
            </CardContent>
          </Card>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempts((prev) => [...prev, emptyAttempt()])}
          >
            <Plus /> Add attempt
          </Button>
          <Button type="submit" disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : null}
            Submit event
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Pull a top-level field's server error (Zod `flatten().fieldErrors` only keys the top level). */
function fieldError(serverErrors: ServerErrors | null, key: string): string | undefined {
  return serverErrors?.fieldErrors[key]?.join(' ');
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${className ?? ''}`}>
      {label}
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  error,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium ${className ?? ''}`}>
      {label}
      <Textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        className="font-mono text-xs"
      />
      {error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}
    </label>
  );
}
