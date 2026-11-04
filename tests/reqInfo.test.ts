import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_SWITCHABLE, VARIANTS, variantFor } from '@shared/variants';
import { requirementList, topicView } from '../src/renderer/src/lib/reqList';
import { BOARD, REQ_TOPICS } from '../src/renderer/src/lib/reqTopics';

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

describe('requirement switches', () => {
  const alternatives = new Set(Object.values(REQ_TOPICS).flatMap((topic) => topic.alternatives as readonly string[]));
  const everywhere = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? everywhere(path) : /\.tsx?$/.test(name) && !path.endsWith(join('shared', 'variants.ts')) ? [readFileSync(path, 'utf8')] : [];
    });

  it('each one is worded exactly like an alternative in a popup', () => {
    for (const variant of Object.values(VARIANTS) as { alternative: string; sameAs?: string[] }[]) {
      for (const text of [variant.alternative, ...(variant.sameAs ?? [])]) expect(alternatives).toContain(text);
    }
    for (const alternative of Object.keys(NOT_SWITCHABLE)) expect(alternatives).toContain(alternative);
  });

  it('each one is checked somewhere, so no button does nothing', () => {
    const code = everywhere('src').join('\n');
    const unused = Object.keys(VARIANTS).filter((id) => !code.includes(`isOn('${id}')`) && !code.includes(`useVariant('${id}')`));
    expect(unused).toEqual([]);
  });

  // The features done so far. Each one's alternatives all have a button, or say why they don't.
  it.each(['S1', 'S2', 'S3', 'S4', 'A3', 'ST2', 'A4', 'A5', 'A1', 'A2', 'ST1', 'G4', 'G3', 'ST3', 'G2', 'WEB', 'WIRE', 'EXTRA', 'PROF'])('every %s alternative has a button, or says why it has none', (feature) => {
    const topics = Object.values(REQ_TOPICS).filter((topic) => String(topic.board[0]).split('.')[0] === feature);
    const missing = topics.flatMap((topic) => topic.alternatives as readonly string[]).filter((alternative) => !variantFor(alternative) && !NOT_SWITCHABLE[alternative]);
    expect(missing).toEqual([]);
  });
});

describe('requirements page', () => {
  const list = requirementList();
  const topics = list.flatMap((feature) => feature.groups.flatMap((group) => group.topics));
  const topic = topics.find((t) => t.alternatives.length > 1 && t.alternatives.some((a) => a.variant))!;
  const alternative = topic.alternatives.find((a) => a.variant)!;
  const on = [alternative.variant!];

  it('lists every requirement once, under the board item it answers', () => {
    expect(topics.map((t) => t.id).sort()).toEqual(Object.keys(REQ_TOPICS).sort());
    for (const feature of list) {
      for (const group of feature.groups) {
        expect(String(group.board).split('.')[0]).toBe(feature.id);
        for (const t of group.topics) expect(t.board[0]).toBe(group.board);
      }
    }
  });

  it('gives every alternative a switch or says why there is none', () => {
    for (const a of topics.flatMap((t) => t.alternatives)) expect(a.variant ?? a.reason).toBeTruthy();
  });

  it('moves an alternative from not active to implemented when it is switched on', () => {
    const off = topicView(topic, [], 'all', '')!;
    expect(off.active).toEqual([]);
    expect(off.inactive).toContain(alternative);
    const flipped = topicView(topic, on, 'all', '')!;
    expect(flipped.active).toEqual([alternative]);
    expect(flipped.inactive).not.toContain(alternative);
  });

  it('filters by what is in use', () => {
    expect(topicView(topic, [], 'implemented', '')).toMatchObject({ built: true, active: [], inactive: [] });
    expect(topicView(topic, [], 'inactive', '')?.built).toBe(false);
    expect(topicView(topic, [], 'on', '')).toBeNull();
    expect(topicView(topic, on, 'on', '')).toMatchObject({ built: true, active: [alternative], inactive: [] });
    const allOn = topic.alternatives.flatMap((a) => (a.variant ? [a.variant] : []));
    if (allOn.length === topic.alternatives.length) expect(topicView(topic, allOn, 'inactive', '')).toBeNull();
  });

  it('searches the requirement, its alternatives and its board item', () => {
    expect(topicView(topic, [], 'all', topic.title.toUpperCase())).not.toBeNull();
    expect(topicView(topic, [], 'all', alternative.text)).not.toBeNull();
    expect(topicView(topic, [], 'all', String(BOARD[topic.board[0]].title))).not.toBeNull();
    expect(topicView(topic, [], 'all', 'no requirement says this')).toBeNull();
  });
});

