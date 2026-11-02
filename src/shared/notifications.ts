// G3: what the app notifies about, and the default channels for each.
// In-app notifications are always on; desktop and email can be toggled per type.

export const NOTIFICATION_TYPES = {
  'session-spot': { label: 'A spot opened up in a study session', desktop: true, email: true },
  'session-changed': { label: 'Study sessions moved to a new time or place', desktop: true, email: true },
  'session-host': { label: "You're now hosting a study session", desktop: true, email: true },
  'session-cancelled': { label: 'Study sessions cancelled', desktop: true, email: true },
  'poll-decided': { label: 'A time was picked for a study session you answered about', desktop: true, email: false },
  'session-starting': { label: 'Study session starting in 30 minutes', desktop: true, email: false },
  reply: { label: 'Replies in threads you follow', desktop: true, email: false },
  'answer-accepted': { label: 'Your answer was accepted', desktop: true, email: false },
  'link-hidden': { label: 'Your group chat link was hidden after reports', desktop: true, email: false },
  'deadline-soon': { label: 'Deadlines in the next 24 hours, and exams 3 days ahead', desktop: true, email: true },
  'week-ahead': { label: 'What you have due in the week ahead, once a week', desktop: true, email: false },
  'tasks-today': { label: "Today's planned tasks", desktop: true, email: false },
  'plan-moved': { label: 'Plans that moved with a class deadline', desktop: true, email: false },
  'study-mode': { label: 'Study mode turning on and off', desktop: true, email: false },
  'sign-in-attempts': { label: 'Failed sign-in attempts on your account', desktop: true, email: true },
  announcement: { label: 'Announcements from your professor', desktop: true, email: true },
  'assignment-posted': { label: 'Assignments your professor posts or moves', desktop: true, email: true },
  'scheme-changed': { label: 'Changes to a grading scheme by your professor', desktop: true, email: false },
  moderation: { label: 'Something you posted was removed by a professor', desktop: true, email: true },
  'post-reported': { label: 'Posts students report in the sections you teach', desktop: true, email: true },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type ChannelPrefs = { desktop: boolean; email: boolean };
export type NotificationPrefs = Partial<Record<NotificationType, ChannelPrefs>>;

export function channelsFor(prefs: NotificationPrefs | null | undefined, type: NotificationType): ChannelPrefs {
  const defaults = NOTIFICATION_TYPES[type];
  return prefs?.[type] ?? { desktop: defaults.desktop, email: defaults.email };
}
