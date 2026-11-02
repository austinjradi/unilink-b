// S4: posts and replies are plain text with a little Ed-style formatting: ``` fenced ``` code
// blocks, `inline code`, and web links. Anything else shows exactly as it was typed.

export type PostPart = { kind: 'text' | 'code' | 'block' | 'link'; text: string };

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?^```[ \t]*$/gm;
const INLINE = /(`[^`\n]+`|https?:\/\/[^\s<>()`]+)/g;
// A sentence's punctuation right after a link isn't part of it.
const TRAILING = /[.,;:!?'"]+$/;

function inlineParts(text: string): PostPart[] {
  const parts: PostPart[] = [];
  const add = (part: PostPart) => {
    const last = parts.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
    else if (part.text) parts.push(part);
  };
  for (const piece of text.split(INLINE)) {
    if (piece.length > 2 && piece.startsWith('`') && piece.endsWith('`')) add({ kind: 'code', text: piece.slice(1, -1) });
    else if (/^https?:\/\//.test(piece)) {
      const tail = piece.match(TRAILING)?.[0] ?? '';
      add({ kind: 'link', text: piece.slice(0, piece.length - tail.length) });
      add({ kind: 'text', text: tail });
    } else add({ kind: 'text', text: piece });
  }
  return parts;
}

export function parsePost(text: string): PostPart[] {
  const parts: PostPart[] = [];
  let from = 0;
  for (const match of text.matchAll(FENCE)) {
    // The line breaks around a block are its own edges, not blank lines.
    parts.push(...inlineParts(text.slice(from, match.index).replace(/\n$/, '')));
    parts.push({ kind: 'block', text: match[1] });
    from = match.index + match[0].length;
    if (text[from] === '\n') from++;
  }
  parts.push(...inlineParts(text.slice(from)));
  return parts;
}
