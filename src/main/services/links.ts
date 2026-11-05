import { and, eq, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CHAT_PLATFORMS, isHidden, LINK_PURPOSES, type LinkPurpose, parseChatLink } from '@shared/links';
import { isOn } from '@shared/variants';
import type { DB } from '../db/client';
import { chatLinks, chatLinkVotes, classes, users } from '../db/schema';
import { AppError, idSchema, procedure } from '../rpc/core';
import { classLabel, notFound, professorsOf, requireMember, teaches } from './access';
import { m, notify, raw } from './notifications';
import { pendingLinkIds, setLinkPending } from './variantData';

// S2 in version B:
// - Links are shared with the class as soon as they're added (no private stage).
// - Each link says what it's for (whole course, this section, a project team…).
// - The same chat can't be added twice anywhere in the course, across all its sections,
//   even under a different URL for the same invite.
// - Classmates mark a link "still works" or report it. It's hidden once 2 or more report it
//   and reports outnumber "works". The owner is told, and can mark it fixed to clear the reports.

// `as const` makes the type these exact strings, which z.enum() in the vote procedure needs.
export const FLAG_REASONS = ['Expired', 'Broken', 'Not relevant', 'Spam or inappropriate'] as const;

// z.enum needs a non-empty tuple type: `[first, ...rest]` says there's at
// least one item. Object.keys returns string[], so the cast supplies that.
const purposes = Object.keys(LINK_PURPOSES) as [LinkPurpose, ...LinkPurpose[]];

// Fields shared by add and update, spread into each z.object() below with `...linkInput`.
const linkInput = {
  url: z.string().trim().min(1, 'Paste the group chat link').max(500),
  label: z.string().trim().max(80),
  purpose: z.enum(purposes),
  // 'pick-link-platform': what the person adding it says it is.
  platform: z.string().optional(),
};

// Switches stay in English, so these aren't written where the French check would ask for a translation.
const ONLY_WHATSAPP_DISCORD = 'Only WhatsApp and Discord links can be added.';
const REPORTS_ONLY = 'Links can only be reported here.';
const CANT_APPROVE_OWN = 'Someone else has to approve your link.';
const ONLY_THE_PROFESSOR_DECIDES = 'Only the section’s professor can decide this.';

// Whether reports have taken a link out of the list, under the switches that change that.
function hiddenByReports(reports: number, works: number) {
  if (isOn('links-likely-broken') || isOn('never-hide-links') || isOn('moderate-reported-links')) return false;
  return isHidden(reports, isOn('no-works-votes') ? 0 : works);
}

const LIKELY_BROKEN_AT = 3;

// Turns parseChatLink's null into an error the user sees,
// so callers get either a parsed link or an exception.
function parseOrThrow(url: string) {
  const parsed = parseChatLink(url);
  if (!parsed) throw new AppError('That doesn\'t look like a valid link. It should start with https://');
  if (isOn('whatsapp-discord-only') && parsed.platform !== 'WhatsApp' && parsed.platform !== 'Discord') throw new AppError(ONLY_WHATSAPP_DISCORD);
  return parsed;
}

// Same course and term, any section.
// `exceptId ? ne(…) : undefined` adds a condition only when there's an id. Drizzle's
// and() ignores undefined, so an update can avoid comparing the link with itself.
function assertNotDuplicate(db: DB, classId: number, chatKey: string, url: string, exceptId?: number) {
  // Version A: only the same URL in the same class counts.
  if (isOn('link-same-url-only')) {
    if (db.select({ id: chatLinks.id }).from(chatLinks).where(and(eq(chatLinks.classId, classId), eq(chatLinks.url, url), exceptId ? ne(chatLinks.id, exceptId) : undefined)).get()) {
      throw new AppError('This chat has already been added to this class.', 'CONFLICT');
    }
    return;
  }
  const cls = db.select().from(classes).where(eq(classes.id, classId)).get() ?? notFound('class');
  // Joins three tables to find the same chat anywhere in this
  // course this term, with its owner's name for the error message.
  const existing = db
    .select({ id: chatLinks.id, classId: chatLinks.classId, ownerName: users.name })
    .from(chatLinks)
    .innerJoin(classes, eq(chatLinks.classId, classes.id))
    .innerJoin(users, eq(chatLinks.ownerId, users.id))
    .where(
      and(
        eq(classes.courseId, cls.courseId),
        eq(classes.term, cls.term),
        eq(chatLinks.chatKey, chatKey),
        exceptId ? ne(chatLinks.id, exceptId) : undefined,
      ),
    )
    .get();
  if (!existing) return;
  if (existing.classId === classId) throw new AppError('This chat has already been added to this class.', 'CONFLICT');
  throw new AppError('{{name}} already shared this chat in {{class}}.', 'CONFLICT', {
    name: isOn('hide-link-owner') ? 'A classmate' : existing.ownerName,
    class: classLabel(db, existing.classId) ?? '',
  });
}

