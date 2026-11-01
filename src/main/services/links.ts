import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isHidden, LINK_PURPOSES, type LinkPurpose, parseChatLink } from '@shared/links';
import type { DB } from '../db/client';
import { chatLinks, chatLinkVotes, classes, users } from '../db/schema';
import { AppError, idSchema, procedure } from '../rpc/core';
import { classLabel, notFound, requireMember } from './access';
import { m, notify } from './notifications';

// S2 in version B:
// - Links are shared with the class as soon as they're added (no private stage).
// - Each link says what it's for (whole course, this section, a project team…).
// - The same chat can't be added twice anywhere in the course, across all its sections,
//   even under a different URL for the same invite.
// - Classmates mark a link "still works" or report it. It's hidden once 2 or more report it
//   and reports outnumber "works". The owner is told, and can mark it fixed to clear the reports.

export const FLAG_REASONS = ['Expired', 'Broken', 'Not relevant', 'Spam or inappropriate'] as const;

const purposes = Object.keys(LINK_PURPOSES) as [LinkPurpose, ...LinkPurpose[]];

const linkInput = {
  url: z.string().trim().min(1, 'Paste the group chat link').max(500),
  label: z.string().trim().max(80),
  purpose: z.enum(purposes),
};

function parseOrThrow(url: string) {
  const parsed = parseChatLink(url);
  if (!parsed) throw new AppError('That doesn\'t look like a valid link. It should start with https://');
  return parsed;
}

// Same course and term, any section.
function assertNotDuplicate(db: DB, classId: number, chatKey: string, exceptId?: number) {
  const cls = db.select().from(classes).where(eq(classes.id, classId)).get() ?? notFound('class');
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
    name: existing.ownerName,
    class: classLabel(db, existing.classId) ?? '',
  });
}

function ownLink(db: DB, userId: number, linkId: number) {
  const link = db.select().from(chatLinks).where(eq(chatLinks.id, linkId)).get() ?? notFound('link');
  if (link.ownerId !== userId) throw new AppError('Only the person who added this link can change it.', 'FORBIDDEN');
  return link;
}

function visibleLink(db: DB, userId: number, linkId: number) {
  const link = db.select().from(chatLinks).where(eq(chatLinks.id, linkId)).get() ?? notFound('link');
  requireMember(db, userId, link.classId);
  return link;
}

function tally(db: DB, linkId: number) {
  const votes = db.select().from(chatLinkVotes).where(eq(chatLinkVotes.linkId, linkId)).all();
  const reports = votes.filter((v) => v.vote === 'report').length;
  return { reports, works: votes.length - reports };
}

function voteCount(vote: 'works' | 'report') {
  return sql<number>`(select count(*) from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.vote} = ${vote})`.mapWith(
    Number,
  );
}

export const linksRouter = {
  // S2.1: platform, purpose, who added it, and what classmates say about it.
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const myVote = sql<string | null>`(select ${chatLinkVotes.vote} from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.userId} = ${ctx.userId})`;
    const myReason = sql<string | null>`(select ${chatLinkVotes.reason} from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.userId} = ${ctx.userId})`;
    const lastWorked = sql<number | null>`(select max(${chatLinkVotes.createdAt}) from ${chatLinkVotes} where ${chatLinkVotes.linkId} = ${chatLinks.id} and ${chatLinkVotes.vote} = 'works')`;
    return ctx.db
      .select({
        id: chatLinks.id,
        url: chatLinks.url,
        platform: chatLinks.platform,
        label: chatLinks.label,
        purpose: chatLinks.purpose,
        createdAt: chatLinks.createdAt,
        ownerId: chatLinks.ownerId,
        ownerName: users.name,
        reports: voteCount('report'),
        works: voteCount('works'),
        myVote,
        myReason,
        lastWorked,
      })
      .from(chatLinks)
      .innerJoin(users, eq(chatLinks.ownerId, users.id))
      .where(eq(chatLinks.classId, classId))
      .orderBy(chatLinks.purpose, chatLinks.createdAt)
      .all()
      .map(({ lastWorked, ...l }) => ({
        ...l,
        purpose: l.purpose as LinkPurpose,
        lastWorkedAt: lastWorked == null ? null : new Date(Number(lastWorked)),
        mine: l.ownerId === ctx.userId,
        hidden: isHidden(l.reports, l.works),
      }));
  }),

  // S2.2: everyone in the class sees a link as soon as it's added.
  add: procedure(z.object({ classId: idSchema, ...linkInput }), ({ classId, url, label, purpose }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const parsed = parseOrThrow(url);
    assertNotDuplicate(ctx.db, classId, parsed.chatKey);
    return ctx.db
      .insert(chatLinks)
      .values({ classId, ownerId: ctx.userId, label, purpose, isPublic: true, ...parsed })
      .returning({ id: chatLinks.id })
      .get();
  }),

  // S2.5: only the owner edits or removes. A new chat starts with a clean slate.
  update: procedure(z.object({ linkId: idSchema, ...linkInput }), ({ linkId, url, label, purpose }, ctx) => {
    const link = ownLink(ctx.db, ctx.userId, linkId);
    const parsed = parseOrThrow(url);
    assertNotDuplicate(ctx.db, link.classId, parsed.chatKey, link.id);
    ctx.db.transaction((tx) => {
      tx.update(chatLinks)
        .set({ ...parsed, label, purpose, updatedAt: ctx.now() })
        .where(eq(chatLinks.id, linkId))
        .run();
      if (parsed.chatKey !== link.chatKey) tx.delete(chatLinkVotes).where(eq(chatLinkVotes.linkId, linkId)).run();
    });
  }),

  remove: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    ownLink(ctx.db, ctx.userId, linkId);
    ctx.db.delete(chatLinks).where(eq(chatLinks.id, linkId)).run();
  }),

  // S2.4: "still works" or a report with a reason; voting again replaces your vote.
  vote: procedure(
    z.object({ linkId: idSchema, vote: z.enum(['works', 'report']), reason: z.enum(FLAG_REASONS).nullable() }),
    ({ linkId, vote, reason }, ctx) => {
      const link = visibleLink(ctx.db, ctx.userId, linkId);
      if (link.ownerId === ctx.userId) throw new AppError('You can edit or remove your own link instead.', 'FORBIDDEN');
      if (vote === 'report' && !reason) throw new AppError("Say what's wrong with the link.");
      const before = tally(ctx.db, linkId);
      ctx.db
        .insert(chatLinkVotes)
        .values({ linkId, userId: ctx.userId, vote, reason: vote === 'report' ? reason : null, createdAt: ctx.now() })
        .onConflictDoUpdate({
          target: [chatLinkVotes.linkId, chatLinkVotes.userId],
          set: { vote, reason: vote === 'report' ? reason : null, createdAt: ctx.now() },
        })
        .run();
      const after = tally(ctx.db, linkId);
      if (!isHidden(before.reports, before.works) && isHidden(after.reports, after.works)) {
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
