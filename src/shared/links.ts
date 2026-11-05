// S2: group chat link validation, normalization and platform detection.

// Labelled tuple types: each item is [name, matches].
// The labels only document what each position holds.
const PLATFORMS: [name: string, matches: (host: string) => boolean][] = [
  ['WhatsApp', (h) => h === 'chat.whatsapp.com' || h.endsWith('.whatsapp.com') || h === 'wa.me'],
  ['Discord', (h) => h === 'discord.gg' || h === 'discord.com' || h.endsWith('.discord.com') || h === 'discordapp.com'],
  ['Messenger', (h) => h === 'm.me' || h.endsWith('messenger.com')],
  ['Telegram', (h) => h === 't.me' || h === 'telegram.me'],
  ['Slack', (h) => h.endsWith('slack.com')],
  ['Teams', (h) => h === 'teams.microsoft.com' || h === 'teams.live.com'],
  ['GroupMe', (h) => h.endsWith('groupme.com')],
  ['Signal', (h) => h === 'signal.group'],
  ['Facebook', (h) => h.endsWith('facebook.com')],
];

export const CHAT_PLATFORMS = [...PLATFORMS.map(([name]) => name), 'Other'];

export interface ChatLink {
  url: string;
  platform: string;
  // Version B: the chat itself, so the same group is recognized under any of its URLs
  // ("discord.gg/abc" and "discord.com/invite/abc", with or without tracking parameters).
  chatKey: string;
}

// Invite codes for platforms whose links carry one; the rest compare by full URL.
function inviteCode(host: string, path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (host === 'discord.gg') return parts[0] ?? null;
  if (host === 'discord.com' || host === 'discordapp.com') return parts[0] === 'invite' ? (parts[1] ?? null) : null;
  if (host === 'chat.whatsapp.com') return parts[0] ?? null;
  if (host === 't.me' || host === 'telegram.me') {
    if (parts[0] === 'joinchat') return parts[1] ?? null;
    return parts[0]?.replace(/^\+/, '') ?? null;
  }
  return null;
}

// Returns null for anything that isn't a usable web link, so callers check
// for null instead of catching errors. The form and the service both call it.
export function parseChatLink(input: string): ChatLink | null {
  let url: URL;
  try {
    // The URL constructor throws on text that isn't a URL, hence the try.
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') || url.username || url.password) return null;

  url.protocol = 'https:';
  url.hash = '';
  const host = url.hostname.replace(/^www\./, '');
  // `([, matches])` destructures each tuple, skipping its first item. find() gives the
  // matching tuple or undefined; `?.[0]` takes its name, and `??` falls back to 'Other'.
  const platform = PLATFORMS.find(([, matches]) => matches(host))?.[0] ?? 'Other';
  const code = inviteCode(host, url.pathname);
  // Invite links don't need their query string (it's tracking), so it's dropped.
  if (code) url.search = '';
  // Removes trailing slashes, and a slash just before
  // the query string, so equivalent links compare equal.
  const normalized = url.toString().replace(/\/+$/, '').replace(/\/+\?/, '?');
  const chatKey = code ? `${platform.toLowerCase()}:${code}` : `url:${normalized.replace(/^https:\/\/(www\.)?/, '')}`;
  return { url: normalized, platform, chatKey };
}

// What a chat is for, shown as a tag on the link (labels are translated in the renderer).
export const LINK_PURPOSES = {
  course: 'Whole course',
  section: 'This section',
  project: 'Project team',
  'study-group': 'Study group',
  other: 'Other',
} as const;

// 'course' | 'section' | 'project' | 'study-group' | 'other',
// derived from the object above, so the two never disagree.
export type LinkPurpose = keyof typeof LINK_PURPOSES;

// A link is hidden once at least this many classmates report it and reports outnumber
// the classmates who say it still works.
export const HIDE_AFTER_REPORTS = 2;

export function isHidden(reports: number, works: number) {
  return reports >= HIDE_AFTER_REPORTS && reports > works;
}
