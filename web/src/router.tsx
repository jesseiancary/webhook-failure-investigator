import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import DashboardPage from './routes/dashboard';
import EventDetailPage from './routes/event-detail';
import NotFoundPage from './routes/not-found';
import SubmitPage from './routes/submit';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/events/:id', element: <EventDetailPage /> },
      { path: '/submit', element: <SubmitPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
