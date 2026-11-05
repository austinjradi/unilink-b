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
import { preloadCatalogue } from './lib/preload';
import { rpc, RpcError } from './lib/rpc';
import { ResetPassword, SignIn, SignUp } from './pages/Auth';
import { Home } from './pages/Home';
import { cssVariablesResolver, theme } from './theme';

// Sign-in and Home load with the app; the other pages load when first opened, so the
// first visit downloads less (the web build is opened from a link, often on a phone).
// A generic arrow function. K is the export's name as a string literal type, so page(() =>
// import('./pages/Calendar'), 'CalendarPage') is checked: the module must export a component with that
// name. React.lazy expects a module with a default export, so .then() builds one from the named export.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().catch(reloadForNewVersion).then((m) => ({ default: m[name] })));
// Vite puts each import() target in its own file, downloaded the first time that page renders.
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
// Promise<never> means the promise never gives back a value:
// it either throws, or never settles while the page reloads.
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
// An error boundary has to be a class: React has no hook for catching errors thrown
// while rendering children. Component<Props, State> types this.props and this.state.
class PageBoundary extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  // React calls this when a child throws during rendering. The object it
  // returns is merged into state, which switches render() to the fallback.
  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Runs after every update, with the previous props. Moving to
  // another path clears the error, so the next page gets a fresh try.
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

// Created once, outside every component, so re-renders never
// replace it. It holds every cached query result in the app.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  // An onError on the cache itself runs once for each failed query, wherever that query is used.
  queryCache: new QueryCache({
    // A session that ends mid-use drops back to the sign-in screen.
    onError: (error) => {
      if (error instanceof RpcError && error.code === 'UNAUTHORIZED') queryClient.setQueryData(['me'], null);
    },
  }),
});

// Everything inside HashRouter: the sign-in gate, then the routes.
// It has to sit inside the router because it uses useLocation.
function Root() {
  // The empty dependency array runs this once after the first render (twice in development,
  // because of StrictMode). preloadCatalogue returns undefined, so there's no cleanup.
  useEffect(() => preloadCatalogue(queryClient), []);
  const { pathname } = useLocation();
  // The signed-in user, or null. This one query decides between the sign-in screens and the app.
  const me = useQuery({ queryKey: ['me'], queryFn: () => rpc.auth.me() });
  const { locale, setLocale } = useLocale();
  const forced = useForcedLocale();
  const highContrast = useVariant('high-contrast');
  const largerText = useVariant('larger-text');
  useEffect(() => {
    // toggleAttribute(name, force) adds the attribute on <html> when force is
    // true and removes it when false. styles.css has rules for these attributes.
    document.documentElement.toggleAttribute('data-high-contrast', highContrast);
    document.documentElement.toggleAttribute('data-larger-text', largerText);
  }, [highContrast, largerText]);

  // A signed-in student's saved language wins over this device's last choice.
  // `??` takes the first value that isn't null or undefined:
  // a forced language, else the account's, else undefined.
  const saved = forced ?? me.data?.locale;
  useEffect(() => {
    // Updating state to match a query belongs in an effect. Calling
    // setLocale during render would start another render straight away.
    if (saved && saved !== locale) setLocale(saved);
  }, [saved, locale, setLocale]);

  // isPending is true until the first answer arrives, which
  // can take a moment while the bridge opens the database.
  if (me.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  // Signed out: only these routes exist, and any other URL shows the sign-in form.
  if (!me.data) {
    return (
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route path="/reset" element={<ResetPassword />} />
        {/* A path of * matches whatever the routes above didn't. */}
        <Route path="*" element={<SignIn />} />
      </Routes>
    );
  }

  return (
    // Every component below can call useMe() and get this user, never null.
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
            {/* :tab? is an optional URL parameter; the page reads it with useParams(). */}
            <Route path="/courses/:tab?" element={<CoursesPage />} />
            {/* <Navigate> redirects as soon as it renders. replace swaps the */}
            {/* history entry, so Back doesn't land on the redirect again. */}
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
            {/* Anything unknown goes to Home. */}
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

// The outermost component: the providers everything else needs. Each
// Provider puts a value into React context for every component below it.
export function App() {
  const sundayFirst = useVariant('week-starts-sunday');
  const listOpen = useListOpen();
  // useState<Locale>(…) gives the state an explicit type. getLocale()
  // runs on every render, but React only uses its first result.
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  // useCallback keeps the same function object from render to render, so effects
  // that list it as a dependency (like Root's) don't re-run for nothing.
  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    setLocaleState(next);
  }, []);

  const lightOnly = useVariant('light-only');

  return (
    // Double braces: the outer pair switches JSX into JavaScript, the inner
    // pair is an object literal. A new object every render re-renders every
    // consumer, which is fine for a value that changes this rarely.
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {/* forceColorScheme overrides the system's light or dark mode; undefined means no override. */}
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto" forceColorScheme={lightOnly ? 'light' : undefined}>
        <DatesProvider settings={{ firstDayOfWeek: sundayFirst ? 0 : 1, locale }}>
          {/* Toasts are about the site, so they wait until it's back. */}
          {!listOpen && <Notifications position="top-right" />}
          {/* Gives useQuery, useMutation and useQueryClient below access to the one queryClient. */}
          <QueryClientProvider client={queryClient}>
            {/* Re-mount everything on a language change so every label re-renders. */}
            <ModalsProvider key={locale}>
              <ReqInfoHost />
              {listOpen && <RequirementsView />}
              {/* Hidden rather than unmounted, so half-filled forms are still there on the way back. */}
              {/* display: contents removes the div itself from layout, */}
              {/* so its children lay out as if it weren't there. */}
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
