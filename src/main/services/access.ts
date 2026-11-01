import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { classes, courses, enrollments } from '../db/schema';
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

export function classLabel(db: DB, classId: number | null): string | null {
  if (classId == null) return null;
  const row = db
    .select({ subject: courses.subject, number: courses.number })
    .from(classes)
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(eq(classes.id, classId))
    .get();
  return row ? `${row.subject} ${row.number}` : null;
}

export function notFound(what: string): never {
  throw new AppError(`That ${what} no longer exists.`, 'NOT_FOUND');
}
