import { and, asc, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { goatFor } from '@shared/goat';
import type { DB } from '../db/client';
import { classes, courses, enrollments, postAudience, postReactions, posts, replies, replyReactions, users } from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { notFound, requireMember } from './access';
import { enrolledUsersByEmail } from './classes';
import { notify } from './notifications';

// S4: Ed-style discussion board. Posts have a class, a type ("topic": Assignment,
// Midterm, Just yapping…), 🐐 reactions and threaded replies, and are visible to the
// whole class or only to selected classmates. The home feed shows posts from all
// of a student's classes.

export const SUGGESTED_TOPICS = ['Assignment', 'Midterm', 'Final', 'Lecture', 'Study group', 'Just yapping'];

const postFields = {
  topic: nonEmpty('Type', 60),
  title: nonEmpty('Title', 200),
  body: nonEmpty('Post', 10_000),
};

function canSee(userId: number) {
  return or(
    eq(posts.visibility, 'class'),
    eq(posts.authorId, userId),
    inArray(posts.id, sql`(select ${postAudience.postId} from ${postAudience} where ${postAudience.userId} = ${userId})`),
  );
}

function myClassIds(db: DB, userId: number) {
  return db
    .select({ id: enrollments.classId })
    .from(enrollments)
    .where(eq(enrollments.userId, userId))
    .all()
    .map((r) => r.id);
}

function visiblePost(db: DB, userId: number, postId: number) {
  const post = db.select().from(posts).where(and(eq(posts.id, postId), canSee(userId))).get() ?? notFound('post');
  requireMember(db, userId, post.classId);
  return post;
}

function ownPost(db: DB, userId: number, postId: number) {
  const post = db.select().from(posts).where(eq(posts.id, postId)).get() ?? notFound('post');
  if (post.authorId !== userId) throw new AppError('You can only change your own posts.', 'FORBIDDEN');
  return post;
}

function audienceOf(db: DB, postId: number) {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(postAudience)
    .innerJoin(users, eq(postAudience.userId, users.id))
    .where(eq(postAudience.postId, postId))
    .orderBy(asc(users.name))
    .all();
}

const authorColumns = { authorId: users.id, authorName: users.name, authorEmail: users.email, authorAvatar: users.avatar };

const withGoat = <T extends { authorId: number; authorAvatar: unknown }>({ authorAvatar, ...row }: T) => ({
  ...row,
  authorGoat: goatFor(row.authorId, authorAvatar as never),
});

const classLabel = sql<string>`${courses.subject} || ' ' || ${courses.number}`;

export const boardRouter = {
  // Post types used so far, plus the usual ones, for the filters and the composer.
  topics: procedure(z.object({ classId: idSchema.nullable() }), ({ classId }, ctx) => {
    if (classId) requireMember(ctx.db, ctx.userId, classId);
    const ids = classId ? [classId] : myClassIds(ctx.db, ctx.userId);
    const used = ids.length
      ? ctx.db
          .selectDistinct({ topic: posts.topic })
          .from(posts)
          .where(and(inArray(posts.classId, ids), canSee(ctx.userId)))
          .all()
          .map((r) => r.topic)
      : [];
    return [...new Set([...SUGGESTED_TOPICS, ...used])];
  }),

  // One class's board, or the home feed across every class the student is in.
  feed: procedure(
    z.object({
      classIds: z.array(idSchema).nullable(),
      topics: z.array(z.string()),
      since: z.enum(['today', 'week', 'month']).nullable(),
      search: z.string().trim().max(100),
    }),
    ({ classIds, topics, since, search }, ctx) => {
      const mine = myClassIds(ctx.db, ctx.userId);
      const ids = classIds ? classIds.filter((id) => mine.includes(id)) : mine;
      if (classIds?.length === 1 && !ids.length) requireMember(ctx.db, ctx.userId, classIds[0]);
      if (!ids.length) return [];

      const now = ctx.now();
      const from =
        since === 'today'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
          : since
            ? new Date(now.getTime() - (since === 'week' ? 7 : 30) * 86_400_000)
            : null;
      const term = `%${search}%`;

      return ctx.db
        .select({
          id: posts.id,
          classId: posts.classId,
          classLabel,
          topic: posts.topic,
          title: posts.title,
          body: posts.body,
          visibility: posts.visibility,
          createdAt: posts.createdAt,
          editedAt: posts.editedAt,
          ...authorColumns,
          replyCount: sql<number>`(select count(*) from ${replies} where ${replies.postId} = ${posts.id})`.mapWith(Number),
          goats: sql<number>`(select count(*) from ${postReactions} where ${postReactions.postId} = ${posts.id})`.mapWith(Number),
          goated: sql<number>`(select count(*) from ${postReactions} where ${postReactions.postId} = ${posts.id} and ${postReactions.userId} = ${ctx.userId})`.mapWith(Boolean),
        })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .innerJoin(classes, eq(posts.classId, classes.id))
        .innerJoin(courses, eq(classes.courseId, courses.id))
        .where(
          and(
            inArray(posts.classId, ids),
            canSee(ctx.userId),
            topics.length ? inArray(posts.topic, topics) : undefined,
            from ? gte(posts.createdAt, from) : undefined,
            search ? or(like(posts.title, term), like(posts.body, term)) : undefined,
          ),
        )
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(100)
        .all()
        .map(withGoat);
    },
  ),

  get: procedure(z.object({ postId: idSchema }), ({ postId }, ctx) => {
    const post = visiblePost(ctx.db, ctx.userId, postId);
    const writer = ctx.db.select().from(users).where(eq(users.id, post.authorId)).get();
    const label = ctx.db
      .select({ label: classLabel })
      .from(classes)
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .where(eq(classes.id, post.classId))
      .get()?.label;
    const reactions = ctx.db.select().from(postReactions).where(eq(postReactions.postId, postId)).all();
    const replyRows = ctx.db
      .select({ id: replies.id, parentId: replies.parentId, body: replies.body, createdAt: replies.createdAt, ...authorColumns })
      .from(replies)
      .innerJoin(users, eq(replies.authorId, users.id))
      .where(eq(replies.postId, postId))
      .orderBy(asc(replies.createdAt), asc(replies.id))
      .all();
    const replyGoats = replyRows.length
      ? ctx.db
          .select()
          .from(replyReactions)
          .where(inArray(replyReactions.replyId, replyRows.map((r) => r.id)))
          .all()
      : [];

    return {
      ...post,
      classLabel: label ?? '',
      authorName: writer?.name ?? 'Deleted user',
      authorEmail: writer?.email ?? '',
      authorGoat: goatFor(post.authorId, writer?.avatar),
      mine: post.authorId === ctx.userId,
      goats: reactions.length,
      goated: reactions.some((r) => r.userId === ctx.userId),
      audience: post.visibility === 'selected' ? audienceOf(ctx.db, postId) : [],
      replies: replyRows.map((r) => ({
        ...withGoat(r),
        mine: r.authorId === ctx.userId,
        goats: replyGoats.filter((g) => g.replyId === r.id).length,
        goated: replyGoats.some((g) => g.replyId === r.id && g.userId === ctx.userId),
      })),
    };
  }),

  create: procedure(
    z.object({
      classId: idSchema,
      ...postFields,
      visibility: z.enum(['class', 'selected']),
      audienceEmails: z.array(z.string()),
    }),
    ({ classId, audienceEmails, ...fields }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      const audience =
        fields.visibility === 'selected'
          ? enrolledUsersByEmail(ctx.db, classId, audienceEmails).filter((u) => u.id !== ctx.userId)
          : [];
      if (fields.visibility === 'selected' && !audience.length) {
        throw new AppError('Pick at least one classmate who can see this post.');
      }
      return ctx.db.transaction((tx) => {
        const post = tx
          .insert(posts)
          .values({ ...fields, classId, authorId: ctx.userId })
          .returning({ id: posts.id })
          .get();
        if (audience.length) tx.insert(postAudience).values(audience.map((u) => ({ postId: post.id, userId: u.id }))).run();
        return post;
      });
    },
  ),

  update: procedure(z.object({ postId: idSchema, ...postFields }), ({ postId, ...fields }, ctx) => {
    ownPost(ctx.db, ctx.userId, postId);
    ctx.db
      .update(posts)
      .set({ ...fields, editedAt: ctx.now() })
      .where(eq(posts.id, postId))
      .run();
  }),

  remove: procedure(z.object({ postId: idSchema }), ({ postId }, ctx) => {
    ownPost(ctx.db, ctx.userId, postId);
    ctx.db.delete(posts).where(eq(posts.id, postId)).run();
  }),

  // 🐐 toggles: one goat per student per post or reply.
  react: procedure(z.object({ postId: idSchema }), ({ postId }, ctx) => {
    visiblePost(ctx.db, ctx.userId, postId);
    const key = and(eq(postReactions.postId, postId), eq(postReactions.userId, ctx.userId));
    if (ctx.db.select().from(postReactions).where(key).get()) ctx.db.delete(postReactions).where(key).run();
    else ctx.db.insert(postReactions).values({ postId, userId: ctx.userId }).run();
  }),

  reactReply: procedure(z.object({ replyId: idSchema }), ({ replyId }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    visiblePost(ctx.db, ctx.userId, reply.postId);
    const key = and(eq(replyReactions.replyId, replyId), eq(replyReactions.userId, ctx.userId));
    if (ctx.db.select().from(replyReactions).where(key).get()) ctx.db.delete(replyReactions).where(key).run();
    else ctx.db.insert(replyReactions).values({ replyId, userId: ctx.userId }).run();
  }),

  // Replying to a reply nests one level; deeper replies join the same thread.
  reply: procedure(
    z.object({ postId: idSchema, parentId: idSchema.nullable().default(null), body: nonEmpty('Reply', 5000) }),
    ({ postId, parentId, body }, ctx) => {
      const post = visiblePost(ctx.db, ctx.userId, postId);
      const parent = parentId ? (ctx.db.select().from(replies).where(eq(replies.id, parentId)).get() ?? notFound('reply')) : null;
      if (parent && parent.postId !== postId) notFound('reply');
      ctx.db
        .insert(replies)
        .values({ postId, body, authorId: ctx.userId, parentId: parent ? (parent.parentId ?? parent.id) : null })
        .run();

      const replier = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get()?.name ?? 'A classmate';
      const excerpt = body.length > 140 ? `${body.slice(0, 140)}…` : body;
      const link = `/classes/${post.classId}/discussion?post=${postId}`;
      const told = new Set([ctx.userId]);
      if (parent && !told.has(parent.authorId)) {
        notify(ctx.db, parent.authorId, { type: 'reply', title: `${replier} replied to your reply on "${post.title}"`, body: excerpt, link });
        told.add(parent.authorId);
      }
      if (!told.has(post.authorId)) {
        notify(ctx.db, post.authorId, { type: 'reply', title: `${replier} replied to "${post.title}"`, body: excerpt, link });
      }
    },
  ),

  removeReply: procedure(z.object({ replyId: idSchema }), ({ replyId }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    if (reply.authorId !== ctx.userId) throw new AppError('You can only delete your own replies.', 'FORBIDDEN');
    ctx.db.delete(replies).where(eq(replies.id, replyId)).run();
  }),
};
