import { rm, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { and, asc, count, desc, eq, gte, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { goatFor } from '@shared/goat';
import { keywords, similarity } from '@shared/similar';
import type { DB } from '../db/client';
import { boardImages, boardVisits, classes, courseInfo, courses, enrollments, postAudience, postFollows, postReactions, postReports, posts, replies, replyReactions, users } from '../db/schema';
import { AppError, type AuthedContext, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, FORMER_STUDENT_EMAIL, notFound, professorsOf, requireMember, requireTeacher, sectionCode, studentsOf, teaches } from './access';
import { visibleClassmatesByEmail } from './classes';
import { m, notify, raw } from './notifications';
import { storeAttachment } from './planner';

// S4 in version B: Ed-style, closer to a Q&A site. A post is a question or a note, filed
// under one of a fixed set of topics. Replies are one flat list; whoever asked a question
// can accept one reply as the answer, which resolves it and shows that answer first.
// Deleting a post that has replies keeps the thread and blanks the post.
// Posts are visible to the whole class or only to selected classmates; 🐐 reactions stay.
// Students follow the threads they post or reply in (or pick to), and hear about new replies.
// A section's professor moderates: pins and locks threads, endorses replies, removes what
// doesn't belong, and their notes go out to the whole section as announcements.

export const SUGGESTED_TOPICS = ['Lectures', 'Assignments', 'Exams', 'Labs and tutorials', 'Logistics', 'Off-topic'];

const postFields = {
  kind: z.enum(['question', 'note']),
  topic: z.enum(SUGGESTED_TOPICS as [string, ...string[]], { message: 'Pick a topic' }),
  title: nonEmpty('Title', 200),
  body: nonEmpty('Post', 10_000),
};

export function canSeePost(userId: number) {
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

// "New since your last visit": posts by others after the student last opened the class's
// discussion. Before their first visit, only the last three days count, not the whole term.
const FIRST_VISIT_WINDOW = 3 * 86_400_000;

function lastSeen(db: DB, userId: number, now: Date) {
  const seen = new Map(
    db
      .select()
      .from(boardVisits)
      .where(eq(boardVisits.userId, userId))
      .all()
      .map((v) => [v.classId, v.seenAt.getTime()]),
  );
  return (classId: number) => seen.get(classId) ?? now.getTime() - FIRST_VISIT_WINDOW;
}

function visiblePost(db: DB, userId: number, postId: number) {
  const post = db.select().from(posts).where(and(eq(posts.id, postId), canSeePost(userId))).get() ?? notFound('post');
  requireMember(db, userId, post.classId);
  return post;
}

function ownPost(db: DB, userId: number, postId: number) {
  const post = db.select().from(posts).where(eq(posts.id, postId)).get() ?? notFound('post');
  if (post.authorId !== userId) throw new AppError('You can only change your own posts.', 'FORBIDDEN');
  if (post.deletedAt) throw new AppError('This post was deleted.');
  return post;
}

// S4: screenshots and photos in posts and replies. SVGs are left out: they can carry scripts.
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imagePaths = z.array(z.string()).max(MAX_IMAGES, 'A post or reply can have up to 4 images.').default([]);

// Copies the picked images in, checking them all first so a bad one stops the whole post.
async function storeImages(ctx: AuthedContext, paths: string[]) {
  for (const path of paths) {
    if (!IMAGE_FILE.test(basename(path))) throw new AppError('Images can be PNG, JPEG, GIF or WebP.');
    const info = await stat(path).catch(() => null);
    if (!info) throw new AppError('That file could not be read.');
    if (info.size > MAX_IMAGE_BYTES) throw new AppError('Images can be up to 5 MB.');
  }
  return Promise.all(paths.map((path) => storeAttachment(ctx, path)));
}

async function deleteImages(ctx: AuthedContext, which: SQL | undefined) {
  const rows = ctx.db.select().from(boardImages).where(which).all();
  await Promise.all(rows.map((image) => rm(image.path, { force: true })));
  if (rows.length) ctx.db.delete(boardImages).where(inArray(boardImages.id, rows.map((image) => image.id))).run();
}

const ownImagesOf = (postId: number) => and(eq(boardImages.postId, postId), isNull(boardImages.replyId));

function imagesFor(db: DB, postIds: number[]) {
  if (!postIds.length) return [];
  return db
    .select({ id: boardImages.id, name: boardImages.name, postId: boardImages.postId, replyId: boardImages.replyId })
    .from(boardImages)
    .where(inArray(boardImages.postId, postIds))
    .orderBy(asc(boardImages.id))
    .all();
}

// When an account goes along with its posts and replies, so do their images.
export async function deleteAuthoredImages(ctx: AuthedContext) {
  const rows = ctx.db
    .select({ id: boardImages.id })
    .from(boardImages)
    .innerJoin(posts, eq(boardImages.postId, posts.id))
    .leftJoin(replies, eq(boardImages.replyId, replies.id))
    .where(or(eq(posts.authorId, ctx.userId), eq(replies.authorId, ctx.userId)))
    .all();
  if (rows.length) await deleteImages(ctx, inArray(boardImages.id, rows.map((r) => r.id)));
}

// Posting or replying follows a thread, unless the student unfollowed it before.
function follow(db: DB, postId: number, userId: number) {
  db.insert(postFollows).values({ postId, userId, following: true }).onConflictDoNothing().run();
}

const followsSql = (userId: number) =>
  sql`(select count(*) from ${postFollows} where ${postFollows.postId} = ${posts.id} and ${postFollows.userId} = ${userId} and ${postFollows.following} = 1)`;

// Who to tell about a new reply: followers still in the class who can still see the post,
// unless they muted replies in that class.
function followersOf(db: DB, post: typeof posts.$inferSelect) {
  return db
    .select({ id: postFollows.userId })
    .from(postFollows)
    .innerJoin(enrollments, and(eq(enrollments.userId, postFollows.userId), eq(enrollments.classId, post.classId)))
    .leftJoin(courseInfo, and(eq(courseInfo.userId, postFollows.userId), eq(courseInfo.classId, post.classId)))
    .where(
      and(
        eq(postFollows.postId, post.id),
        eq(postFollows.following, true),
        or(isNull(courseInfo.muteReplies), eq(courseInfo.muteReplies, false)),
        post.visibility === 'class'
          ? undefined
          : or(
              eq(postFollows.userId, post.authorId),
              inArray(postFollows.userId, sql`(select ${postAudience.userId} from ${postAudience} where ${postAudience.postId} = ${post.id})`),
            ),
      ),
    )
    .all()
    .map((r) => r.id);
}

// What moderation can reach: posts the professor can see (private ones only if picked).
function moderatedPost(ctx: AuthedContext, postId: number) {
  const post = visiblePost(ctx.db, ctx.userId, postId);
  requireTeacher(ctx.db, ctx.userId, post.classId);
  return post;
}

// What's been reported in a post (replyId null is the post itself), for its professor.
function reportsOn(db: DB, postId: number) {
  return db.select({ replyId: postReports.replyId, reason: postReports.reason, userId: postReports.userId }).from(postReports).where(eq(postReports.postId, postId)).all();
}

const nameOf = (db: DB, userId: number) => db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ?? '';

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
  authorRole: users.role,
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
      // Newest first, or the posts with the most 🐐 first.
      sort: z.enum(['new', 'top']).default('new'),
      // Only threads the student follows.
      following: z.boolean().default(false),
      // For a professor: only threads with something students reported.
      reported: z.boolean().default(false),
    }),
    ({ classIds, topics, since, search, unresolved, sort, following, reported }, ctx) => {
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
      const goats = sql<number>`(select count(*) from ${postReactions} where ${postReactions.postId} = ${posts.id})`.mapWith(Number);
      const seen = lastSeen(ctx.db, ctx.userId, now);
      const reportsSql = sql`(select count(*) from ${postReports} where ${postReports.postId} = ${posts.id})`;
      // A professor's reply or endorsement answers a question, whether or not the asker accepts one.
      const professorAnsweredSql = sql<number>`exists (select 1 from ${replies} inner join ${users} on ${users.id} = ${replies.authorId} where ${replies.postId} = ${posts.id} and (${replies.endorsedAt} is not null or ${users.role} = 'professor'))`;
      const taught = ids.filter((id) => teaches(ctx.db, ctx.userId, id));

      const rows = ctx.db
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
          pinnedAt: posts.pinnedAt,
          lockedAt: posts.lockedAt,
          removedByProfessor: posts.removedByProfessor,
          reports: reportsSql.mapWith(Number),
          professorAnswered: professorAnsweredSql.mapWith(Boolean),
          ...authorColumns,
          replyCount: sql<number>`(select count(*) from ${replies} where ${replies.postId} = ${posts.id})`.mapWith(Number),
          goats,
          goated: sql<number>`(select count(*) from ${postReactions} where ${postReactions.postId} = ${posts.id} and ${postReactions.userId} = ${ctx.userId})`.mapWith(Boolean),
        })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .innerJoin(classes, eq(posts.classId, classes.id))
        .innerJoin(courses, eq(classes.courseId, courses.id))
        .where(
          and(
            inArray(posts.classId, ids),
            canSeePost(ctx.userId),
            topics.length ? inArray(posts.topic, topics) : undefined,
            from ? gte(posts.createdAt, from) : undefined,
            search ? or(like(posts.title, term), like(posts.body, term)) : undefined,
            unresolved ? and(eq(posts.kind, 'question'), isNull(posts.acceptedReplyId), isNull(posts.deletedAt), sql`not ${professorAnsweredSql}`) : undefined,
            following ? sql`${followsSql(ctx.userId)} > 0` : undefined,
            // Only in sections they teach: whether something's been reported is theirs to know.
            reported ? and(inArray(posts.classId, taught), sql`${reportsSql} > 0`) : undefined,
          ),
        )
        // On one class's board, what its professor pinned comes first.
        .orderBy(...(ids.length === 1 ? [sql`${posts.pinnedAt} is null`] : []), ...(sort === 'top' ? [desc(goats)] : []), desc(posts.createdAt), desc(posts.id))
        .limit(100)
        .all();
      const images = imagesFor(ctx.db, rows.map((p) => p.id)).filter((image) => image.replyId == null);
      return rows.map((p) => ({
        ...withGoat(p),
        isNew: p.authorId !== ctx.userId && !p.deletedAt && p.createdAt.getTime() > seen(p.classId),
        images: images.filter((image) => image.postId === p.id),
        // Only the section's professor sees that anything's been reported.
        reports: taught.includes(p.classId) ? p.reports : 0,
      }));
    },
  ),

  // Opening a class's discussion marks its posts as seen.
  seen: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const seenAt = ctx.now();
    ctx.db
      .insert(boardVisits)
      .values({ userId: ctx.userId, classId, seenAt })
      .onConflictDoUpdate({ target: [boardVisits.userId, boardVisits.classId], set: { seenAt } })
      .run();
  }),

  // How many posts are new in each of the student's classes.
  newCounts: procedure(z.void(), (_input, ctx) => {
    const ids = myClassIds(ctx.db, ctx.userId);
    if (!ids.length) return [];
    const seen = lastSeen(ctx.db, ctx.userId, ctx.now());
    const counts = new Map<number, number>();
    for (const p of ctx.db
      .select({ classId: posts.classId, authorId: posts.authorId, createdAt: posts.createdAt })
      .from(posts)
      .where(and(inArray(posts.classId, ids), canSeePost(ctx.userId), isNull(posts.deletedAt)))
      .all()) {
      if (p.authorId !== ctx.userId && p.createdAt.getTime() > seen(p.classId)) counts.set(p.classId, (counts.get(p.classId) ?? 0) + 1);
    }
    return [...counts].map(([classId, count]) => ({ classId, count }));
  }),

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
      .select({ id: replies.id, body: replies.body, createdAt: replies.createdAt, editedAt: replies.editedAt, endorsedAt: replies.endorsedAt, ...authorColumns })
      .from(replies)
      .innerJoin(users, eq(replies.authorId, users.id))
      .where(eq(replies.postId, postId))
      .orderBy(asc(replies.createdAt), asc(replies.id))
      .all();
    const images = imagesFor(ctx.db, [postId]);
    const canModerate = teaches(ctx.db, ctx.userId, post.classId);
    const reports = reportsOn(ctx.db, postId);
    const reasonsFor = (replyId: number | null) => (canModerate ? reports.filter((r) => r.replyId === replyId).map((r) => r.reason) : []);
    const reportedByMe = (replyId: number | null) => reports.some((r) => r.replyId === replyId && r.userId === ctx.userId);
    const hasProfessor = professorsOf(ctx.db, post.classId).length > 0;
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
      authorRole: writer?.role ?? ('student' as const),
    });

    return {
      ...post,
      ...author,
      classLabel: label ?? '',
      mine: post.authorId === ctx.userId,
      canModerate,
      professorAnswered: replyRows.some((r) => r.endorsedAt != null || r.authorRole === 'professor'),
      // Reports go to the section's professor, so there's nobody to tell without one.
      canReport: hasProfessor && !canModerate,
      reports: reasonsFor(null),
      reportedByMe: reportedByMe(null),
      images: images.filter((image) => image.replyId == null),
      goats: reactions.length,
      goated: reactions.some((r) => r.userId === ctx.userId),
      following: !!ctx.db
        .select()
        .from(postFollows)
        .where(and(eq(postFollows.postId, postId), eq(postFollows.userId, ctx.userId), eq(postFollows.following, true)))
        .get(),
      audience: post.visibility === 'selected' ? audienceOf(ctx.db, postId) : [],
      // The accepted answer comes first, then what the professor endorsed, then the rest in order.
      replies: replyRows
        .map((r) => ({
          ...withGoat(r),
          accepted: r.id === post.acceptedReplyId,
          endorsed: r.endorsedAt != null,
          images: images.filter((image) => image.replyId === r.id),
          reports: reasonsFor(r.id),
          reportedByMe: reportedByMe(r.id),
          mine: r.authorId === ctx.userId,
          goats: replyGoats.filter((g) => g.replyId === r.id).length,
          goated: replyGoats.some((g) => g.replyId === r.id && g.userId === ctx.userId),
        }))
        .sort((a, b) => Number(b.accepted) - Number(a.accepted) || Number(b.endorsed) - Number(a.endorsed)),
    };
  }),

  create: procedure(
    z.object({
      classId: idSchema,
      ...postFields,
      visibility: z.enum(['class', 'selected']),
      audienceEmails: z.array(z.string()),
      images: imagePaths,
    }),
    async ({ classId, audienceEmails, images, ...fields }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      const audience =
        fields.visibility === 'selected'
          ? visibleClassmatesByEmail(ctx.db, ctx.userId, classId, audienceEmails)
          : [];
      if (fields.visibility === 'selected' && !audience.length) {
        throw new AppError('Pick at least one classmate who can see this post.');
      }
      const stored = await storeImages(ctx, images);
      const created = ctx.db.transaction((tx) => {
        const post = tx
          .insert(posts)
          .values({ ...fields, classId, authorId: ctx.userId, createdAt: ctx.now() })
          .returning({ id: posts.id })
          .get();
        if (audience.length) tx.insert(postAudience).values(audience.map((u) => ({ postId: post.id, userId: u.id }))).run();
        if (stored.length) tx.insert(boardImages).values(stored.map((f) => ({ postId: post.id, name: f.attachmentName, path: f.attachmentPath }))).run();
        follow(tx, post.id, ctx.userId);
        return post;
      });
      // A professor's note to the whole section is an announcement.
      if (fields.kind === 'note' && fields.visibility === 'class' && teaches(ctx.db, ctx.userId, classId)) {
        for (const student of studentsOf(ctx.db, classId)) {
          notify(ctx.db, student.id, {
            type: 'announcement',
            title: m('{{class}}: {{title}}', { class: classLabel(ctx.db, classId) ?? '', title: fields.title }),
            body: raw(fields.body.length > 140 ? `${fields.body.slice(0, 140)}…` : fields.body),
            link: `/classes/${classId}/discussion?post=${created.id}`,
          });
        }
      }
      return created;
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
  remove: procedure(z.object({ postId: idSchema }), async ({ postId }, ctx) => {
    ownPost(ctx.db, ctx.userId, postId);
    await deleteImages(ctx, ownImagesOf(postId));
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

  // "Already asked?": up to three posts in the class like the one being written.
  similar: procedure(z.object({ classId: idSchema, title: z.string().trim().max(200) }), ({ classId, title }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const query = keywords(title);
    if (query.size < 2) return [];
    return ctx.db
      .select({ id: posts.id, title: posts.title, body: posts.body, kind: posts.kind, acceptedReplyId: posts.acceptedReplyId })
      .from(posts)
      .where(and(eq(posts.classId, classId), canSeePost(ctx.userId), isNull(posts.deletedAt)))
      .all()
      .map(({ body, ...p }) => ({ ...p, score: similarity(query, p.title, body) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score || b.id - a.id)
      .slice(0, 3)
      .map(({ score: _, ...p }) => p);
  }),

  chooseImage: procedure(z.void(), async (_input, ctx) => {
    const path = await ctx.platform.chooseFile({ title: 'Add an image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    return path ? { path, name: basename(path) } : null;
  }),

  // Where the page can show an image, for anyone who can see its post.
  imageUrl: procedure(z.object({ id: idSchema }), async ({ id }, ctx) => {
    const image = ctx.db.select().from(boardImages).where(eq(boardImages.id, id)).get() ?? notFound('image');
    visiblePost(ctx.db, ctx.userId, image.postId);
    return ctx.platform.fileUrl(image.path);
  }),

  // Follow a thread to hear about every new reply, or stop following it.
  follow: procedure(z.object({ postId: idSchema, following: z.boolean() }), ({ postId, following }, ctx) => {
    visiblePost(ctx.db, ctx.userId, postId);
    ctx.db
      .insert(postFollows)
      .values({ postId, userId: ctx.userId, following })
      .onConflictDoUpdate({ target: [postFollows.postId, postFollows.userId], set: { following } })
      .run();
  }),

  // Replies are one flat list under the post. Everyone following the thread hears about it.
  reply: procedure(z.object({ postId: idSchema, body: nonEmpty('Reply', 5000), images: imagePaths }), async ({ postId, body, images }, ctx) => {
    const post = visiblePost(ctx.db, ctx.userId, postId);
    if (post.lockedAt && !teaches(ctx.db, ctx.userId, post.classId)) throw new AppError('The professor locked this thread.', 'FORBIDDEN');
    const stored = await storeImages(ctx, images);
    const reply = ctx.db.insert(replies).values({ postId, body, authorId: ctx.userId }).returning({ id: replies.id }).get();
    if (stored.length) ctx.db.insert(boardImages).values(stored.map((f) => ({ postId, replyId: reply.id, name: f.attachmentName, path: f.attachmentPath }))).run();
    follow(ctx.db, postId, ctx.userId);
    if (post.deletedAt) return;
    const replierName = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get()?.name;
    const name = replierName ?? { t: 'A classmate' };
    const title = post.title;
    for (const userId of followersOf(ctx.db, post)) {
      if (userId === ctx.userId) continue;
      notify(ctx.db, userId, {
        type: 'reply',
        title:
          userId === post.authorId
            ? m('{{name}} replied to "{{title}}"', { name, title })
            : m('{{name}} replied in "{{title}}"', { name, title }),
        body: raw(body.length > 140 ? `${body.slice(0, 140)}…` : body),
        link: `/classes/${post.classId}/discussion?post=${postId}`,
      });
    }
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

  editReply: procedure(z.object({ replyId: idSchema, body: nonEmpty('Reply', 5000) }), ({ replyId, body }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    if (reply.authorId !== ctx.userId) throw new AppError('You can only edit your own replies.', 'FORBIDDEN');
    ctx.db.update(replies).set({ body, editedAt: ctx.now() }).where(eq(replies.id, replyId)).run();
  }),

  // A student tells the section's professor about a post or reply, once. Their name stays out of it.
  report: procedure(z.object({ postId: idSchema, replyId: idSchema.nullable(), reason: z.string().trim().max(500) }), ({ postId, replyId, reason }, ctx) => {
    const post = visiblePost(ctx.db, ctx.userId, postId);
    const professors = professorsOf(ctx.db, post.classId);
    if (!professors.length) throw new AppError("This section's professor isn't on UniLink, so there's nobody to tell.");
    const reply = replyId ? ctx.db.select().from(replies).where(and(eq(replies.id, replyId), eq(replies.postId, postId))).get() ?? notFound('reply') : null;
    if ((reply?.authorId ?? post.authorId) === ctx.userId) throw new AppError("You can't report your own post.");
    const about = and(eq(postReports.postId, postId), replyId ? eq(postReports.replyId, replyId) : isNull(postReports.replyId));
    if (ctx.db.select({ id: postReports.id }).from(postReports).where(and(about, eq(postReports.userId, ctx.userId))).get()) {
      throw new AppError('You already reported this.', 'CONFLICT');
    }
    ctx.db.insert(postReports).values({ postId, replyId, reason, userId: ctx.userId, createdAt: ctx.now() }).run();
    for (const professor of professors) {
      notify(ctx.db, professor.id, {
        type: 'post-reported',
        title: reply ? m('A student reported a reply in "{{title}}"', { title: post.title || { t: 'a deleted post' } }) : m('A student reported "{{title}}"', { title: post.title }),
        body: reason ? raw(reason) : undefined,
        link: `/classes/${post.classId}/discussion?post=${postId}`,
      });
    }
  }),

  // The professor looked and it's fine.
  dismissReports: procedure(z.object({ postId: idSchema, replyId: idSchema.nullable() }), ({ postId, replyId }, ctx) => {
    moderatedPost(ctx, postId);
    ctx.db.delete(postReports).where(and(eq(postReports.postId, postId), replyId ? eq(postReports.replyId, replyId) : isNull(postReports.replyId))).run();
  }),

  // Moderation, for the section's professor.
  pin: procedure(z.object({ postId: idSchema, pinned: z.boolean() }), ({ postId, pinned }, ctx) => {
    moderatedPost(ctx, postId);
    ctx.db.update(posts).set({ pinnedAt: pinned ? ctx.now() : null }).where(eq(posts.id, postId)).run();
  }),

  lock: procedure(z.object({ postId: idSchema, locked: z.boolean() }), ({ postId, locked }, ctx) => {
    moderatedPost(ctx, postId);
    ctx.db.update(posts).set({ lockedAt: locked ? ctx.now() : null }).where(eq(posts.id, postId)).run();
  }),

  endorse: procedure(z.object({ replyId: idSchema, endorsed: z.boolean() }), ({ replyId, endorsed }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    const post = moderatedPost(ctx, reply.postId);
    ctx.db.update(replies).set({ endorsedAt: endorsed ? ctx.now() : null }).where(eq(replies.id, replyId)).run();
    if (endorsed && !reply.endorsedAt && reply.authorId !== ctx.userId) {
      notify(ctx.db, reply.authorId, {
        type: 'answer-accepted',
        title: m('{{name}} endorsed your reply in "{{title}}"', { name: nameOf(ctx.db, ctx.userId), title: post.title }),
        body: raw(reply.body.length > 140 ? `${reply.body.slice(0, 140)}…` : reply.body),
        link: `/classes/${post.classId}/discussion?post=${post.id}`,
      });
    }
  }),

  // Removing someone's post works like deleting your own: a thread with replies stays up,
  // blanked. The author is told, with the reason if there is one.
  removeAsProfessor: procedure(z.object({ postId: idSchema, reason: z.string().trim().max(500) }), async ({ postId, reason }, ctx) => {
    const post = moderatedPost(ctx, postId);
    await deleteImages(ctx, ownImagesOf(postId));
    ctx.db.delete(postReports).where(and(eq(postReports.postId, postId), isNull(postReports.replyId))).run();
    const replyCount = ctx.db.select({ n: count() }).from(replies).where(eq(replies.postId, postId)).get()?.n ?? 0;
    if (replyCount) {
      ctx.db.update(posts).set({ title: '', body: '', deletedAt: ctx.now(), removedByProfessor: true, pinnedAt: null }).where(eq(posts.id, postId)).run();
    } else {
      ctx.db.delete(posts).where(eq(posts.id, postId)).run();
    }
    if (post.authorId !== ctx.userId && !post.deletedAt) {
      notify(ctx.db, post.authorId, {
        type: 'moderation',
        title: m('{{name}} removed your post "{{title}}"', { name: nameOf(ctx.db, ctx.userId), title: post.title }),
        body: reason ? raw(reason) : undefined,
        link: `/classes/${post.classId}/discussion`,
      });
    }
    return { kept: replyCount > 0 };
  }),

  removeReplyAsProfessor: procedure(z.object({ replyId: idSchema, reason: z.string().trim().max(500) }), async ({ replyId, reason }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    const post = moderatedPost(ctx, reply.postId);
    await deleteImages(ctx, eq(boardImages.replyId, replyId));
    ctx.db.transaction((tx) => {
      tx.update(posts).set({ acceptedReplyId: null }).where(eq(posts.acceptedReplyId, replyId)).run();
      tx.delete(replies).where(eq(replies.id, replyId)).run();
    });
    if (reply.authorId !== ctx.userId) {
      notify(ctx.db, reply.authorId, {
        type: 'moderation',
        title: m('{{name}} removed your reply in "{{title}}"', { name: nameOf(ctx.db, ctx.userId), title: post.title || { t: 'a deleted post' } }),
        body: reason ? raw(reason) : undefined,
        link: `/classes/${post.classId}/discussion?post=${post.id}`,
      });
    }
  }),

  removeReply: procedure(z.object({ replyId: idSchema }), async ({ replyId }, ctx) => {
    const reply = ctx.db.select().from(replies).where(eq(replies.id, replyId)).get() ?? notFound('reply');
    if (reply.authorId !== ctx.userId) throw new AppError('You can only delete your own replies.', 'FORBIDDEN');
    await deleteImages(ctx, eq(boardImages.replyId, replyId));
    ctx.db.transaction((tx) => {
      tx.update(posts).set({ acceptedReplyId: null }).where(eq(posts.acceptedReplyId, replyId)).run();
      tx.delete(replies).where(eq(replies.id, replyId)).run();
    });
  }),
};
