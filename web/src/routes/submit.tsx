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
import { type AttemptForm, emptyAttempt, validateSubmission } from '../lib/submission';

// The manual-submission form. The server's Zod `ManualSubmissionSchema` is the contract of record
// (and it re-validates on POST — its ValidationError is surfaced inline below); this form can't
// import that schema cross-workspace, so it does lightweight local checks for fast feedback (see
// lib/submission.ts) and leaves authoritative validation to the server.

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
    const { errors: next, input } = validateSubmission({
      source,
      eventType,
      payload,
      headers,
      attempts,
    });

    setErrors(next);
    if (input == null) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    setServerErrors(null);
    submit.mutate(input);
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
