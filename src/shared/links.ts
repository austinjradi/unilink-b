// S2: group chat link validation, normalization and platform detection.

const PLATFORMS: [name: string, matches: (host: string) => boolean][] = [
  ['WhatsApp', (h) => h === 'chat.whatsapp.com' || h.endsWith('.whatsapp.com') || h === 'wa.me'],
  ['Discord', (h) => h === 'discord.gg' || h === 'discord.com' || h.endsWith('.discord.com')],
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
}

export function parseChatLink(input: string): ChatLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') || url.username || url.password) return null;

  // Normalize so the same chat can't be added twice under trivially different URLs.
  url.protocol = 'https:';
  url.hash = '';
  const normalized = url.toString().replace(/\/+$/, '').replace(/\/+\?/, '?');

  const host = url.hostname.replace(/^www\./, '');
  const platform = PLATFORMS.find(([, matches]) => matches(host))?.[0] ?? 'Other';
  return { url: normalized, platform };
}
