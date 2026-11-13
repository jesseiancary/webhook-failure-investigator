import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import { RouteError } from './components/route-error';

// Route components are lazy-loaded so each screen (and its deps — e.g. Radix Select on submit, the
// SSE chat client behind the detail page) ships in its own chunk and loads on navigation rather than
// up front. The AppShell wraps the <Outlet/> in a Suspense fallback, so there's one loading boundary
// for all of them. The chat panel stays additionally split inside event-detail (see that file).
const DashboardPage = lazy(() => import('./routes/dashboard'));
const EventDetailPage = lazy(() => import('./routes/event-detail'));
const SubmitPage = lazy(() => import('./routes/submit'));
const NotFoundPage = lazy(() => import('./routes/not-found'));

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    // Root boundary: catches failures in AppShell's own chrome (header, ThemeToggle, the Suspense
    // fallback). Renders a full-page RouteError — the chrome is what failed, so there's none to keep.
    errorElement: <RouteError />,
    children: [
      // A pathless wrapper carries its own errorElement so a thrown render/loader error from the
      // route content renders the RouteError card inside the shell (nav + outlet) rather than
      // replacing the whole AppShell.
      {
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/events/:id', element: <EventDetailPage /> },
          { path: '/submit', element: <SubmitPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
