import { and, eq, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parseChatLink } from '@shared/links';
import type { DB } from '../db/client';
import { chatLinkFlags, chatLinks, users } from '../db/schema';
import { AppError, idSchema, procedure } from '../rpc/core';
import { classLabel, notFound, requireMember } from './access';
import { notify } from './notifications';

// S2: group chat links per class.

// Decision for "how are flagged links handled?": once this many classmates
// report a link it's collapsed behind a warning; the owner fixing the URL clears the reports.
export const FLAG_HIDE_THRESHOLD = 3;

export const FLAG_REASONS = ['Expired', 'Broken', 'Not relevant', 'Spam or inappropriate'] as const;

const linkInput = {
  url: z.string().trim().min(1, 'Paste the group chat link').max(500),
  label: z.string().trim().max(80),
  isPublic: z.boolean(),
};

function parseOrThrow(url: string) {
  const parsed = parseChatLink(url);
  if (!parsed) throw new AppError('That doesn\'t look like a valid link. It should start with https://');
  return parsed;
}

function assertNotDuplicate(db: DB, classId: number, url: string, exceptId?: number) {
  const existing = db
    .select({ id: chatLinks.id })
    .from(chatLinks)
    .where(and(eq(chatLinks.classId, classId), eq(chatLinks.url, url), exceptId ? ne(chatLinks.id, exceptId) : undefined))
    .get();
  if (existing) throw new AppError('This link has already been added to this class.', 'CONFLICT');
}

function ownLink(db: DB, userId: number, linkId: number) {
  const link = db.select().from(chatLinks).where(eq(chatLinks.id, linkId)).get() ?? notFound('link');
  if (link.ownerId !== userId) throw new AppError('Only the person who added this link can change it.', 'FORBIDDEN');
  return link;
}

function visibleLink(db: DB, userId: number, linkId: number) {
  const link = db.select().from(chatLinks).where(eq(chatLinks.id, linkId)).get() ?? notFound('link');
  requireMember(db, userId, link.classId);
  if (!link.isPublic && link.ownerId !== userId) notFound('link');
  return link;
}

export const linksRouter = {
  // S2.1: public links plus your own private ones.
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const flagCount = sql<number>`(select count(*) from ${chatLinkFlags} where ${chatLinkFlags.linkId} = ${chatLinks.id})`.mapWith(
      Number,
    );
    const myFlag = sql<string | null>`(select ${chatLinkFlags.reason} from ${chatLinkFlags} where ${chatLinkFlags.linkId} = ${chatLinks.id} and ${chatLinkFlags.userId} = ${ctx.userId})`;
    return ctx.db
      .select({
        id: chatLinks.id,
        url: chatLinks.url,
        platform: chatLinks.platform,
        label: chatLinks.label,
        isPublic: chatLinks.isPublic,
        createdAt: chatLinks.createdAt,
        ownerId: chatLinks.ownerId,
        ownerName: users.name,
        flagCount,
        myFlag,
      })
      .from(chatLinks)
      .innerJoin(users, eq(chatLinks.ownerId, users.id))
      .where(and(eq(chatLinks.classId, classId), or(eq(chatLinks.isPublic, true), eq(chatLinks.ownerId, ctx.userId))))
      .orderBy(chatLinks.platform, chatLinks.createdAt)
      .all()
      .map((l) => ({ ...l, mine: l.ownerId === ctx.userId, hidden: l.flagCount >= FLAG_HIDE_THRESHOLD }));
  }),

  // S2.2: links start private to whoever adds them; they choose when to share.
  add: procedure(z.object({ classId: idSchema, ...linkInput }), ({ classId, url, label, isPublic }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const parsed = parseOrThrow(url);
    assertNotDuplicate(ctx.db, classId, parsed.url);
    return ctx.db
      .insert(chatLinks)
      .values({ classId, ownerId: ctx.userId, label, isPublic, ...parsed })
      .returning({ id: chatLinks.id })
      .get();
  }),

  // S2.5: only the owner edits or removes. A new URL clears old reports.
  update: procedure(z.object({ linkId: idSchema, ...linkInput }), ({ linkId, url, label, isPublic }, ctx) => {
    const link = ownLink(ctx.db, ctx.userId, linkId);
    const parsed = parseOrThrow(url);
    assertNotDuplicate(ctx.db, link.classId, parsed.url, link.id);
    ctx.db.transaction((tx) => {
      tx.update(chatLinks)
        .set({ ...parsed, label, isPublic, updatedAt: ctx.now() })
        .where(eq(chatLinks.id, linkId))
        .run();
      if (parsed.url !== link.url) tx.delete(chatLinkFlags).where(eq(chatLinkFlags.linkId, linkId)).run();
    });
  }),

  remove: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    ownLink(ctx.db, ctx.userId, linkId);
    ctx.db.delete(chatLinks).where(eq(chatLinks.id, linkId)).run();
  }),

  // S2.4
  flag: procedure(z.object({ linkId: idSchema, reason: z.enum(FLAG_REASONS) }), ({ linkId, reason }, ctx) => {
    const link = visibleLink(ctx.db, ctx.userId, linkId);
    if (link.ownerId === ctx.userId) throw new AppError('You can edit or remove your own link instead.', 'FORBIDDEN');
    const isNew = !ctx.db
      .select({ linkId: chatLinkFlags.linkId })
      .from(chatLinkFlags)
      .where(and(eq(chatLinkFlags.linkId, linkId), eq(chatLinkFlags.userId, ctx.userId)))
      .get();
    ctx.db
      .insert(chatLinkFlags)
      .values({ linkId, userId: ctx.userId, reason })
      .onConflictDoUpdate({ target: [chatLinkFlags.linkId, chatLinkFlags.userId], set: { reason } })
      .run();
    if (isNew) {
      notify(ctx.db, link.ownerId, {
        type: 'link-flagged',
        title: `Your ${link.platform} link in ${classLabel(ctx.db, link.classId) ?? 'a class'} was reported`,
        body: `Reason: ${reason}. Check it still works, or update it to clear the reports.`,
        link: `/classes/${link.classId}/chats`,
      });
    }
  }),

  unflag: procedure(z.object({ linkId: idSchema }), ({ linkId }, ctx) => {
    visibleLink(ctx.db, ctx.userId, linkId);
    ctx.db.delete(chatLinkFlags).where(and(eq(chatLinkFlags.linkId, linkId), eq(chatLinkFlags.userId, ctx.userId))).run();
  }),
};
