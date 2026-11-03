import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/renderer/src/lib/i18n', () => ({ tx: (key: string) => key }));

const { BOARD, REQ_TOPICS } = await import('../src/renderer/src/lib/reqTopics');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith('.tsx') ? [path] : [];
  });
}

describe('info icons', () => {
  const code = sources('src/renderer/src').map((file) => readFileSync(file, 'utf8')).join('\n');
  const used = new Set([...code.matchAll(/<(?:ReqInfo|WithInfo)\b[^>]*?\bid="([^"]+)"/g), ...code.matchAll(/\binfo(?:=|:\s*)["']([^"']+)["']/g)].map((m) => m[1]));

  it('every topic says what it implements and what else it could be', () => {
    for (const topic of Object.values(REQ_TOPICS)) {
      expect(topic.board.length).toBeGreaterThan(0);
      expect(topic.alternatives.length).toBeGreaterThan(0);
      for (const id of topic.board) expect(BOARD).toHaveProperty([id]);
    }
  });

  it('every icon has a topic, and every topic has an icon', () => {
    const topics = new Set(Object.keys(REQ_TOPICS));
    expect([...used].filter((id) => !topics.has(id))).toEqual([]);
    expect([...topics].filter((id) => !used.has(id))).toEqual([]);
  });
});