// A generic arrow function: T is whatever object comes in, as long as
// it has a platform. The spread copies it and replaces just that field.
const withPlatform = <T extends { platform: string }>(parsed: T, picked?: string) => (isOn('pick-link-platform') && picked && CHAT_PLATFORMS.includes(picked) ? { ...parsed, platform: picked } : parsed);

// Returns the row if this user owns it, and throws otherwise. `??
// notFound(...)` handles a missing row in the same expression.
function ownLink(db: DB, userId: number, linkId: number) {
  const link = db.select().from(chatLinks).where(eq(chatLinks.id, linkId)).get() ?? notFound('link');
  if (link.ownerId !== userId) throw new AppError('Only the person who added this link can change it.', 'FORBIDDEN');
  return link;
}

// Like ownLink, but anyone in the section passes.
function visibleLink(db: DB, userId: number, linkId: number) {
  const link = db.select().from(chatLinks).where(eq(chatLinks.id, linkId)).get() ?? notFound('link');
  requireMember(db, userId, link.classId);
  return link;
}

// Counts votes in JavaScript. A link only ever has a few, so loading them is cheap.
function tally(db: DB, linkId: number) {
  const votes = db.select().from(chatLinkVotes).where(eq(chatLinkVotes.linkId, linkId)).all();
  const reports = votes.filter((v) => v.vote === 'report').length;
  return { reports, works: votes.length - reports };
}

// A correlated subquery: for each link in the outer query, it counts that
// link's votes of one kind. Columns placed inside sql`…` become their real
// SQL names, and mapWith(Number) converts the raw value when the row is read.
function voteCount(vote: 'works' | 'report') {
  return sql<number>`(select count(*) from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.vote} = ${vote})`.mapWith(
    Number,
  );
}

// 'prof-edit-links': a section's professor can change what's posted in it.
const profManages = (db: DB, userId: number, linkId: number) => isOn('prof-edit-links') && teaches(db, userId, visibleLink(db, userId, linkId).classId);

