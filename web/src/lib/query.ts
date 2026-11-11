import { QueryClient } from '@tanstack/react-query';

// One shared client for the app. Defaults tuned for a dashboard: don't refetch on window focus
// (noisy for this tool), retry transient failures once, and treat data as fresh for a short window
// so navigating back to the list doesn't always re-hit the API.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
