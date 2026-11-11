import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { EventSummary } from '../api/types';
import { CategoryBadge } from '../components/category-badge';
import { ConfidenceBadge } from '../components/confidence-badge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { formatDateTime } from '../lib/format';

// The events dashboard: newest-first table of captured/seeded failures with client-side filters.
// Filtering is done in the browser over the already-small enriched list (no server round-trip per
// facet) — the server returns summaries, the UI slices them.

type InvestigatedState = 'all' | 'investigated' | 'not_investigated';
const ALL = 'all';

interface Filters {
  category: string; // FailureCategory | 'all'
  investigated: InvestigatedState;
  source: string; // a source value | 'all'
  status: string; // a status code as string | 'all'
}

const INITIAL_FILTERS: Filters = {
  category: ALL,
  investigated: ALL,
  source: ALL,
  status: ALL,
};

/** Apply the active filters to the event list. Pure so the facet logic stays easy to reason about. */
function filterEvents(events: EventSummary[], filters: Filters): EventSummary[] {
  return events.filter((event) => {
    if (
      filters.category !== ALL &&
      event.latestInvestigation?.failureCategory !== filters.category
    ) {
      return false;
    }
    if (filters.investigated === 'investigated' && event.latestInvestigation == null) return false;
    if (filters.investigated === 'not_investigated' && event.latestInvestigation != null) {
      return false;
    }
    if (filters.source !== ALL && event.source !== filters.source) return false;
    if (filters.status !== ALL && String(event.primaryResponseStatus) !== filters.status) {
      return false;
    }
    return true;
  });
}

/** The visual weight of an HTTP status: 5xx/4xx are failures, everything else neutral. */
function statusVariant(status: number | null): 'destructive' | 'secondary' | 'outline' {
  if (status == null) return 'outline';
  if (status >= 500) return 'destructive';
  if (status >= 400) return 'secondary';
  return 'outline';
}

export default function DashboardPage() {
  const {
    data: events,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['events'],
    queryFn: apiClient.listEvents,
  });
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  // Facet option lists are derived from the data so only values that actually occur are offered.
  const sources = useMemo(
    () => Array.from(new Set((events ?? []).map((e) => e.source))).sort(),
    [events],
  );
  const statuses = useMemo(
    () =>
      Array.from(
        new Set(
          (events ?? []).map((e) => e.primaryResponseStatus).filter((s): s is number => s != null),
        ),
      ).sort((a, b) => a - b),
    [events],
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          (events ?? [])
            .map((e) => e.latestInvestigation?.failureCategory)
            .filter((c): c is NonNullable<typeof c> => c != null),
        ),
      ).sort(),
    [events],
  );

  const visible = useMemo(() => filterEvents(events ?? [], filters), [events, filters]);
  const filtersActive = Object.values(filters).some((v) => v !== ALL);

  if (isError) {
    return (
      <PageFrame>
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="text-sm text-muted-foreground">
              Couldn’t load events{error instanceof Error ? `: ${error.message}` : '.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="flex flex-wrap items-end gap-3">
        <FacetSelect
          label="Category"
          value={filters.category}
          onChange={(category) => setFilters((f) => ({ ...f, category }))}
          options={categories.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
          allLabel="All categories"
        />
        <FacetSelect
          label="State"
          value={filters.investigated}
          onChange={(investigated) =>
            setFilters((f) => ({ ...f, investigated: investigated as InvestigatedState }))
          }
          options={[
            { value: 'investigated', label: 'Investigated' },
            { value: 'not_investigated', label: 'Not investigated' },
          ]}
          allLabel="Any state"
        />
        <FacetSelect
          label="Source"
          value={filters.source}
          onChange={(source) => setFilters((f) => ({ ...f, source }))}
          options={sources.map((s) => ({ value: s, label: s }))}
          allLabel="All sources"
        />
        <FacetSelect
          label="HTTP status"
          value={filters.status}
          onChange={(status) => setFilters((f) => ({ ...f, status }))}
          options={statuses.map((s) => ({ value: String(s), label: String(s) }))}
          allLabel="Any status"
        />
        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters(INITIAL_FILTERS)}>
            Clear
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : events.length === 0 ? (
        <EmptyState />
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            No events match the current filters.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source / event</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Diagnosis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link
                      to={`/events/${event.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {event.source}
                    </Link>
                    <div className="text-xs text-muted-foreground">{event.eventType}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(event.receivedAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{event.attemptCount}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(event.primaryResponseStatus)}>
                      {event.primaryResponseStatus ?? 'none'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {event.latestInvestigation ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <CategoryBadge category={event.latestInvestigation.failureCategory} />
                        <ConfidenceBadge score={event.latestInvestigation.confidence} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not yet investigated</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="text-muted-foreground">Captured and seeded webhook failures, newest first.</p>
      </div>
      {children}
    </div>
  );
}

// Radix rejects empty-string item values, so `all` is a real sentinel item. To stop a facet value
// that happens to be the literal "all" (e.g. an event sourced "all") from colliding with it, real
// option values are namespaced with this prefix inside the Select and stripped back out on change —
// the stored filter state and `filterEvents` still speak the bare value.
const VAL_PREFIX = 'val:';

/** A labelled facet dropdown over a bare-value filter, with collision-proof Radix item encoding. */
function FacetSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Select
        value={value === ALL ? ALL : `${VAL_PREFIX}${value}`}
        onValueChange={(encoded) =>
          onChange(encoded === ALL ? ALL : encoded.slice(VAL_PREFIX.length))
        }
      >
        <SelectTrigger className="h-8 w-44 capitalize">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={`${VAL_PREFIX}${option.value}`}
              className="capitalize"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No events yet. Seed the sample scenarios or submit one to investigate.
        </p>
        <Button asChild size="sm">
          <Link to="/submit">Submit an event</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
