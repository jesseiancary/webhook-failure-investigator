import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, Copy, Loader2 } from 'lucide-react';
import { type ReactNode, Suspense, lazy, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import type {
  DeliveryAttempt,
  Diagnosis,
  EventDetail,
  Evidence,
  Investigation,
  Reachability,
} from '../api/types';
import { CategoryBadge } from '../components/category-badge';
import { ConfidenceBadge } from '../components/confidence-badge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { formatCost, formatCount, formatDateTime } from '../lib/format';

// The chat panel pulls in the SSE streaming client (lib/sse.ts); code-split it so that machinery
// loads only on the detail route when a diagnosis exists, keeping it out of the dashboard's bundle.
const ChatPanel = lazy(() =>
  import('../components/chat-panel').then((module) => ({ default: module.ChatPanel })),
);

const REACHABILITY_LABEL: Record<Reachability, string> = {
  reachable: 'Reachable',
  unreachable: 'Unreachable',
  unknown: 'Unknown',
};

export default function EventDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const investigationsQuery = useQuery({
    queryKey: ['investigations', id],
    queryFn: () => apiClient.listInvestigations(id),
    enabled: id.length > 0,
  });
  const hasRuns = (investigationsQuery.data?.length ?? 0) > 0;

  // The newest investigation (server returns them newest-first); its fetch bundles the event
  // (+attempts), so when a run exists we read the event from here rather than fetching it twice.
  const latestId = investigationsQuery.data?.[0]?.id;
  const investigationQuery = useQuery({
    queryKey: ['investigation', latestId],
    queryFn: () => apiClient.getInvestigation(latestId as string),
    enabled: latestId != null,
  });
  const investigation = investigationQuery.data;

  // Only fetch the standalone event when GET /investigations/:id won't carry it: the not-yet-
  // investigated case, or as a fallback if the runs list itself failed to load.
  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => apiClient.getEvent(id),
    enabled:
      id.length > 0 && (investigationsQuery.isError || (investigationsQuery.isSuccess && !hasRuns)),
  });
  const displayedEvent = investigation?.event ?? eventQuery.data;

  const investigate = useMutation({
    mutationFn: () => apiClient.investigate(id),
    onSuccess: () => {
      // Refresh this event's runs (reselects the new latest) and the dashboard's badges.
      void queryClient.invalidateQueries({ queryKey: ['investigations', id] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success('Investigation complete');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Investigation failed'),
  });
  const investigating = investigate.isPending;

  // Which delivery-attempt panels are expanded — lifted here so an evidence citation can open (and
  // scroll to) the attempt row its `field` names, making the grounding link a real affordance.
  const [openAttempts, setOpenAttempts] = useState<Set<number>>(new Set());
  const toggleAttempt = (index: number): void =>
    setOpenAttempts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const citeAttempt = (index: number): void => {
    setOpenAttempts((prev) => new Set(prev).add(index));
    // The row wrapper carries the id whether or not it's expanded, so this scrolls either way.
    document
      .getElementById(`attempt-${index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Can't render anything meaningful until we know whether runs exist (that decides the event source).
  if (investigationsQuery.isPending) return <DetailSkeleton />;

  return (
    <div className="space-y-6">
      {displayedEvent ? <EventHeader event={displayedEvent} /> : <HeaderSkeleton />}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => investigate.mutate()} disabled={investigating}>
          {investigating ? <Loader2 className="animate-spin" /> : null}
          {hasRuns ? 'Re-investigate' : 'Investigate'}
        </Button>
        {investigationsQuery.data && investigationsQuery.data.length > 1 ? (
          <span className="text-sm text-muted-foreground">
            {investigationsQuery.data.length} runs · showing the latest
          </span>
        ) : null}
      </div>

      {/* The runs list and the full-investigation fetch each get explicit loading/error states, so
          "not yet investigated" is only ever shown once the list has actually settled empty. */}
      {investigationsQuery.isError ? (
        <ErrorCard
          message="Couldn’t load this event’s investigations."
          detail={
            investigationsQuery.error instanceof Error
              ? investigationsQuery.error.message
              : undefined
          }
          onRetry={() => void investigationsQuery.refetch()}
        />
      ) : investigating ? (
        <DiagnosisSkeleton />
      ) : !hasRuns ? (
        eventQuery.isError ? (
          <ErrorCard
            message="Couldn’t load this event."
            detail={eventQuery.error instanceof Error ? eventQuery.error.message : undefined}
            onRetry={() => void eventQuery.refetch()}
          />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              This event hasn’t been investigated yet. Run an investigation to get a grounded
              diagnosis.
            </CardContent>
          </Card>
        )
      ) : investigationQuery.isError ? (
        <ErrorCard
          message="Couldn’t load the diagnosis for this run."
          detail={
            investigationQuery.error instanceof Error ? investigationQuery.error.message : undefined
          }
          onRetry={() => void investigationQuery.refetch()}
        />
      ) : investigation == null ? (
        <DiagnosisSkeleton />
      ) : (
        <>
          <DiagnosisCard diagnosis={investigation.diagnosis} />
          <EvidenceCard
            evidence={investigation.diagnosis.evidence}
            attemptCount={investigation.event.attempts.length}
            onCiteAttempt={citeAttempt}
          />
          {/* Keyed by run id so the checklist's local checked-state never carries across a re-investigate. */}
          <RemediationCard
            key={investigation.id}
            steps={investigation.diagnosis.remediationSteps}
          />
          <AccountingCard investigation={investigation} />
        </>
      )}

      {displayedEvent ? (
        <AttemptsCard
          attempts={displayedEvent.attempts}
          open={openAttempts}
          onToggle={toggleAttempt}
        />
      ) : null}

      {investigation ? (
        <Suspense fallback={<DiagnosisSkeleton />}>
          <ChatPanel investigationId={investigation.id} initialMessages={investigation.messages} />
        </Suspense>
      ) : null}
    </div>
  );
}

function EventHeader({ event }: { event: EventDetail }) {
  const copyId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(event.id);
      toast.success('Event id copied — use it to re-deliver the webhook');
    } catch {
      toast.error('Couldn’t copy the event id');
    }
  };
  return (
    <div className="space-y-2">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← All events
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{event.source}</h1>
        <Badge variant="outline">{event.eventType}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Received {formatDateTime(event.receivedAt)}</p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-muted px-2 py-1 text-xs">{event.id}</code>
        <Button variant="ghost" size="sm" onClick={() => void copyId()}>
          <Copy /> Copy id to retry
        </Button>
      </div>
    </div>
  );
}

function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Diagnosis</CardTitle>
          <CategoryBadge category={diagnosis.failureCategory} />
          <ConfidenceBadge score={diagnosis.confidence} />
          <Badge variant="outline">{REACHABILITY_LABEL[diagnosis.reachabilityAssessment]}</Badge>
          {diagnosis.isSpeculative ? (
            <Badge variant="secondary" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Speculative
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{diagnosis.rootCause}</p>
      </CardContent>
    </Card>
  );
}

/** Pull a leading `attempts[N]` index out of an evidence `field` path, if it names one. */
export function citedAttemptIndex(field: string, attemptCount: number): number | null {
  const match = /^attempts\[(\d+)\]/.exec(field);
  if (!match) return null;
  const index = Number(match[1]);
  return index < attemptCount ? index : null;
}

export function EvidenceCard({
  evidence,
  attemptCount,
  onCiteAttempt,
}: {
  evidence: Evidence[];
  attemptCount: number;
  onCiteAttempt: (index: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
        <CardDescription>
          Each citation names the delivery-log field it relied on — click a field to open the
          matching delivery attempt below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence was cited.</p>
        ) : (
          <ul className="space-y-3">
            {evidence.map((item, index) => {
              const attemptIndex = citedAttemptIndex(item.field, attemptCount);
              return (
                <li key={`${item.field}-${index}`} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {attemptIndex != null ? (
                      <button
                        type="button"
                        onClick={() => onCiteAttempt(attemptIndex)}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium underline decoration-dotted underline-offset-2 hover:bg-accent hover:text-accent-foreground"
                        title={`Open attempt #${attemptIndex + 1}`}
                      >
                        {item.field}
                      </button>
                    ) : (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                        {item.field}
                      </code>
                    )}
                    <span className="break-all text-sm">{item.value}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RemediationCard({ steps }: { steps: string[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (index: number): void =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  if (steps.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Remediation</CardTitle>
        <CardDescription>A checklist to work through — check off steps as you go.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {steps.map((step, index) => {
            const checked = done.has(index);
            return (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  className="flex w-full items-start gap-2 text-left text-sm"
                  aria-pressed={checked}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                    }`}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className={checked ? 'text-muted-foreground line-through' : ''}>
                    {step}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function AccountingCard({ investigation }: { investigation: Investigation }) {
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Model', value: investigation.model },
    { label: 'Prompt tokens', value: formatCount(investigation.promptTokens) },
    { label: 'Completion tokens', value: formatCount(investigation.completionTokens) },
    { label: 'Cost', value: formatCost(investigation.costUsd) },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run accounting</CardTitle>
        <CardDescription>
          What this diagnosis cost — the credibility signal, in the open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="text-sm font-medium tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function AttemptsCard({
  attempts,
  open,
  onToggle,
}: {
  attempts: DeliveryAttempt[];
  open: Set<number>;
  onToggle: (index: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery attempts</CardTitle>
        <CardDescription>
          {attempts.length} attempt{attempts.length === 1 ? '' : 's'} · request & response, redacted
          server-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {attempts.map((attempt, index) => (
          <AttemptRow
            key={attempt.id}
            attempt={attempt}
            index={index}
            open={open.has(index)}
            onToggle={() => onToggle(index)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

// A controlled disclosure (not native <details>) so an evidence citation can open it programmatically.
// The wrapper keeps a stable `id` whether open or closed, so citeAttempt can scroll to it either way.
function AttemptRow({
  attempt,
  index,
  open,
  onToggle,
}: {
  attempt: DeliveryAttempt;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div id={`attempt-${index}`} className="scroll-mt-4 rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="font-medium">#{index + 1}</span>
        <span className="text-muted-foreground">
          {attempt.requestMethod} {attempt.requestUrl}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {attempt.responseStatus != null ? (
            <Badge variant={attempt.responseStatus >= 400 ? 'destructive' : 'outline'}>
              {attempt.responseStatus}
            </Badge>
          ) : attempt.errorText ? (
            <Badge variant="destructive">error</Badge>
          ) : null}
          {attempt.latencyMs != null ? (
            <span className="text-xs text-muted-foreground">{attempt.latencyMs} ms</span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t px-3 py-3 text-xs">
          {attempt.errorText ? (
            <Field label="Error">
              <p className="text-destructive">{attempt.errorText}</p>
            </Field>
          ) : null}
          <Field label="Request headers">
            <JsonBlock value={attempt.requestHeaders} />
          </Field>
          {attempt.requestBody != null ? (
            <Field label="Request body">
              <JsonBlock value={attempt.requestBody} />
            </Field>
          ) : null}
          <Field label="Response headers">
            <JsonBlock value={attempt.responseHeaders} />
          </Field>
          {attempt.responseBody != null ? (
            <Field label="Response body">
              <JsonBlock value={attempt.responseBody} />
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Pretty-print an unknown JSON value (headers/body come over the wire as `unknown`). */
function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <p className="text-muted-foreground">—</p>;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
      <code>{text}</code>
    </pre>
  );
}

function ErrorCard({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-8">
        <p className="text-sm text-muted-foreground">
          {message}
          {detail ? ` ${detail}` : ''}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-9 w-40" />
      <DiagnosisSkeleton />
    </div>
  );
}

function DiagnosisSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}
