import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { GoatConfig } from '@shared/goat';
import type { Message } from '@shared/i18n';
import type { NotificationPrefs } from '@shared/notifications';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () => timestamp('created_at').notNull().$defaultFn(() => new Date());
const userRef = (name = 'user_id') =>
  integer(name)
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
const classRef = () =>
  integer('class_id')
    .notNull()
    .references(() => classes.id, { onDelete: 'cascade' });

// --- G4 Accounts ------------------------------------------------------------

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  // A2: the program the student is working towards (an id from db/programs.ts).
  degreeProgramId: text('degree_program_id'),
  // G3: per-type channel choices; missing types use the defaults in shared/notifications.ts.
  notificationPrefs: text('notification_prefs', { mode: 'json' }).$type<NotificationPrefs>(),
  // The student's goat avatar; null until customized (see shared/goat.ts).
  avatar: text('avatar', { mode: 'json' }).$type<GoatConfig>(),
  // Version B profile: shown to classmates once you post or reply (S1).
  pronouns: text('pronouns').notNull().default(''),
  faculty: text('faculty').notNull().default(''),
  gradYear: integer('grad_year'),
  // G4: the one-time recovery code shown at sign-up (and after each reset) replaces emailed reset codes.
  recoveryCodeHash: text('recovery_code_hash'),
  // ST2: free study minutes for each weekday, Sunday first; null uses DEFAULT_WEEKLY_MINUTES.
  weeklyStudyMinutes: text('weekly_study_minutes', { mode: 'json' }).$type<number[]>(),
  // Language for the UI, notifications and emails.
  locale: text('locale', { enum: ['en', 'fr'] }).notNull().default('en'),
  createdAt: createdAt(),
});

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: userRef(),
  createdAt: createdAt(),
});

// Small key/value store for device-local state (e.g. the remembered session).
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// --- S1 Classes (G2 course catalogue) ----------------------------------------

export const courses = sqliteTable(
  'courses',
  {
    id: id(),
    subject: text('subject').notNull(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    credits: real('credits').notNull(),
  },
  (t) => [uniqueIndex('courses_code_idx').on(t.subject, t.number)],
);

// One class per course section per term: "COMP 251-001 · Fall 2026". Each section
// has its own members, board, chats, sessions and shared course info.
export const classes = sqliteTable(
  'classes',
  {
    id: id(),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    section: text('section').notNull().default('001'),
  },
  (t) => [uniqueIndex('classes_course_term_section_idx').on(t.courseId, t.term, t.section)],
);

export const enrollments = sqliteTable(
  'enrollments',
  {
    userId: userRef(),
    classId: classRef(),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.classId] }), index('enrollments_class_idx').on(t.classId)],
);

// --- S2 Group chat links -------------------------------------------------------

export const chatLinks = sqliteTable(
  'chat_links',
  {
    id: id(),
    classId: classRef(),
    ownerId: userRef('owner_id'),
    url: text('url').notNull(),
    platform: text('platform').notNull(),
    label: text('label').notNull().default(''),
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
    // What the chat is for: the whole course, this section, a project team, a study group…
    purpose: text('purpose').notNull().default('course'),
    // The chat's identity (platform + invite code), compared across every section of the course.
    chatKey: text('chat_key').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [uniqueIndex('chat_links_class_url_idx').on(t.classId, t.url)],
);

// S2.4 in version B: classmates vouch for a link ("works") or report it.
export const chatLinkVotes = sqliteTable(
  'chat_link_votes',
  {
    linkId: integer('link_id')
      .notNull()
      .references(() => chatLinks.id, { onDelete: 'cascade' }),
    userId: userRef(),
    vote: text('vote', { enum: ['works', 'report'] }).notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.userId] })],
);

// --- S3 Study sessions ---------------------------------------------------------

