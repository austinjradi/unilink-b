import { type Query, type QueryClient } from '@tanstack/react-query';
import { loadAwards, loadContacts, loadContents, loadCourses, loadGuide, loadIndex, loadOfferings, loadPrereqs, loadPrograms, loadSubjects } from '@shared/catalogue';

// The catalogue never changes while the page is open, so a write has no reason to reload it.
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

export const changesWithWrites = (query: Query) => !(query.queryKey[0] === 'catalogue' && FIXED.has(String(query.queryKey[1])));

const whenIdle = (run: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));

// Loads the catalogue and the pages that show it once the site is up, one piece each time the
// browser is idle, so opening them later is instant. Most-used first; skipped for data savers.
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
  const next = () => {
    const step = steps.shift();
    if (step) whenIdle(() => void step().catch(() => undefined).finally(next));
  };
  next();
}
