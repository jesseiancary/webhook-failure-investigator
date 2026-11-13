import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

// The router's error boundary (wired as the `errorElement` in src/router.tsx). It catches anything a
// route's render or data loading throws — the generic sibling of the per-screen error cards — and
// renders a friendly recovery card instead of React Router's bare default screen. The underlying
// error message is shown in dev only; in a build it stays hidden so internals never leak to a viewer.

/** Pull a human-readable message out of whatever was thrown (Response, Error, or anything else). */
function errorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

export function RouteError() {
  const error = useRouteError();
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold text-muted-foreground">Oops</p>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error interrupted this page. Try again from the dashboard.
      </p>
      {import.meta.env.DEV ? (
        <Card className="max-w-lg">
          <CardContent className="py-3 text-left font-mono text-xs break-all text-destructive">
            {errorMessage(error)}
          </CardContent>
        </Card>
      ) : null}
      {/* A full-document navigation, not a client-side <Link>: if this error is a failed lazy
          chunk load (e.g. a stale tab after a redeploy), React has cached the rejected import, so an
          SPA nav back would re-throw immediately. A real page load refetches the chunk and recovers. */}
      <Button asChild variant="outline">
        <a href="/">Back to dashboard</a>
      </Button>
    </div>
  );
}