export const studySessions = sqliteTable(
  'study_sessions',
  {
    id: id(),
    classId: classRef(),
    hostId: userRef('host_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    capacity: integer('capacity'),
    // What it's for, shown as a tag: "Assignment", "Midterm", …
    tag: text('tag'),
    // Version B: open to the whole section, or only to people who have the invite code.
    visibility: text('visibility', { enum: ['class', 'invite'] }).notNull().default('class'),
    format: text('format', { enum: ['in-person', 'online'] }).notNull().default('in-person'),
    meetingUrl: text('meeting_url').notNull().default(''),
    inviteCode: text('invite_code').notNull().default(''),
    cancelledAt: timestamp('cancelled_at'),
    createdAt: createdAt(),
  },
  (t) => [index('study_sessions_class_idx').on(t.classId, t.startsAt)],
);

export const studySessionMembers = sqliteTable(
  'study_session_members',
  {
    sessionId: integer('session_id')
      .notNull()
      .references(() => studySessions.id, { onDelete: 'cascade' }),
    userId: userRef(),
    // Version B has no invited state: you join with the code, or wait for a spot.
    status: text('status', { enum: ['invited', 'going', 'waitlisted'] }).notNull(),
    invitedById: integer('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

// --- S4 Discussion board -------------------------------------------------------

export const posts = sqliteTable(
  'posts',
  {
    id: id(),
    classId: classRef(),
    authorId: userRef('author_id'),
    topic: text('topic').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    visibility: text('visibility', { enum: ['class', 'selected'] }).notNull(),
    // Version B: questions can be resolved with an accepted answer; notes can't.
    kind: text('kind', { enum: ['question', 'note'] }).notNull().default('question'),
    acceptedReplyId: integer('accepted_reply_id'),
    // Deleting a post that has replies keeps the thread and blanks the post.
    deletedAt: timestamp('deleted_at'),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at'),
  },
  (t) => [index('posts_class_idx').on(t.classId, t.createdAt)],
);

export const postAudience = sqliteTable(
  'post_audience',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: userRef(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const replies = sqliteTable(
  'replies',
  {
    id: id(),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: userRef('author_id'),
    // Set when replying to another reply (one level of threading).
    parentId: integer('parent_id').references((): AnySQLiteColumn => replies.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('replies_post_idx').on(t.postId)],
);

// --- A3 Dates and deadlines ----------------------------------------------------

export const classMeetings = sqliteTable('class_meetings', {
  id: id(),
  userId: userRef(),
  classId: classRef(),
  weekday: integer('weekday').notNull(), // 0 = Sunday … 6 = Saturday
  startTime: text('start_time').notNull(), // "HH:mm"
  endTime: text('end_time').notNull(),
  location: text('location').notNull().default(''),
});

export const deadlines = sqliteTable(
  'deadlines',
  {
    id: id(),
    userId: userRef(),
    classId: integer('class_id').references(() => classes.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['assignment', 'exam', 'quiz', 'other'] }).notNull(),
    title: text('title').notNull(),
    dueAt: timestamp('due_at').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('deadlines_user_due_idx').on(t.userId, t.dueAt)],
);

// Version B: class deadlines are shared with the section, so each student checks them off separately.
export const deadlineDone = sqliteTable(
  'deadline_done',
  {
    deadlineId: integer('deadline_id')
      .notNull()
      .references(() => deadlines.id, { onDelete: 'cascade' }),
    userId: userRef(),
    doneAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.deadlineId, t.userId] })],
);

// --- A5 Course info and grading scheme (A4 reads these) -----------------------------

export const courseInfo = sqliteTable(
  'course_info',
  {
    userId: userRef(),
    classId: classRef(),
    // Private notes; the shared details are in class_details.
    notes: text('notes').notNull().default(''),
    targetGrade: text('target_grade').notNull().default('A'),
    // ST1: whether this class's meetings switch study mode on.
    studyModeAuto: integer('study_mode_auto', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.classId] })],
);

export const assessments = sqliteTable(
  'assessments',
  {
    id: id(),
    userId: userRef(),
    classId: classRef(),
    name: text('name').notNull(),
    weight: real('weight').notNull(), // % of the final grade
    dueAt: timestamp('due_at'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('assessments_user_class_idx').on(t.userId, t.classId)],
);

// Version B: course details are shared by the section and anyone in it can edit them.
export const classDetails = sqliteTable('class_details', {
  classId: integer('class_id')
    .primaryKey()
    .references(() => classes.id, { onDelete: 'cascade' }),
  professor: text('professor').notNull().default(''),
  professorEmail: text('professor_email').notNull().default(''),
  officeHours: text('office_hours').notNull().default(''),
  location: text('location').notNull().default(''),
  updatedById: integer('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at'),
});

// The grading scheme in `assessments` is shared by the section; each student's marks live here.
export const assessmentScores = sqliteTable(
  'assessment_scores',
  {
    assessmentId: integer('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    userId: userRef(),
    score: real('score').notNull(),
  },
  (t) => [primaryKey({ columns: [t.assessmentId, t.userId] })],
);

// --- ST2 Assignment planner ----------------------------------------------------

export const plannerAssignments = sqliteTable('planner_assignments', {
  id: id(),
  userId: userRef(),
  classId: integer('class_id').references(() => classes.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  dueAt: timestamp('due_at').notNull(),
  notes: text('notes').notNull().default(''),
  bufferDays: integer('buffer_days').notNull().default(1),
  attachmentName: text('attachment_name'),
  attachmentPath: text('attachment_path'),
  createdAt: createdAt(),
});

export const plannerTasks = sqliteTable(
  'planner_tasks',
  {
    id: id(),
    assignmentId: integer('assignment_id')
      .notNull()
      .references(() => plannerAssignments.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    minutes: integer('minutes').notNull(),
    position: integer('position').notNull(),
    scheduledFor: text('scheduled_for').notNull(), // "YYYY-MM-DD"
    // Set when the student moves a task by hand, so automatic replans leave it alone.
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    doneAt: timestamp('done_at'),
  },
  (t) => [index('planner_tasks_assignment_idx').on(t.assignmentId)],
);

// --- A1 Course, credit and grade record (A2 checks it against a program) -------------

export const courseRecords = sqliteTable(
  'course_records',
  {
    id: id(),
    userId: userRef(),
    code: text('code').notNull(), // "COMP 251"
    title: text('title').notNull().default(''),
    credits: real('credits').notNull(),
    term: text('term').notNull(), // "Fall 2026"
    status: text('status', { enum: ['completed', 'in-progress', 'planned'] }).notNull(),
    grade: text('grade'), // McGill letter grade or P/S/U/W/J, once completed
    createdAt: createdAt(),
  },
  (t) => [index('course_records_user_idx').on(t.userId)],
);

// --- ST3 To-do list ------------------------------------------------------------------

export const todos = sqliteTable(
  'todos',
  {
    id: id(),
    userId: userRef(),
    title: text('title').notNull(),
    dueDate: text('due_date'), // "YYYY-MM-DD", or null for "anytime"
    classId: integer('class_id').references(() => classes.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at'),
    createdAt: createdAt(),
  },
  (t) => [index('todos_user_idx').on(t.userId)],
);

// --- G3 Notifications ----------------------------------------------------------------

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: userRef(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'), // app route to open, e.g. "/classes/3/sessions"
    // Title and body as translatable messages; `title`/`body` hold the English text.
    i18n: text('i18n', { mode: 'json' }).$type<{ title: Message; body: Message | null }>(),
    // Reminders carry a key so the same reminder is never created twice.
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    readAt: timestamp('read_at'),
    // Shown as a desktop notification (or deliberately skipped).
    deliveredAt: timestamp('delivered_at'),
  },
  (t) => [uniqueIndex('notifications_dedupe_idx').on(t.userId, t.dedupeKey), index('notifications_user_idx').on(t.userId, t.createdAt)],
);

// Emails the app would send. There's no mail server yet, so they wait here (see README).
export const outbox = sqliteTable('outbox', {
  id: id(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

// --- ST1 Study mode --------------------------------------------------------------------

export const studyModeSettings = sqliteTable('study_mode_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  autoForClasses: integer('auto_for_classes', { mode: 'boolean' }).notNull().default(true),
  autoForSessions: integer('auto_for_sessions', { mode: 'boolean' }).notNull().default(true),
  silenceNotifications: integer('silence_notifications', { mode: 'boolean' }).notNull().default(true),
  systemDnd: integer('system_dnd', { mode: 'boolean' }).notNull().default(false),
  // A focus session started by hand.
  manualUntil: timestamp('manual_until'),
  // Study mode was switched off by hand during an automatic window; stay off until then.
  pausedUntil: timestamp('paused_until'),
});

// --- 🐐 reactions on discussion posts and replies (UI design, A2Team.pdf) --------------

export const postReactions = sqliteTable(
  'post_reactions',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: userRef(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const replyReactions = sqliteTable(
  'reply_reactions',
  {
    replyId: integer('reply_id')
      .notNull()
      .references(() => replies.id, { onDelete: 'cascade' }),
    userId: userRef(),
  },
  (t) => [primaryKey({ columns: [t.replyId, t.userId] })],
);
