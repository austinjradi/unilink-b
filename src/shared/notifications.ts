// G3: what the app notifies about, and the default channels for each.
// In-app notifications are always on; desktop and email can be toggled per type.
// `group` is where it's listed in Settings, and `only` hides it from whoever would never get it.

export const NOTIFICATION_TYPES = {
  'session-spot': { group: 'sessions', label: 'A spot opened up in a study session', desktop: true, email: true },
  'session-changed': { group: 'sessions', label: 'Study sessions moved to a new time or place', desktop: true, email: true },
  'session-host': { group: 'sessions', label: "You're now hosting a study session", desktop: true, email: true },
  'session-cancelled': { group: 'sessions', label: 'Study sessions cancelled', desktop: true, email: true },
  'poll-decided': { group: 'sessions', label: 'A time was picked for a study session you answered about', desktop: true, email: false },
  'session-starting': { group: 'sessions', label: 'Study session starting in 30 minutes', desktop: true, email: false },
  reply: { group: 'discussion', label: 'Replies in threads you follow', desktop: true, email: false },
  'answer-accepted': { group: 'discussion', label: 'Your answer was accepted', desktop: true, email: false },
  'link-hidden': { group: 'discussion', label: 'Your group chat link was hidden after reports', desktop: true, email: false },
  moderation: { group: 'discussion', only: 'student', label: 'Something you posted was removed by a professor', desktop: true, email: true },
  'post-reported': { group: 'discussion', only: 'professor', label: 'Posts students report in the sections you teach', desktop: true, email: true },
  'deadline-soon': { group: 'plans', only: 'student', label: 'Deadlines in the next 24 hours, and exams 3 days ahead', desktop: true, email: true },
  'key-date': { group: 'plans', only: 'student', label: "McGill's add/drop and withdrawal deadlines, a week ahead and the day before", desktop: true, email: true },
  'week-ahead': { group: 'plans', only: 'student', label: 'What you have due in the week ahead, once a week', desktop: true, email: false },
  'tasks-today': { group: 'plans', only: 'student', label: "Today's planned tasks", desktop: true, email: false },
  'plan-moved': { group: 'plans', only: 'student', label: 'Plans that moved with a class deadline', desktop: true, email: false },
  'study-mode': { group: 'plans', only: 'student', label: 'Study mode turning on and off', desktop: true, email: false },
  announcement: { group: 'professor', only: 'student', label: 'Announcements from your professor', desktop: true, email: true },
  'assignment-posted': { group: 'professor', only: 'student', label: 'Assignments your professor posts or moves', desktop: true, email: true },
  'scheme-changed': { group: 'professor', only: 'student', label: 'Changes to a grading scheme by your professor', desktop: true, email: false },
  backup: { group: 'account', label: 'A monthly reminder to back up your work', desktop: false, email: false },
  'sign-in-attempts': { group: 'account', label: 'Failed sign-in attempts on your account', desktop: true, email: true },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type ChannelPrefs = { desktop: boolean; email: boolean };
export type NotificationPrefs = Partial<Record<NotificationType, ChannelPrefs>>;

export function channelsFor(prefs: NotificationPrefs | null | undefined, type: NotificationType): ChannelPrefs {
  const defaults = NOTIFICATION_TYPES[type];
  return prefs?.[type] ?? { desktop: defaults.desktop, email: defaults.email };
}
