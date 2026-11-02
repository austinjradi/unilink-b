import { and, asc, eq, isNotNull, isNull, max, ne, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { MCGILL_SCALE } from '@shared/grades';
import type { DB } from '../db/client';
import { assessments, assessmentScores, classDetails, classMeetings, courseInfo, users } from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { FORMER_STUDENT_EMAIL, notFound, requireMember } from './access';

// A5 in version B: everything that's the same for the whole section is entered once and
// shared, wiki-style: any member can edit the course details, the weekly class times (A3)
// and the grading scheme, and the page says who changed them last. Your marks, your
// target grade and your notes stay private.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const detailFields = {
  professor: z.string().trim().max(120),
  professorEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  officeHours: z.string().trim().max(300),
  location: z.string().trim().max(200),
};

const assessmentFields = {
  name: nonEmpty('Name', 100),
  weight: z.number().gt(0, 'Weight must be above 0%').max(100, 'Weight can be at most 100%'),
  // Only used when the section has a second scheme; 0 if the component doesn't count there.
  altWeight: z.number().min(0).max(100, 'Weight can be at most 100%').nullable().default(null),
  dueAt: z.date().nullable(),
};

function sharedAssessment(db: DB, userId: number, id: number) {
  const row = db.select().from(assessments).where(eq(assessments.id, id)).get() ?? notFound('assessment');
  requireMember(db, userId, row.classId);
  return row;
}

// Who last changed shared info; `former` when their account has since been deleted.
const editorOf = (db: DB, userId: number | null) => {
  if (userId == null) return null;
  const user = db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).get();
  return !user || user.email === FORMER_STUDENT_EMAIL ? { name: '', former: true } : { name: user.name, former: false };
};

// The scheme can't promise more than the whole course.
function assertWeightFits(db: DB, classId: number, weight: number, altWeight: number | null, exceptId?: number) {
  const others = db
    .select({ total: sum(assessments.weight), alt: sum(assessments.altWeight) })
    .from(assessments)
    .where(and(eq(assessments.classId, classId), exceptId ? ne(assessments.id, exceptId) : undefined))
    .get();
  const total = Number(others?.total ?? 0) + weight;
  const altTotal = Number(others?.alt ?? 0) + (altWeight ?? 0);
  for (const t of [total, altTotal]) {
    if (t > 100.001) {
      throw new AppError('The grading scheme would add up to {{total}}%. It can be at most 100%.', 'BAD_INPUT', {
        total: Math.round(t * 10) / 10,
      });
    }
  }
}

// Whether the section's scheme has a second version ("whichever is higher").
function hasAltScheme(db: DB, classId: number) {
  return !!db
    .select({ id: assessments.id })
    .from(assessments)
    .where(and(eq(assessments.classId, classId), isNotNull(assessments.altWeight)))
    .get();
}

// A new or changed component gets a second-scheme weight only when the section has one
// (the same as its main weight unless given).
function withAltWeight<T extends { weight: number; altWeight: number | null }>(db: DB, classId: number, fields: T): T {
  return { ...fields, altWeight: hasAltScheme(db, classId) ? (fields.altWeight ?? fields.weight) : null };
}

// The section's grading scheme with this student's marks, for A4 and A1.
export function gradedItems(db: DB, userId: number, classId: number) {
  return db
    .select({
      id: assessments.id,
      classId: assessments.classId,
      name: assessments.name,
      weight: assessments.weight,
      altWeight: assessments.altWeight,
      dueAt: assessments.dueAt,
      position: assessments.position,
      addedById: assessments.userId,
      score: assessmentScores.score,
    })
    .from(assessments)
    .leftJoin(assessmentScores, and(eq(assessmentScores.assessmentId, assessments.id), eq(assessmentScores.userId, userId)))
    .where(eq(assessments.classId, classId))
    .orderBy(asc(assessments.position), asc(assessments.id))
    .all();
}

