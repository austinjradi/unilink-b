// S4: posts and replies are plain text with a little Ed-style formatting: ``` fenced ``` code
// blocks, `inline code`, web links, and math between dollar signs. Anything else shows exactly as
// it was typed.

export type PostPart = { kind: 'text' | 'code' | 'block' | 'link' | 'math' | 'mathblock'; text: string };

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?^```[ \t]*$/gm;
// Math hugs its dollar signs, and a closing one isn't followed by a digit, so prices stay prices:
// "$5 and $10", "$5-$10" and "$HOME and $PATH" are all plain text.
const INLINE = /(`[^`\n]+`|\$\$[^$]+\$\$|\$(?=\S)[^$\n]*\S\$(?!\d)|\$[^\s$]\$(?!\d)|https?:\/\/[^\s<>()`]+)/g;
// A sentence's punctuation right after a link isn't part of it.
const TRAILING = /[.,;:!?'"]+$/;

function inlineParts(text: string): PostPart[] {
  const parts: PostPart[] = [];
  const add = (part: PostPart) => {
    const last = parts.at(-1);
    // The line breaks around a block of math are its own edges, as with code.
    if (part.kind === 'mathblock' && last?.kind === 'text') last.text = last.text.replace(/\n$/, '');
    if (part.kind === 'text' && last?.kind === 'mathblock') part.text = part.text.replace(/^\n/, '');
    if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
    else if (part.text) parts.push(part);
  };
  for (const [i, piece] of text.split(INLINE).entries()) {
    // Odd pieces are what the pattern matched.
    if (i % 2 === 0) add({ kind: 'text', text: piece });
    else if (piece.startsWith('$$')) add({ kind: 'mathblock', text: piece.slice(2, -2).trim() });
    else if (piece.startsWith('$')) add({ kind: 'math', text: piece.slice(1, -1) });
    else if (piece.startsWith('`')) add({ kind: 'code', text: piece.slice(1, -1) });
    else if (/^https?:\/\//.test(piece)) {
      const tail = piece.match(TRAILING)?.[0] ?? '';
      add({ kind: 'link', text: piece.slice(0, piece.length - tail.length) });
      add({ kind: 'text', text: tail });
    }
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
