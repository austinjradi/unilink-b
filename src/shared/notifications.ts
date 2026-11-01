// G3: what the app notifies about, and the default channels for each.
// In-app notifications are always on; desktop and email can be toggled per type.

export const NOTIFICATION_TYPES = {
  'session-invite': { label: 'Study session invitations', desktop: true, email: true },
  'session-cancelled': { label: 'Study sessions cancelled', desktop: true, email: true },
  'session-starting': { label: 'Study session starting in 30 minutes', desktop: true, email: false },
  reply: { label: 'Replies to your posts', desktop: true, email: false },
  'link-flagged': { label: 'Reports on your group chat links', desktop: false, email: false },
  'deadline-soon': { label: 'Deadlines in the next 24 hours', desktop: true, email: true },
  'tasks-today': { label: "Today's planned tasks", desktop: true, email: false },
  'study-mode': { label: 'Study mode turning on and off', desktop: true, email: false },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type ChannelPrefs = { desktop: boolean; email: boolean };
export type NotificationPrefs = Partial<Record<NotificationType, ChannelPrefs>>;

export function channelsFor(prefs: NotificationPrefs | null | undefined, type: NotificationType): ChannelPrefs {
  const defaults = NOTIFICATION_TYPES[type];
  return prefs?.[type] ?? { desktop: defaults.desktop, email: defaults.email };
}
