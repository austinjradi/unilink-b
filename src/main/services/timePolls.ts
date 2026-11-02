import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client';
import { enrollments, studySessions, timePollOptions, timePolls, timePollVotes, users } from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, notFound, requireMember } from './access';
import { m, notify, raw } from './notifications';

// S3: someone who doesn't know when suits people offers a few times, and the section says which
// work. Votes are only ever counts, since members stay hidden until they post (S1). Picking a
// time opens the normal session form; voters hear about it and decide for themselves to join.

function pollOf(db: DB, pollId: number) {
  return db.select().from(timePolls).where(eq(timePolls.id, pollId)).get() ?? notFound('poll');
}

function optionOf(db: DB, optionId: number) {
  const option = db.select().from(timePollOptions).where(eq(timePollOptions.id, optionId)).get() ?? notFound('poll');
  return { option, poll: pollOf(db, option.pollId) };
}

export const timePollsRouter = {
  // Open polls with a time still to come, in one section or all of yours. Votes from people who've
  // left the section don't count.
  list: procedure(z.object({ classId: idSchema.nullable() }), ({ classId }, ctx) => {
    if (classId != null) requireMember(ctx.db, ctx.userId, classId);
    const mine = ctx.db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, ctx.userId));
    const polls = ctx.db
      .select({ poll: timePolls, hostName: users.name })
      .from(timePolls)
      .innerJoin(users, eq(timePolls.hostId, users.id))
      .where(and(classId != null ? eq(timePolls.classId, classId) : inArray(timePolls.classId, mine), isNull(timePolls.closedAt)))
      .orderBy(asc(timePolls.createdAt))
      .all();
    return polls.flatMap(({ poll, hostName }) => {
      const options = ctx.db
        .select()
        .from(timePollOptions)
        .where(and(eq(timePollOptions.pollId, poll.id), gte(timePollOptions.startsAt, ctx.now())))
        .orderBy(asc(timePollOptions.startsAt))
        .all();
      if (!options.length) return [];
      const votes = ctx.db
        .select({ optionId: timePollVotes.optionId, userId: timePollVotes.userId })
        .from(timePollVotes)
        .innerJoin(enrollments, and(eq(enrollments.userId, timePollVotes.userId), eq(enrollments.classId, poll.classId)))
        .where(inArray(timePollVotes.optionId, options.map((o) => o.id)))
        .all();
      return [
        {
          id: poll.id,
          classId: poll.classId,
          classLabel: classLabel(ctx.db, poll.classId),
          title: poll.title,
          hostName,
          mine: poll.hostId === ctx.userId,
          options: options.map((o) => ({
            id: o.id,
            startsAt: o.startsAt,
            endsAt: o.endsAt,
            votes: votes.filter((v) => v.optionId === o.id).length,
            voted: votes.some((v) => v.optionId === o.id && v.userId === ctx.userId),
          })),
        },
      ];
    });
  }),

  create: procedure(
    z.object({ classId: idSchema, title: nonEmpty('Title', 120), minutes: z.number().int().min(15).max(8 * 60), times: z.array(z.date()).max(5) }),
    ({ classId, title, minutes, times }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      if (times.length < 2) throw new AppError('Offer at least two times.');
      if (times.some((time) => time <= ctx.now())) throw new AppError('Pick times in the future.');
      if (new Set(times.map((time) => time.getTime())).size < times.length) throw new AppError('Those times are the same. Offer different ones.');
      return ctx.db.transaction((tx) => {
        const poll = tx.insert(timePolls).values({ classId, hostId: ctx.userId, title }).returning().get();
        tx.insert(timePollOptions)
          .values(times.map((startsAt) => ({ pollId: poll.id, startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) })))
          .run();
        return { id: poll.id };
      });
    },
  ),

  vote: procedure(z.object({ optionId: idSchema, on: z.boolean() }), ({ optionId, on }, ctx) => {
    const { poll } = optionOf(ctx.db, optionId);
    requireMember(ctx.db, ctx.userId, poll.classId);
    if (poll.closedAt) throw new AppError('A time has already been picked for this.');
    if (on) ctx.db.insert(timePollVotes).values({ optionId, userId: ctx.userId }).onConflictDoNothing().run();
    else ctx.db.delete(timePollVotes).where(and(eq(timePollVotes.optionId, optionId), eq(timePollVotes.userId, ctx.userId))).run();
  }),

  // The host made the session at the time they picked: the poll is over, and voters are told.
  decide: procedure(z.object({ optionId: idSchema, sessionId: idSchema }), ({ optionId, sessionId }, ctx) => {
    const { poll } = optionOf(ctx.db, optionId);
    if (poll.hostId !== ctx.userId) throw new AppError('Only the person who asked can pick a time.', 'FORBIDDEN');
    if (poll.closedAt) throw new AppError('A time has already been picked for this.');
    const session = ctx.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).get();
    // Voters have to be able to see what they're told about, so never an invite-only session.
    if (!session || session.classId !== poll.classId || session.hostId !== ctx.userId || session.visibility !== 'class') notFound('study session');
    const optionIds = ctx.db.select({ id: timePollOptions.id }).from(timePollOptions).where(eq(timePollOptions.pollId, poll.id)).all();
    const voters = ctx.db.select({ userId: timePollVotes.userId }).from(timePollVotes).where(inArray(timePollVotes.optionId, optionIds.map((o) => o.id))).all();
    ctx.db.update(timePolls).set({ closedAt: ctx.now() }).where(eq(timePolls.id, poll.id)).run();
    for (const userId of new Set(voters.map((v) => v.userId))) {
      if (userId === ctx.userId) continue;
      notify(ctx.db, userId, {
        type: 'poll-decided',
        title: m('"{{title}}" is on for {{when}}', { title: session.title, when: { date: session.startsAt.getTime() } }),
        body: raw(classLabel(ctx.db, poll.classId) ?? ''),
        link: `/classes/${poll.classId}/sessions`,
      });
    }
  }),

  remove: procedure(z.object({ pollId: idSchema }), ({ pollId }, ctx) => {
    const poll = pollOf(ctx.db, pollId);
    if (poll.hostId !== ctx.userId) throw new AppError('Only the person who asked can remove this.', 'FORBIDDEN');
    ctx.db.delete(timePolls).where(eq(timePolls.id, pollId)).run();
  }),
};
