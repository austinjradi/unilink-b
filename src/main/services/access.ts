import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { classes, courses, enrollments, users } from '../db/schema';
import { AppError } from '../rpc/core';

export function isMember(db: DB, userId: number, classId: number): boolean {
  return !!db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.classId, classId)))
    .get();
}

export function requireMember(db: DB, userId: number, classId: number) {
  if (!isMember(db, userId, classId)) throw new AppError('Join this class first.', 'FORBIDDEN');
}

// Version B's classes are sections, labelled "COMP 251-001".
export const sectionCode = sql<string>`${courses.subject} || ' ' || ${courses.number} || '-' || ${classes.section}`;

export function classLabel(db: DB, classId: number | null): string | null {
  if (classId == null) return null;
  const row = db
    .select({ code: sectionCode })
    .from(classes)
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(eq(classes.id, classId))
    .get();
  return row?.code ?? null;
}

// Labels for every class, for services that show many at once.
export function classLabels(db: DB) {
  return new Map(
    db
      .select({ id: classes.id, code: sectionCode })
      .from(classes)
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .all()
      .map((c) => [c.id, c.code]),
  );
}

export function notFound(what: string): never {
  throw new AppError(`That ${what} no longer exists.`, 'NOT_FOUND');
}

// G4 in version B: a deleted account's posts, replies and shared section info are kept,
// credited to this placeholder account. It has no usable password and is never enrolled.
export const FORMER_STUDENT_EMAIL = 'former.student@unilink.invalid';

export function formerStudentId(db: DB): number {
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, FORMER_STUDENT_EMAIL)).get();
  if (existing) return existing.id;
  return db
    .insert(users)
    .values({ email: FORMER_STUDENT_EMAIL, name: 'Former student', passwordHash: 'disabled' })
    .returning({ id: users.id })
    .get().id;
}
