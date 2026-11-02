import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { DB } from '../db/client';
import {
  assessments,
  assessmentScores,
  boardImages,
  chatLinks,
  courseInfo,
  courseRecords,
  deadlines,
  enrollments,
  plannerAssignments,
  plannerTasks,
  posts,
  replies,
  studyModeSettings,
  studySessionMembers,
  studySessions,
  todos,
  users,
} from '../db/schema';
import { classLabels } from './access';

// G4: everything UniLink keeps about a student, for Settings → Privacy → Download my data
// (next to deleting it all). Password hashes, recovery codes and sign-in tokens are left out.
export function collectMyData(db: DB, userId: number) {
  const label = classLabels(db);
  const cls = (id: number | null) => (id == null ? null : (label.get(id) ?? null));
  const tasks = db
    .select({ assignmentId: plannerTasks.assignmentId, title: plannerTasks.title, minutes: plannerTasks.minutes, day: plannerTasks.scheduledFor, doneAt: plannerTasks.doneAt })
    .from(plannerTasks)
    .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
    .where(eq(plannerAssignments.userId, userId))
    .orderBy(asc(plannerTasks.position))
    .all();

  return {
    exportedAt: new Date().toISOString(),
    profile: db
      .select({
        name: users.name,
        email: users.email,
        pronouns: users.pronouns,
        faculty: users.faculty,
        gradYear: users.gradYear,
        locale: users.locale,
        degreeProgram: users.degreeProgramId,
        goat: users.avatar,
        weeklyStudyMinutes: users.weeklyStudyMinutes,
        notificationPrefs: users.notificationPrefs,
        joinedUniLink: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .get(),
    classes: db
      .select({ classId: enrollments.classId, joinedAt: enrollments.joinedAt })
      .from(enrollments)
      .where(eq(enrollments.userId, userId))
      .all()
      .map((e) => ({ class: cls(e.classId), joinedAt: e.joinedAt })),
    courseRecord: db
      .select({ code: courseRecords.code, title: courseRecords.title, credits: courseRecords.credits, term: courseRecords.term, status: courseRecords.status, grade: courseRecords.grade })
      .from(courseRecords)
      .where(eq(courseRecords.userId, userId))
      .all(),
    marks: db
      .select({ classId: assessments.classId, assessment: assessments.name, weight: assessments.weight, score: assessmentScores.score })
      .from(assessmentScores)
      .innerJoin(assessments, eq(assessmentScores.assessmentId, assessments.id))
      .where(eq(assessmentScores.userId, userId))
      .all()
      .map(({ classId, ...m }) => ({ class: cls(classId), ...m })),
    courseNotes: db
      .select({ classId: courseInfo.classId, notes: courseInfo.notes, targetGrade: courseInfo.targetGrade })
      .from(courseInfo)
      .where(eq(courseInfo.userId, userId))
      .all()
      .map(({ classId, ...n }) => ({ class: cls(classId), ...n })),
    deadlinesYouAdded: db
      .select({ classId: deadlines.classId, kind: deadlines.kind, title: deadlines.title, dueAt: deadlines.dueAt, notes: deadlines.notes })
      .from(deadlines)
      .where(eq(deadlines.userId, userId))
      .all()
      .map(({ classId, ...d }) => ({ class: cls(classId), ...d })),
    todos: db
      .select({ classId: todos.classId, title: todos.title, dueDate: todos.dueDate, doneAt: todos.doneAt })
      .from(todos)
      .where(eq(todos.userId, userId))
      .all()
      .map(({ classId, ...d }) => ({ class: cls(classId), ...d })),
    plans: db
      .select({ id: plannerAssignments.id, classId: plannerAssignments.classId, title: plannerAssignments.title, dueAt: plannerAssignments.dueAt, notes: plannerAssignments.notes, bufferDays: plannerAssignments.bufferDays })
      .from(plannerAssignments)
      .where(eq(plannerAssignments.userId, userId))
      .all()
      .map(({ id, classId, ...a }) => ({
        class: cls(classId),
        ...a,
        tasks: tasks.filter((t) => t.assignmentId === id).map(({ assignmentId: _, ...t }) => t),
      })),
    // Their names; the files themselves stay in UniLink, like planner attachments.
    images: db
      .select({ name: boardImages.name, post: posts.title })
      .from(boardImages)
      .innerJoin(posts, eq(boardImages.postId, posts.id))
      .leftJoin(replies, eq(boardImages.replyId, replies.id))
      .where(or(and(eq(posts.authorId, userId), isNull(boardImages.replyId)), eq(replies.authorId, userId)))
      .all(),
    posts: db
      .select({ classId: posts.classId, kind: posts.kind, topic: posts.topic, title: posts.title, body: posts.body, visibility: posts.visibility, createdAt: posts.createdAt, deletedAt: posts.deletedAt })
      .from(posts)
      .where(eq(posts.authorId, userId))
      .all()
      .map(({ classId, ...p }) => ({ class: cls(classId), ...p })),
    replies: db
      .select({ classId: posts.classId, post: posts.title, body: replies.body, createdAt: replies.createdAt })
      .from(replies)
      .innerJoin(posts, eq(replies.postId, posts.id))
      .where(eq(replies.authorId, userId))
      .all()
      .map(({ classId, ...r }) => ({ class: cls(classId), ...r })),
    groupChatLinks: db
      .select({ classId: chatLinks.classId, platform: chatLinks.platform, url: chatLinks.url, label: chatLinks.label, purpose: chatLinks.purpose, createdAt: chatLinks.createdAt })
      .from(chatLinks)
      .where(eq(chatLinks.ownerId, userId))
      .all()
      .map(({ classId, ...l }) => ({ class: cls(classId), ...l })),
    studySessions: db
      .select({ classId: studySessions.classId, title: studySessions.title, startsAt: studySessions.startsAt, hosting: eq(studySessions.hostId, userId), status: studySessionMembers.status })
      .from(studySessionMembers)
      .innerJoin(studySessions, eq(studySessionMembers.sessionId, studySessions.id))
      .where(eq(studySessionMembers.userId, userId))
      .all()
      .map(({ classId, hosting, ...s }) => ({ class: cls(classId), ...s, hosting: Boolean(hosting) })),
    studyMode: db
      .select({
        autoForClasses: studyModeSettings.autoForClasses,
        autoForSessions: studyModeSettings.autoForSessions,
        silenceNotifications: studyModeSettings.silenceNotifications,
      })
      .from(studyModeSettings)
      .where(eq(studyModeSettings.userId, userId))
      .get() ?? null,
  };
}
