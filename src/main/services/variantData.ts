import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { appState } from '../db/schema';

// What people choose under a switched-on requirement change. It's kept in app_state so the tables
// stay as this version was built, and it's simply ignored once the change is switched back.

export function read<T>(db: DB, key: string, fallback: T): T {
  const row = db.select().from(appState).where(eq(appState.key, key)).get();
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function write(db: DB, key: string, value: unknown) {
  const text = JSON.stringify(value);
  db.insert(appState).values({ key, value: text }).onConflictDoUpdate({ target: appState.key, set: { value: text } }).run();
}

const ANONYMOUS_POSTS = 'variant-anonymous-posts';
const PENDING_LINKS = 'variant-pending-links';
const HIDDEN_FROM_LISTS = 'variant-hidden-from-class-lists';
const visibleFieldsKey = (userId: number) => `variant-visible-fields-${userId}`;

export const PROFILE_FIELDS = ['email', 'pronouns', 'faculty', 'gradYear'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const anonymousPostIds = (db: DB) => new Set(read<number[]>(db, ANONYMOUS_POSTS, []));

export const markAnonymous = (db: DB, postId: number) => write(db, ANONYMOUS_POSTS, [...anonymousPostIds(db), postId]);

export const pendingLinkIds = (db: DB) => new Set(read<number[]>(db, PENDING_LINKS, []));

export function setLinkPending(db: DB, linkId: number, pending: boolean) {
  const ids = pendingLinkIds(db);
  if (pending) ids.add(linkId);
  else ids.delete(linkId);
  write(db, PENDING_LINKS, [...ids]);
}

export const hiddenFromClassLists = (db: DB) => new Set(read<number[]>(db, HIDDEN_FROM_LISTS, []));

export function setHiddenFromClassLists(db: DB, userId: number, hidden: boolean) {
  const ids = hiddenFromClassLists(db);
  if (hidden) ids.add(userId);
  else ids.delete(userId);
  write(db, HIDDEN_FROM_LISTS, [...ids]);
}

export const visibleFieldsOf = (db: DB, userId: number) => read<ProfileField[]>(db, visibleFieldsKey(userId), [...PROFILE_FIELDS]);

export const setVisibleFields = (db: DB, userId: number, fields: ProfileField[]) => write(db, visibleFieldsKey(userId), fields);

// 'post-version-history': what a post said before each edit.
export interface PostVersion {
  title: string;
  body: string;
  at: number;
}
const versionsKey = (postId: number) => `variant-post-versions-${postId}`;
export const postVersions = (db: DB, postId: number) => read<PostVersion[]>(db, versionsKey(postId), []);
export const addPostVersion = (db: DB, postId: number, version: PostVersion) => write(db, versionsKey(postId), [...postVersions(db, postId), version]);

// 'threaded-replies': which reply each reply answers.
const REPLY_PARENTS = 'variant-reply-parents';
export const replyParents = (db: DB) => read<Record<string, number>>(db, REPLY_PARENTS, {});
export const setReplyParent = (db: DB, replyId: number, parentId: number) => write(db, REPLY_PARENTS, { ...replyParents(db), [replyId]: parentId });

// 'read-per-post': the posts someone has opened.
const readKey = (userId: number) => `variant-read-posts-${userId}`;
export const readPostIds = (db: DB, userId: number) => new Set(read<number[]>(db, readKey(userId), []));
export const markPostRead = (db: DB, userId: number, postId: number) => write(db, readKey(userId), [...readPostIds(db, userId), postId]);

// 'poll-posts': a post's options, and each person's vote.
interface Poll {
  options: string[];
  votes: Record<string, number>;
}
const pollKey = (postId: number) => `variant-poll-${postId}`;
const readPoll = (db: DB, postId: number) => read<Poll | null>(db, pollKey(postId), null);
export const setPoll = (db: DB, postId: number, options: string[]) => write(db, pollKey(postId), { options, votes: {} });
export function votePoll(db: DB, postId: number, userId: number, option: number) {
  const poll = readPoll(db, postId);
  if (!poll || !poll.options[option]) return false;
  write(db, pollKey(postId), { ...poll, votes: { ...poll.votes, [userId]: option } });
  return true;
}
export function pollFor(db: DB, postId: number, userId: number) {
  const poll = readPoll(db, postId);
  if (!poll) return null;
  const counted = Object.values(poll.votes);
  return { options: poll.options.map((text, i) => ({ text, votes: counted.filter((v) => v === i).length })), myVote: poll.votes[userId] ?? null };
}

