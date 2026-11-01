import { and, asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { MCGILL_SCALE } from '@shared/grades';
import type { DB } from '../db/client';
import { assessments, classMeetings, courseInfo } from '../db/schema';
import { idSchema, nonEmpty, procedure } from '../rpc/core';
import { notFound, requireMember } from './access';

// A5: personal course details, class times (feeds A3) and the grading scheme
// with per-assessment grades (feeds the A4 calculator).

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const infoFields = {
  professor: z.string().trim().max(120),
  professorEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  officeHours: z.string().trim().max(300),
  location: z.string().trim().max(200),
  notes: z.string().trim().max(5000),
};

const assessmentFields = {
  name: nonEmpty('Name', 100),
  weight: z.number().gt(0, 'Weight must be above 0%').max(100, 'Weight can be at most 100%'),
  score: z.number().min(0).max(150).nullable(),
  dueAt: z.date().nullable(),
};

function ownAssessment(db: DB, userId: number, id: number) {
  const row = db
    .select()
    .from(assessments)
    .where(and(eq(assessments.id, id), eq(assessments.userId, userId)))
    .get();
  return row ?? notFound('assessment');
}

const mine = (userId: number, classId: number) =>
  ({ userId, classId }) as const;

export const coursesRouter = {
  info: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const info = ctx.db
      .select()
      .from(courseInfo)
      .where(and(eq(courseInfo.userId, ctx.userId), eq(courseInfo.classId, classId)))
      .get();
    const meetings = ctx.db
      .select()
      .from(classMeetings)
      .where(and(eq(classMeetings.userId, ctx.userId), eq(classMeetings.classId, classId)))
      .orderBy(asc(classMeetings.weekday), asc(classMeetings.startTime))
      .all();
    return {
      professor: info?.professor ?? '',
      professorEmail: info?.professorEmail ?? '',
      officeHours: info?.officeHours ?? '',
      location: info?.location ?? '',
      notes: info?.notes ?? '',
      targetGrade: info?.targetGrade ?? 'A',
      meetings,
    };
  }),

  saveInfo: procedure(z.object({ classId: idSchema, ...infoFields }), ({ classId, ...fields }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    ctx.db
      .insert(courseInfo)
      .values({ ...mine(ctx.userId, classId), ...fields })
      .onConflictDoUpdate({ target: [courseInfo.userId, courseInfo.classId], set: fields })
      .run();
  }),

  setTarget: procedure(
    z.object({ classId: idSchema, targetGrade: z.enum(MCGILL_SCALE.map((g) => g.letter) as [string, ...string[]]) }),
    ({ classId, targetGrade }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      ctx.db
        .insert(courseInfo)
        .values({ ...mine(ctx.userId, classId), targetGrade })
        .onConflictDoUpdate({ target: [courseInfo.userId, courseInfo.classId], set: { targetGrade } })
        .run();
    },
  ),

  // A3: weekly class times, replaced as a set.
  saveMeetings: procedure(
    z.object({
      classId: idSchema,
      meetings: z
        .array(
          z
            .object({ weekday: z.number().int().min(0).max(6), startTime: time, endTime: time, location: z.string().trim().max(200) })
            .refine((m) => m.endTime > m.startTime, { message: 'Each class time must end after it starts' }),
        )
        .max(14),
    }),
    ({ classId, meetings }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      ctx.db.transaction((tx) => {
        tx.delete(classMeetings)
          .where(and(eq(classMeetings.userId, ctx.userId), eq(classMeetings.classId, classId)))
          .run();
        if (meetings.length) {
          tx.insert(classMeetings)
            .values(meetings.map((m) => ({ ...m, ...mine(ctx.userId, classId) })))
            .run();
        }
      });
    },
  ),

  assessments: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    return ctx.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.userId, ctx.userId), eq(assessments.classId, classId)))
      .orderBy(asc(assessments.position), asc(assessments.id))
      .all();
  }),

  addAssessment: procedure(z.object({ classId: idSchema, ...assessmentFields }), ({ classId, ...fields }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const last = ctx.db
      .select({ position: max(assessments.position) })
      .from(assessments)
      .where(and(eq(assessments.userId, ctx.userId), eq(assessments.classId, classId)))
      .get();
    ctx.db
      .insert(assessments)
      .values({ ...fields, ...mine(ctx.userId, classId), position: (last?.position ?? -1) + 1 })
      .run();
  }),

  updateAssessment: procedure(z.object({ id: idSchema, ...assessmentFields }), ({ id, ...fields }, ctx) => {
    ownAssessment(ctx.db, ctx.userId, id);
    ctx.db.update(assessments).set(fields).where(eq(assessments.id, id)).run();
  }),

  removeAssessment: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    ownAssessment(ctx.db, ctx.userId, id);
    ctx.db.delete(assessments).where(eq(assessments.id, id)).run();
  }),
};
