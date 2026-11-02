// S4 "already asked?": finds posts that share words with the title of a post being written,
// so classmates find the existing thread (and its accepted answer) before asking again.

const STOPWORDS = new Set(
  `a an and are as at be but by can could do does for from had has have how i if in into is it its just me my of on or
  should so than that the then there this to was we were what when where which who why will with would you your
  anyone anybody about any get got still also
  au aux avec ce ces cette dans de des du elle en est et il je la le les leur mais ne nous on ou pas pour qu que qui
  quoi sa se son sur ta te tu un une vous`.split(/\s+/),
);

// Lowercase words without accents, stopwords or a plural "s".
export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );
}

// How much of the new title another post covers: a word in its title counts fully, one only
// in its body half. Below 0.5, or fewer than two shared words, it isn't similar.
export function similarity(query: Set<string>, title: string, body: string): number {
  if (query.size < 2) return 0;
  const inTitle = keywords(title);
  const inBody = keywords(body);
  let titleHits = 0;
  let bodyHits = 0;
  for (const word of query) {
    if (inTitle.has(word)) titleHits++;
    else if (inBody.has(word)) bodyHits++;
  }
  if (titleHits + bodyHits < 2) return 0;
  const score = (titleHits + bodyHits / 2) / query.size;
  return score >= 0.5 ? score : 0;
}