// Each key becomes a procedure the renderer can call: list
// is rpc.links.list, add is rpc.links.add, and so on.
export const linksRouter = {
  // S2.1: platform, purpose, who added it, and what classmates say about it.
  // A handler's first parameter is the parsed input, destructured here; the second is ctx.
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    // Subqueries for the current user's own vote and reason, which become extra columns on each row.
    const myVote = sql<string | null>`(select ${chatLinkVotes.vote} from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.userId} = ${ctx.userId})`;
    const myReason = sql<string | null>`(select ${chatLinkVotes.reason} from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.userId} = ${ctx.userId})`;
    const teaching = teaches(ctx.db, ctx.userId, classId);
    const pending = isOn('approve-links') ? pendingLinkIds(ctx.db) : new Set<number>();
    const lastWorked = sql<number | null>`(select max(${chatLinkVotes.createdAt}) from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.vote} = 'works')`;
    return ctx.db
      .select({
        id: chatLinks.id,
        url: chatLinks.url,
        platform: chatLinks.platform,
        label: chatLinks.label,
        purpose: chatLinks.purpose,
        createdAt: chatLinks.createdAt,
        isPublic: chatLinks.isPublic,
        ownerId: chatLinks.ownerId,
        ownerName: users.name,
        ownerRole: users.role,
        reports: voteCount('report'),
        works: voteCount('works'),
        myVote,
        myReason,
        lastWorked,
      })
      .from(chatLinks)
      .innerJoin(users, eq(chatLinks.ownerId, users.id))
      .where(and(eq(chatLinks.classId, classId), isOn('private-links') ? or(eq(chatLinks.isPublic, true), eq(chatLinks.ownerId, ctx.userId)) : undefined))
      // What the professor shared comes first: it's the one most people are looking for.
      .orderBy(sql`${users.role} = 'professor' desc`, chatLinks.purpose, chatLinks.createdAt)
      .all()
      // Rest destructuring: lastWorked is pulled out, and l holds every other
      // field. The new object spreads l back in and adds the computed fields.
      .map(({ lastWorked, ...l }) => ({
        ...l,
        purpose: l.purpose as LinkPurpose,
        lastWorkedAt: lastWorked == null ? null : new Date(Number(lastWorked)),
        mine: l.ownerId === ctx.userId,
        ownerName: isOn('hide-link-owner') && l.ownerId !== ctx.userId ? '' : l.ownerName,
        hidden: hiddenByReports(l.reports, l.works),
        likelyBroken: isOn('links-likely-broken') && l.reports >= LIKELY_BROKEN_AT,
        pending: pending.has(l.id),
        canDecide: isOn('moderate-reported-links') && teaching && l.reports > 0,
      }));
  }),

  // S2.2: everyone in the class sees a link as soon as it's added.
  // The checks run in order: membership, a valid link, no duplicate. Only then does the insert happen.
  add: procedure(z.object({ classId: idSchema, ...linkInput }), ({ classId, url, label, purpose, platform }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const parsed = withPlatform(parseOrThrow(url), platform);
    assertNotDuplicate(ctx.db, classId, parsed.chatKey, parsed.url);
    const link = ctx.db
      .insert(chatLinks)
      .values({ classId, ownerId: ctx.userId, label, purpose, isPublic: !isOn('private-links'), ...parsed })
      // returning() makes the insert give back columns of the new row,
      // and .get() takes that one row, so this procedure returns { id }.
      .returning({ id: chatLinks.id })
      .get();
    if (isOn('approve-links')) setLinkPending(ctx.db, link.id, true);
    return link;
  }),

  // 'private-links': the person who added it shares it with the class.
  share: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    ownLink(ctx.db, ctx.userId, linkId);
    ctx.db.update(chatLinks).set({ isPublic: true }).where(eq(chatLinks.id, linkId)).run();
  }),

  // 'approve-links': anyone else in the section lets it through.
  approve: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    const link = visibleLink(ctx.db, ctx.userId, linkId);
    if (link.ownerId === ctx.userId) throw new AppError(CANT_APPROVE_OWN, 'FORBIDDEN');
    setLinkPending(ctx.db, linkId, false);
  }),

  // 'moderate-reported-links': the section's professor keeps a reported link or takes it down.
  decide: procedure(z.object({ linkId: idSchema, keep: z.boolean() }), ({ linkId, keep }, ctx) => {
    const link = visibleLink(ctx.db, ctx.userId, linkId);
    if (!teaches(ctx.db, ctx.userId, link.classId)) throw new AppError(ONLY_THE_PROFESSOR_DECIDES, 'FORBIDDEN');
    if (keep) ctx.db.delete(chatLinkVotes).where(and(eq(chatLinkVotes.linkId, linkId), eq(chatLinkVotes.vote, 'report'))).run();
    else ctx.db.delete(chatLinks).where(eq(chatLinks.id, linkId)).run();
  }),

  // S2.5: only the owner edits or removes. A new chat starts with a clean slate.
  update: procedure(z.object({ linkId: idSchema, ...linkInput }), ({ linkId, url, label, purpose, platform }, ctx) => {
    const link = isOn('anyone-fixes-links') || profManages(ctx.db, ctx.userId, linkId) ? visibleLink(ctx.db, ctx.userId, linkId) : ownLink(ctx.db, ctx.userId, linkId);
    const parsed = withPlatform(parseOrThrow(url), platform);
    assertNotDuplicate(ctx.db, link.classId, parsed.chatKey, parsed.url, link.id);
    // Both writes or neither: the new URL, and clearing votes that were about the old chat.
    ctx.db.transaction((tx) => {
      tx.update(chatLinks)
        .set({ ...parsed, label, purpose, updatedAt: ctx.now() })
        .where(eq(chatLinks.id, linkId))
        .run();
      if (parsed.chatKey !== link.chatKey) tx.delete(chatLinkVotes).where(eq(chatLinkVotes.linkId, linkId)).run();
    });
  }),

  remove: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    if (!profManages(ctx.db, ctx.userId, linkId)) ownLink(ctx.db, ctx.userId, linkId);
    ctx.db.delete(chatLinks).where(eq(chatLinks.id, linkId)).run();
  }),

  // S2.4: "still works" or a report with a reason; voting again replaces your vote.
  vote: procedure(
    z.object({ linkId: idSchema, vote: z.enum(['works', 'report']), reason: z.enum(FLAG_REASONS).nullable() }),
    ({ linkId, vote, reason }, ctx) => {
      const link = visibleLink(ctx.db, ctx.userId, linkId);
      if (link.ownerId === ctx.userId) throw new AppError('You can edit or remove your own link instead.', 'FORBIDDEN');
      if (vote === 'report' && !reason) throw new AppError("Say what's wrong with the link.");
      if (vote === 'works' && isOn('no-works-votes')) throw new AppError(REPORTS_ONLY);
      // Counting before and after the write means the owner hears about
      // it once, when the link becomes hidden, not on every later report.
      const before = tally(ctx.db, linkId);
      ctx.db
        .insert(chatLinkVotes)
        .values({ linkId, userId: ctx.userId, vote, reason: vote === 'report' ? reason : null, createdAt: ctx.now() })
        // The primary key is (link, user), so a second vote from the same person
        // hits a conflict and updates their vote instead of adding another.
        .onConflictDoUpdate({
          target: [chatLinkVotes.linkId, chatLinkVotes.userId],
          set: { vote, reason: vote === 'report' ? reason : null, createdAt: ctx.now() },
        })
        .run();
      const after = tally(ctx.db, linkId);
      if (vote === 'report' && isOn('moderate-reported-links') && before.reports === 0) {
        for (const professor of professorsOf(ctx.db, link.classId)) {
          notify(ctx.db, professor.id, {
            type: 'link-hidden',
            title: raw(`A ${link.platform} link in ${classLabel(ctx.db, link.classId) ?? 'your section'} was reported`),
            body: raw('Keep it or take it down from the Group chats tab.'),
            link: `/classes/${link.classId}/chats`,
          });
        }
      }
      // Visible before, hidden now: tell the owner. m() stores the message
      // as a key and params, translated later into the owner's language.
      if (!hiddenByReports(before.reports, before.works) && hiddenByReports(after.reports, after.works)) {
        notify(ctx.db, link.ownerId, {
          type: 'link-hidden',
          title: m('Your {{platform}} link in {{class}} was hidden', {
            platform: link.platform,
            class: classLabel(ctx.db, link.classId) ?? { t: 'a class' },
          }),
          body: m('{{count}} classmates reported it. Fix the link, or mark it fixed if it works.', { count: after.reports }),
          link: `/classes/${link.classId}/chats`,
        });
      }
    },
  ),

  unvote: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    visibleLink(ctx.db, ctx.userId, linkId);
    ctx.db.delete(chatLinkVotes).where(and(eq(chatLinkVotes.linkId, linkId), eq(chatLinkVotes.userId, ctx.userId))).run();
  }),

  // The owner checked the chat and it's fine: reports are cleared, "works" votes stay.
  markFixed: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    ownLink(ctx.db, ctx.userId, linkId);
    ctx.db.delete(chatLinkVotes).where(and(eq(chatLinkVotes.linkId, linkId), eq(chatLinkVotes.vote, 'report'))).run();
  }),
};
