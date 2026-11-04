import { Component, type ComponentType, lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Center, Loader, MantineProvider, Stack, Text } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { ReqInfoHost } from './components/ReqInfo';
import { RequirementsView } from './components/RequirementsView';
import { SiteBlockers } from './components/SiteBlockers';
import { useListOpen } from './lib/reqView';
import { useForcedLocale, useVariant } from './lib/variants';
import type { Locale } from '@shared/i18n';
import { MeContext } from './lib/hooks';
import { applyLocale, getLocale, LocaleContext, t, useLocale } from './lib/i18n';
import { rpc, RpcError } from './lib/rpc';
import { ResetPassword, SignIn, SignUp } from './pages/Auth';
import { Home } from './pages/Home';
import { cssVariablesResolver, theme } from './theme';

// Sign-in and Home load with the app; the other pages load when first opened, so the
// first visit downloads less (the web build is opened from a link, often on a phone).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().catch(reloadForNewVersion).then((m) => ({ default: m[name] })));
const CalculatorPage = page(() => import('./pages/Calculator'), 'CalculatorPage');
const CalendarPage = page(() => import('./pages/Calendar'), 'CalendarPage');
const CataloguePage = page(() => import('./pages/Catalogue'), 'CataloguePage');
const ClassPage = page(() => import('./pages/ClassPage'), 'ClassPage');
const CoursesPage = page(() => import('./pages/Classes'), 'CoursesPage');
const ProfilePage = page(() => import('./pages/Settings'), 'ProfilePage');
const AcademicsPage = page(() => import('./pages/Classes'), 'AcademicsPage');
const PlannerPage = page(() => import('./pages/Planner'), 'PlannerPage');
const SessionsPage = page(() => import('./pages/Sessions'), 'SessionsPage');
const SessionSearchPage = page(() => import('./pages/Sessions'), 'SessionSearchPage');
const SessionInvitePage = page(() => import('./pages/Sessions'), 'SessionInvitePage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');
const StudyModePage = page(() => import('./pages/StudyMode'), 'StudyModePage');

// After a new version is deployed, a tab that's still open asks for page files that are gone.
// Reloading gets the new version. If it fails again right after that (the network is really
// down), PageBoundary says so instead of reloading forever.
function reloadForNewVersion(error: unknown): Promise<never> {
  const key = 'unilink-reloaded-for-update';
  let justReloaded = true;
  try {
    justReloaded = Date.now() - Number(sessionStorage.getItem(key)) < 30_000;
    if (!justReloaded) sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // No session storage: don't risk a reload loop.
  }
  if (justReloaded) throw error;
  window.location.reload();
  // Keep the loading spinner up until the page goes away.
  return new Promise(() => {});
}

// A page that can't load or crashes takes only itself down, not the whole app.
class PageBoundary extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { path: string }) {
    if (previous.path !== this.props.path && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Center py="xl">
        <Stack align="center" gap="xs" ta="center">
          <Text fw={800} size="lg" className="display">
            {t("This page didn't load")}
          </Text>
          <Text size="sm" c="dimmed">
            {t('Check your connection and try again. Everything you saved is still in this browser.')}
          </Text>
          <Button mt="xs" onClick={() => window.location.reload()}>
            {t('Reload')}
          </Button>
        </Stack>
      </Center>
    );
  }
}

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
  const { pathname } = useLocation();
  const me = useQuery({ queryKey: ['me'], queryFn: () => rpc.auth.me() });
  const { locale, setLocale } = useLocale();
  const forced = useForcedLocale();
  const highContrast = useVariant('high-contrast');
  const largerText = useVariant('larger-text');
  useEffect(() => {
    document.documentElement.toggleAttribute('data-high-contrast', highContrast);
    document.documentElement.toggleAttribute('data-larger-text', largerText);
  }, [highContrast, largerText]);

  // A signed-in student's saved language wins over this device's last choice.
  const saved = forced ?? me.data?.locale;
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
        <PageBoundary path={pathname}>
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
            <Route path="/catalogue/:tab?/:id?" element={<CataloguePage />} />
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
            <Route path="/profile" element={<ProfileRoute />} />
            <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </PageBoundary>
      </Layout>
    </MeContext.Provider>
  );
}

// 'separate-profile-page': the profile and the goat get a page of their own.
function ProfileRoute() {
  const ownPage = useVariant('separate-profile-page');
  return ownPage ? <ProfilePage /> : <Navigate to="/settings/account" replace />;
}

function RedirectAcademics() {
  const { tab } = useParams();
  const ownTab = useVariant('academics-tab');
  if (ownTab) return <AcademicsPage />;
  return <Navigate to={tab === 'degree' ? '/courses/degree' : '/courses/record'} replace />;
}

export function App() {
  const sundayFirst = useVariant('week-starts-sunday');
  const listOpen = useListOpen();
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    setLocaleState(next);
  }, []);

  const lightOnly = useVariant('light-only');

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto" forceColorScheme={lightOnly ? 'light' : undefined}>
        <DatesProvider settings={{ firstDayOfWeek: sundayFirst ? 0 : 1, locale }}>
          {/* Toasts are about the site, so they wait until it's back. */}
          {!listOpen && <Notifications position="top-right" />}
          <QueryClientProvider client={queryClient}>
            {/* Re-mount everything on a language change so every label re-renders. */}
            <ModalsProvider key={locale}>
              <ReqInfoHost />
              {listOpen && <RequirementsView />}
              {/* Hidden rather than unmounted, so half-filled forms are still there on the way back. */}
              <div style={{ display: listOpen ? 'none' : 'contents' }}>
                <SiteBlockers />
                <HashRouter>
                  <Root />
                </HashRouter>
              </div>
            </ModalsProvider>
          </QueryClientProvider>
        </DatesProvider>
      </MantineProvider>
    </LocaleContext.Provider>
  );
}
