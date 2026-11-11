import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

// A shared stub for the PR2 shell. Each screen's real implementation lands in Phase 7 PR3; these
// render the route so navigation, layout, providers, and the proxy are all exercisable now.
export function PagePlaceholder({
  title,
  description,
  lands,
  children,
}: {
  title: string;
  description: string;
  lands: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming in PR3</CardTitle>
          <CardDescription>{lands}</CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
    </div>
  );
}
