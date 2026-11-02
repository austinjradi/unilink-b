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

export function isProfessor(db: DB, userId: number): boolean {
  return db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get()?.role === 'professor';
}

// A professor teaches a section by joining it, so they're enrolled like anyone else.
export function teaches(db: DB, userId: number, classId: number): boolean {
  return isMember(db, userId, classId) && isProfessor(db, userId);
}

export function requireTeacher(db: DB, userId: number, classId: number) {
  if (!teaches(db, userId, classId)) throw new AppError("Only the section's professor can do this.", 'FORBIDDEN');
}

function membersWithRole(db: DB, classId: number, role: 'student' | 'professor') {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(eq(enrollments.classId, classId), eq(users.role, role)))
    .all();
}

export const professorsOf = (db: DB, classId: number) => membersWithRole(db, classId, 'professor');
export const studentsOf = (db: DB, classId: number) => membersWithRole(db, classId, 'student');

// What's shared with a section (scheme, details, class times) is wiki-style until a
// professor teaches it; from then on it's theirs to change.
export function canEditShared(db: DB, userId: number, classId: number): boolean {
  return isMember(db, userId, classId) && (isProfessor(db, userId) || !professorsOf(db, classId).length);
}

export function requireSharedEditor(db: DB, userId: number, classId: number) {
  requireMember(db, userId, classId);
  if (!canEditShared(db, userId, classId)) throw new AppError("This section's professor manages this.", 'FORBIDDEN');
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
