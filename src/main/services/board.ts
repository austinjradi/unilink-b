import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client';
import { postAudience, posts, replies, users } from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { notFound, requireMember } from './access';
import { enrolledUsersByEmail } from './classes';

// S4: Ed-style discussion board. Posts have a topic and replies, and are visible
// to the whole class or only to selected classmates.

const postFields = {
  topic: nonEmpty('Topic', 60),
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

const author = { authorId: users.id, authorName: users.name, authorEmail: users.email };

export const boardRouter = {
  topics: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    return ctx.db
      .selectDistinct({ topic: posts.topic })
      .from(posts)
      .where(and(eq(posts.classId, classId), canSee(ctx.userId)))
      .orderBy(posts.topic)
      .all()
      .map((r) => r.topic);
  }),

  list: procedure(
    z.object({ classId: idSchema, topic: z.string().nullable(), search: z.string().trim().max(100) }),
    ({ classId, topic, search }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      const term = `%${search}%`;
      return ctx.db
        .select({
          id: posts.id,
          topic: posts.topic,
          title: posts.title,
          body: posts.body,
          visibility: posts.visibility,
          createdAt: posts.createdAt,
          editedAt: posts.editedAt,
          ...author,
          replyCount: sql<number>`(select count(*) from ${replies} where ${replies.postId} = ${posts.id})`.mapWith(Number),
        })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .where(
          and(
            eq(posts.classId, classId),
            canSee(ctx.userId),
            topic ? eq(posts.topic, topic) : undefined,
            search ? or(like(posts.title, term), like(posts.body, term)) : undefined,
          ),
        )
        .orderBy(desc(posts.createdAt))
        .all();
    },
  ),

  get: procedure(z.object({ postId: idSchema }), ({ postId }, ctx) => {
    const post = visiblePost(ctx.db, ctx.userId, postId);
    const writer = ctx.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, post.authorId)).get();
    return {
      ...post,
      authorName: writer?.name ?? 'Deleted user',
      authorEmail: writer?.email ?? '',
      mine: post.authorId === ctx.userId,
      audience: post.visibility === 'selected' ? audienceOf(ctx.db, postId) : [],
      replies: ctx.db
        .select({ id: replies.id, body: replies.body, createdAt: replies.createdAt, ...author })
        .from(replies)
        .innerJoin(users, eq(replies.authorId, users.id))
        .where(eq(replies.postId, postId))
        .orderBy(asc(replies.createdAt))
        .all()
        .map((r) => ({ ...r, mine: r.authorId === ctx.userId })),
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

  reply: procedure(z.object({ postId: idSchema, body: nonEmpty('Reply', 5000) }), ({ postId, body }, ctx) => {
    visiblePost(ctx.db, ctx.userId, postId);
    ctx.db.insert(replies).values({ postId, body, authorId: ctx.userId }).run();
  }),

  removeReply: procedure(z.object({ replyId: idSchema }), ({ replyId }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    if (reply.authorId !== ctx.userId) throw new AppError('You can only delete your own replies.', 'FORBIDDEN');
    ctx.db.delete(replies).where(eq(replies.id, replyId)).run();
  }),
};
