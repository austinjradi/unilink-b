import { type Query, type QueryClient } from '@tanstack/react-query';
import { loadAwards, loadContacts, loadContents, loadCourses, loadGuide, loadIndex, loadOfferings, loadPrereqs, loadPrograms, loadSubjects } from '@shared/catalogue';

// The catalogue never changes while the page is open, so a write has no reason to reload it.
// An array of tuples. The type spells out each item: a name, then a function that returns a promise.
const CATALOGUE_PARTS: [string, () => Promise<unknown>][] = [
  ['courses', loadCourses],
  ['offerings', loadOfferings],
  ['prereqs', loadPrereqs],
  ['index', loadIndex],
  ['programs', loadPrograms],
  ['contents', loadContents],
  ['contacts', loadContacts],
  ['awards', loadAwards],
  ['guide', loadGuide],
];
const FIXED = new Set(CATALOGUE_PARTS.map(([name]) => name));

// A predicate for invalidateQueries: it returns true for each query that
// should refresh. Queries keyed ['catalogue', <a fixed part>] are left alone.
export const changesWithWrites = (query: Query) => !(query.queryKey[0] === 'catalogue' && FIXED.has(String(query.queryKey[1])));

// requestIdleCallback runs a function when the browser has nothing else to do, and the
// timeout makes sure it runs within 2 seconds. Safari lacks it, so setTimeout stands in.
const whenIdle = (run: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));

// Loads the catalogue and the pages that show it once the site is up, one piece each time the
// browser is idle, so opening them later is instant. Most-used first; skipped for data savers.
// prefetchQuery fills the cache under the same key the pages use, so
// a page's later useQuery with that key finds the data already there.
export function preloadCatalogue(client: QueryClient) {
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const steps: (() => Promise<unknown>)[] = [
    ...CATALOGUE_PARTS.slice(0, 3).map(([name, load]) => () => client.prefetchQuery({ queryKey: ['catalogue', name], queryFn: load, staleTime: Infinity })),
    loadSubjects,
    () => import('../pages/Classes'),
    () => import('../pages/Catalogue'),
    () => import('../pages/Calendar'),
    ...CATALOGUE_PARTS.slice(3).map(([name, load]) => () => client.prefetchQuery({ queryKey: ['catalogue', name], queryFn: load, staleTime: Infinity })),
  ];
  // One step per idle moment: take the next step, run it, and when it settles, schedule
  // the one after. Failures are ignored, because a page can still load its data itself.
  const next = () => {
    const step = steps.shift();
    if (step) whenIdle(() => void step().catch(() => undefined).finally(next));
  };
  next();
}
