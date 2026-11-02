import { type ComponentType, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Center, Loader, MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { Layout } from './components/Layout';
import type { Locale } from '@shared/i18n';
import { MeContext } from './lib/hooks';
import { applyLocale, getLocale, LocaleContext, useLocale } from './lib/i18n';
import { rpc, RpcError } from './lib/rpc';
import { ResetPassword, SignIn, SignUp } from './pages/Auth';
import { Home } from './pages/Home';
import { cssVariablesResolver, theme } from './theme';

// Sign-in and Home load with the app; the other pages load when first opened, so the
// first visit downloads less (the web build is opened from a link, often on a phone).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const CalculatorPage = page(() => import('./pages/Calculator'), 'CalculatorPage');
const CalendarPage = page(() => import('./pages/Calendar'), 'CalendarPage');
const ClassPage = page(() => import('./pages/ClassPage'), 'ClassPage');
const CoursesPage = page(() => import('./pages/Classes'), 'CoursesPage');
const PlannerPage = page(() => import('./pages/Planner'), 'PlannerPage');
const SessionsPage = page(() => import('./pages/Sessions'), 'SessionsPage');
const SessionSearchPage = page(() => import('./pages/Sessions'), 'SessionSearchPage');
const SessionInvitePage = page(() => import('./pages/Sessions'), 'SessionInvitePage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');
const StudyModePage = page(() => import('./pages/StudyMode'), 'StudyModePage');

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
  const { locale, setLocale } = useLocale();

  // A signed-in student's saved language wins over this device's last choice.
  const saved = me.data?.locale;
  useEffect(() => {
    if (saved && saved !== locale) setLocale(saved);
  }, [saved, locale, setLocale]);

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
        <Suspense
          fallback={
            <Center py="xl">
              <Loader />
            </Center>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/courses/:tab?" element={<CoursesPage />} />
            <Route path="/classes" element={<Navigate to="/courses" replace />} />
            <Route path="/classes/:classId/:tab?" element={<ClassPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/search" element={<SessionSearchPage />} />
            <Route path="/sessions/join/:code" element={<SessionInvitePage />} />
            <Route path="/study-mode" element={<StudyModePage />} />
            <Route path="/settings/:tab?" element={<SettingsPage />} />
            {/* Older routes, still used by links in existing notifications. */}
            <Route path="/academics/:tab?" element={<RedirectAcademics />} />
            <Route path="/focus" element={<Navigate to="/study-mode" replace />} />
            <Route path="/settings/study-mode" element={<Navigate to="/study-mode" replace />} />
            <Route path="/profile" element={<Navigate to="/settings/account" replace />} />
            <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </MeContext.Provider>
  );
}

function RedirectAcademics() {
  const { tab } = useParams();
  return <Navigate to={tab === 'degree' ? '/courses/degree' : '/courses/record'} replace />;
}

export function App() {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    setLocaleState(next);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
        <DatesProvider settings={{ firstDayOfWeek: 1, locale }}>
          <Notifications position="top-right" />
          <QueryClientProvider client={queryClient}>
            {/* Re-mount everything on a language change so every label re-renders. */}
            <ModalsProvider key={locale}>
              <HashRouter>
                <Root />
              </HashRouter>
            </ModalsProvider>
          </QueryClientProvider>
        </DatesProvider>
      </MantineProvider>
    </LocaleContext.Provider>
  );
}
