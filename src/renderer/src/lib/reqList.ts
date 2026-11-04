import { NOT_SWITCHABLE, variantFor, type VariantId } from '@shared/variants';
import { BOARD, type BoardId, REQ_TOPICS, type ReqTopic, type ReqTopicId } from './reqTopics';

// The requirements page: every info topic under the board item it answers, by feature, with the
// alternatives it could have instead.

export interface ListAlternative {
  text: string;
  variant: VariantId | null;
  // Why there's no switch, when there isn't one.
  reason: string | null;
}

export interface ListTopic {
  id: ReqTopicId;
  title: string;
  how: string;
  board: BoardId[];
  alternatives: ListAlternative[];
  searchable: string;
}

export interface ListGroup {
  board: BoardId;
  topics: ListTopic[];
}

export interface ListFeature {
  id: BoardId;
  title: string;
  groups: ListGroup[];
}

const featureOf = (id: BoardId) => String(id).split('.')[0] as BoardId;

function listTopic(id: ReqTopicId): ListTopic {
  const topic: ReqTopic = REQ_TOPICS[id];
  const alternatives = (topic.alternatives as readonly string[]).map((text) => ({ text, variant: variantFor(text) ?? null, reason: NOT_SWITCHABLE[text] ?? null }));
  const words = [topic.title, topic.how, ...alternatives.map((a) => a.text), ...topic.board.flatMap((board) => [board, BOARD[board].title])];
  return { id, title: topic.title, how: topic.how, board: topic.board, alternatives, searchable: words.join(' ').toLowerCase() };
}

export function requirementList(): ListFeature[] {
  const topics = (Object.keys(REQ_TOPICS) as ReqTopicId[]).map(listTopic);
  const boardIds = Object.keys(BOARD) as BoardId[];
  const features = [...new Set(boardIds.map(featureOf))];
  return features.map((feature) => {
    // What's about the feature as a whole comes first, under its story.
    const parts = [feature, ...boardIds.filter((id) => id !== feature && featureOf(id) === feature)];
    const groups = parts.map((board) => ({ board, topics: topics.filter((topic) => topic.board[0] === board) })).filter((group) => group.topics.length);
    return { id: feature, title: BOARD[feature].title, groups };
  });
}

export type ListFilter = 'all' | 'implemented' | 'inactive' | 'on';

export interface TopicView {
  built: boolean;
  active: ListAlternative[];
  inactive: ListAlternative[];
}

// What a topic shows for this filter and search, or null when it doesn't show at all.
export function topicView(topic: ListTopic, on: readonly VariantId[], filter: ListFilter, search: string): TopicView | null {
  const words = search.trim().toLowerCase();
  if (words && !topic.searchable.includes(words)) return null;
  const isActive = (a: ListAlternative) => !!a.variant && on.includes(a.variant);
  const active = topic.alternatives.filter(isActive);
  const inactive = topic.alternatives.filter((a) => !isActive(a));
  if (filter === 'on' && !active.length) return null;
  if (filter === 'inactive' && !inactive.length) return null;
  return { built: filter !== 'inactive', active: filter === 'inactive' ? [] : active, inactive: filter === 'all' || filter === 'inactive' ? inactive : [] };
}
