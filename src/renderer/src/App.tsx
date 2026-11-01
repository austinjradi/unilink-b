import { Center, createTheme, Loader, MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { MeContext } from './lib/hooks';
import { rpc, RpcError } from './lib/rpc';
import { ResetPassword, SignIn, SignUp } from './pages/Auth';
import { CalendarPage } from './pages/Calendar';
import { ClassPage } from './pages/ClassPage';
import { ClassesPage } from './pages/Classes';
import { Dashboard } from './pages/Dashboard';
import { IntegrationsPage } from './pages/Integrations';
import { PlannerPage } from './pages/Planner';
import { ProfilePage } from './pages/Profile';

const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
});

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    // A session that ends mid-use drops back to the sign-in screen.
    onError: (error) => {
      if (error instanceof RpcError && error.code === 'UNAUTHORIZED') queryClient.setQueryData(['me'], null);
    },
  }),
});

function Root() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => rpc.auth.me() });

  if (me.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<SignIn />} />
      </Routes>
    );
  }

  return (
    <MeContext.Provider value={me.data}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/classes" element={<ClassesPage />} />
          <Route path="/classes/:classId/:tab?" element={<ClassPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </MeContext.Provider>
  );
}

export function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <DatesProvider settings={{ firstDayOfWeek: 1 }}>
        <Notifications position="top-right" />
        <QueryClientProvider client={queryClient}>
          <ModalsProvider>
            <HashRouter>
              <Root />
            </HashRouter>
          </ModalsProvider>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  );
}