export const coursesRouter = {
  info: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const shared = ctx.db.select().from(classDetails).where(eq(classDetails.classId, classId)).get();
    const own = ctx.db
      .select()
      .from(courseInfo)
      .where(and(eq(courseInfo.userId, ctx.userId), eq(courseInfo.classId, classId)))
      .get();
    const meetings = ctx.db
      .select()
      .from(classMeetings)
      .where(eq(classMeetings.classId, classId))
      .orderBy(asc(classMeetings.weekday), asc(classMeetings.startTime))
      .all();
    return {
      professor: shared?.professor ?? '',
      professorEmail: shared?.professorEmail ?? '',
      officeHours: shared?.officeHours ?? '',
      location: shared?.location ?? '',
      detailsEditedBy: shared?.updatedAt ? editorOf(ctx.db, shared.updatedById) : null,
      detailsEditedAt: shared?.updatedAt ?? null,
      notes: own?.notes ?? '',
      targetGrade: own?.targetGrade ?? 'A',
      meetings,
      meetingsEditedBy: meetings.length ? editorOf(ctx.db, meetings[0].userId) : null,
    };
  }),

  // Shared with the section.
  saveDetails: procedure(z.object({ classId: idSchema, ...detailFields }), ({ classId, ...fields }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const edit = { ...fields, updatedById: ctx.userId, updatedAt: ctx.now() };
    ctx.db
      .insert(classDetails)
      .values({ classId, ...edit })
      .onConflictDoUpdate({ target: classDetails.classId, set: edit })
      .run();
  }),

  // Private.
  saveNotes: procedure(z.object({ classId: idSchema, notes: z.string().trim().max(5000) }), ({ classId, notes }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    ctx.db
      .insert(courseInfo)
      .values({ userId: ctx.userId, classId, notes })
      .onConflictDoUpdate({ target: [courseInfo.userId, courseInfo.classId], set: { notes } })
      .run();
  }),

  setTarget: procedure(
    z.object({ classId: idSchema, targetGrade: z.enum(MCGILL_SCALE.map((g) => g.letter) as [string, ...string[]]) }),
    ({ classId, targetGrade }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      ctx.db
        .insert(courseInfo)
        .values({ userId: ctx.userId, classId, targetGrade })
        .onConflictDoUpdate({ target: [courseInfo.userId, courseInfo.classId], set: { targetGrade } })
        .run();
    },
  ),

  // A3: the section's weekly class times, replaced as a set by whoever edits them.
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
        tx.delete(classMeetings).where(eq(classMeetings.classId, classId)).run();
        if (meetings.length) {
          tx.insert(classMeetings)
            .values(meetings.map((m) => ({ ...m, classId, userId: ctx.userId })))
            .run();
        }
      });
    },
  ),

  assessments: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    return gradedItems(ctx.db, ctx.userId, classId).map((a) => ({ ...a, addedBy: editorOf(ctx.db, a.addedById) }));
  }),

  addAssessment: procedure(z.object({ classId: idSchema, ...assessmentFields }), ({ classId, ...input }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const fields = withAltWeight(ctx.db, classId, input);
    assertWeightFits(ctx.db, classId, fields.weight, fields.altWeight);
    const last = ctx.db
      .select({ position: max(assessments.position) })
      .from(assessments)
      .where(eq(assessments.classId, classId))
      .get();
    ctx.db
      .insert(assessments)
      .values({ ...fields, classId, userId: ctx.userId, position: (last?.position ?? -1) + 1 })
      .run();
  }),

  // Anyone in the section can fix a name, weight or date.
  updateAssessment: procedure(z.object({ id: idSchema, ...assessmentFields }), ({ id, ...input }, ctx) => {
    const row = sharedAssessment(ctx.db, ctx.userId, id);
    const fields = withAltWeight(ctx.db, row.classId, input);
    assertWeightFits(ctx.db, row.classId, fields.weight, fields.altWeight, id);
    ctx.db.update(assessments).set(fields).where(eq(assessments.id, id)).run();
  }),

  // A second grading scheme for the section, "whichever is higher" (e.g. the final replacing
  // the midterm). It starts as a copy of the main weights; turning it off drops it.
  setSecondScheme: procedure(z.object({ classId: idSchema, on: z.boolean() }), ({ classId, on }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    ctx.db
      .update(assessments)
      .set({ altWeight: on ? sql`${assessments.weight}` : null })
      .where(and(eq(assessments.classId, classId), on ? isNull(assessments.altWeight) : undefined))
      .run();
  }),

  // Your mark on a component, or null to clear it.
  setScore: procedure(z.object({ id: idSchema, score: z.number().min(0).max(150).nullable() }), ({ id, score }, ctx) => {
    sharedAssessment(ctx.db, ctx.userId, id);
    const key = and(eq(assessmentScores.assessmentId, id), eq(assessmentScores.userId, ctx.userId));
    if (score == null) ctx.db.delete(assessmentScores).where(key).run();
    else
      ctx.db
        .insert(assessmentScores)
        .values({ assessmentId: id, userId: ctx.userId, score })
        .onConflictDoUpdate({ target: [assessmentScores.assessmentId, assessmentScores.userId], set: { score } })
        .run();
  }),

  // Removing a component would erase classmates' marks, so it's only allowed until someone else has one.
  removeAssessment: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    sharedAssessment(ctx.db, ctx.userId, id);
    const othersMarked = ctx.db
      .select({ userId: assessmentScores.userId })
      .from(assessmentScores)
      .where(and(eq(assessmentScores.assessmentId, id), ne(assessmentScores.userId, ctx.userId)))
      .get();
    if (othersMarked) {
      throw new AppError('Classmates have marks on this component, so it stays. You can rename or reweight it instead.', 'CONFLICT');
    }
    ctx.db.delete(assessments).where(eq(assessments.id, id)).run();
  }),
};
