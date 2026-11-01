import { and, asc, count, desc, eq, gte, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { goatFor } from '@shared/goat';
import type { DB } from '../db/client';
import { classes, courses, enrollments, postAudience, postReactions, posts, replies, replyReactions, users } from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { FORMER_STUDENT_EMAIL, notFound, requireMember, sectionCode } from './access';
import { enrolledUsersByEmail } from './classes';
import { m, notify, raw } from './notifications';

// S4 in version B: Ed-style, closer to a Q&A site. A post is a question or a note, filed
// under one of a fixed set of topics. Replies are one flat list; whoever asked a question
// can accept one reply as the answer, which resolves it and shows that answer first.
// Deleting a post that has replies keeps the thread and blanks the post.
// Posts are visible to the whole class or only to selected classmates; 🐐 reactions stay.

export const SUGGESTED_TOPICS = ['Lectures', 'Assignments', 'Exams', 'Labs and tutorials', 'Logistics', 'Off-topic'];

const postFields = {
  kind: z.enum(['question', 'note']),
  topic: z.enum(SUGGESTED_TOPICS as [string, ...string[]], { message: 'Pick a topic' }),
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
  if (post.deletedAt) throw new AppError('This post was deleted.');
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

// S1/G4.5: what classmates see about someone once they post or reply.
const authorColumns = {
  authorId: users.id,
  authorName: users.name,
  authorEmail: users.email,
  authorAvatar: users.avatar,
  authorPronouns: users.pronouns,
  authorFaculty: users.faculty,
  authorGradYear: users.gradYear,
};

type AuthorRow = { authorId: number; authorAvatar: unknown; authorEmail: string; authorPronouns: string; authorFaculty: string; authorGradYear: number | null };

// Former students (deleted accounts) are shown without a name, email, profile or goat outfit.
const withGoat = <T extends AuthorRow>({ authorAvatar, ...row }: T) => {
  const former = row.authorEmail === FORMER_STUDENT_EMAIL;
  return {
    ...row,
    ...(former ? { authorEmail: '', authorPronouns: '', authorFaculty: '', authorGradYear: null } : {}),
    formerStudent: former,
    authorGoat: goatFor(row.authorId, former ? null : (authorAvatar as never)),
  };
};

export const boardRouter = {
  // The fixed topics, for the filters and the composer.
  topics: procedure(z.object({ classId: idSchema.nullable() }), ({ classId }, ctx) => {
    if (classId) requireMember(ctx.db, ctx.userId, classId);
    return SUGGESTED_TOPICS;
  }),

  // One class's board, or the home feed across every class the student is in.
  feed: procedure(
    z.object({
      classIds: z.array(idSchema).nullable(),
      topics: z.array(z.string()),
      since: z.enum(['today', 'week', 'month']).nullable(),
      search: z.string().trim().max(100),
      // Only questions nobody has answered yet.
      unresolved: z.boolean().default(false),
    }),
    ({ classIds, topics, since, search, unresolved }, ctx) => {
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
          classLabel: sectionCode,
          kind: posts.kind,
          topic: posts.topic,
          title: posts.title,
          body: posts.body,
          visibility: posts.visibility,
          acceptedReplyId: posts.acceptedReplyId,
          deletedAt: posts.deletedAt,
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
            unresolved ? and(eq(posts.kind, 'question'), isNull(posts.acceptedReplyId), isNull(posts.deletedAt)) : undefined,
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
      .select({ label: sectionCode })
      .from(classes)
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .where(eq(classes.id, post.classId))
      .get()?.label;
    const reactions = ctx.db.select().from(postReactions).where(eq(postReactions.postId, postId)).all();
    const replyRows = ctx.db
      .select({ id: replies.id, body: replies.body, createdAt: replies.createdAt, ...authorColumns })
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
    const author = withGoat({
      authorId: post.authorId,
      authorName: writer?.name ?? '',
      authorEmail: writer?.email ?? FORMER_STUDENT_EMAIL,
      authorAvatar: writer?.avatar,
      authorPronouns: writer?.pronouns ?? '',
      authorFaculty: writer?.faculty ?? '',
      authorGradYear: writer?.gradYear ?? null,
    });

    return {
      ...post,
      ...author,
      classLabel: label ?? '',
      mine: post.authorId === ctx.userId,
      goats: reactions.length,
      goated: reactions.some((r) => r.userId === ctx.userId),
      audience: post.visibility === 'selected' ? audienceOf(ctx.db, postId) : [],
      // The accepted answer comes first, then everything else in order.
      replies: replyRows
        .map((r) => ({
          ...withGoat(r),
          accepted: r.id === post.acceptedReplyId,
          mine: r.authorId === ctx.userId,
          goats: replyGoats.filter((g) => g.replyId === r.id).length,
          goated: replyGoats.some((g) => g.replyId === r.id && g.userId === ctx.userId),
        }))
        .sort((a, b) => Number(b.accepted) - Number(a.accepted)),
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
    const post = ownPost(ctx.db, ctx.userId, postId);
    ctx.db
      .update(posts)
      .set({ ...fields, acceptedReplyId: fields.kind === 'note' ? null : post.acceptedReplyId, editedAt: ctx.now() })
      .where(eq(posts.id, postId))
      .run();
  }),

  // A post with replies is blanked rather than deleted, so the answers stay readable.
  remove: procedure(z.object({ postId: idSchema }), ({ postId }, ctx) => {
    ownPost(ctx.db, ctx.userId, postId);
    const replyCount = ctx.db.select({ n: count() }).from(replies).where(eq(replies.postId, postId)).get()?.n ?? 0;
    if (!replyCount) {
      ctx.db.delete(posts).where(eq(posts.id, postId)).run();
      return { kept: false };
    }
    ctx.db.update(posts).set({ title: '', body: '', deletedAt: ctx.now() }).where(eq(posts.id, postId)).run();
    return { kept: true };
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

  // Replies are one flat list under the post.
  reply: procedure(z.object({ postId: idSchema, body: nonEmpty('Reply', 5000) }), ({ postId, body }, ctx) => {
    const post = visiblePost(ctx.db, ctx.userId, postId);
    ctx.db.insert(replies).values({ postId, body, authorId: ctx.userId }).run();
    if (post.authorId === ctx.userId || post.deletedAt) return;
    const replierName = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get()?.name;
    notify(ctx.db, post.authorId, {
      type: 'reply',
      title: m('{{name}} replied to "{{title}}"', { name: replierName ?? { t: 'A classmate' }, title: post.title }),
      body: raw(body.length > 140 ? `${body.slice(0, 140)}…` : body),
      link: `/classes/${post.classId}/discussion?post=${postId}`,
    });
  }),

  // Whoever asked picks the answer that solved it (or takes it back with replyId null).
  accept: procedure(z.object({ postId: idSchema, replyId: idSchema.nullable() }), ({ postId, replyId }, ctx) => {
    const post = ownPost(ctx.db, ctx.userId, postId);
    if (post.kind !== 'question') throw new AppError('Only questions have an accepted answer.');
    const reply = replyId ? (ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply')) : null;
    if (reply && reply.postId !== postId) notFound('reply');
    if (reply && reply.authorId === ctx.userId) throw new AppError("You can't accept your own reply.");
    ctx.db.update(posts).set({ acceptedReplyId: reply?.id ?? null }).where(eq(posts.id, postId)).run();
    if (reply && reply.id !== post.acceptedReplyId) {
      notify(ctx.db, reply.authorId, {
        type: 'answer-accepted',
        title: m('Your answer to "{{title}}" was accepted', { title: post.title }),
        body: raw(reply.body.length > 140 ? `${reply.body.slice(0, 140)}…` : reply.body),
        link: `/classes/${post.classId}/discussion?post=${postId}`,
      });
    }
  }),

  removeReply: procedure(z.object({ replyId: idSchema }), ({ replyId }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    if (reply.authorId !== ctx.userId) throw new AppError('You can only delete your own replies.', 'FORBIDDEN');
    ctx.db.transaction((tx) => {
      tx.update(posts).set({ acceptedReplyId: null }).where(eq(posts.acceptedReplyId, replyId)).run();
      tx.delete(replies).where(eq(replies.id, replyId)).run();
    });
  }),
};
