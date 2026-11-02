// The text of a Word .docx, for reading problems and dates out of it: a .docx is a zip file with
// the text in word/document.xml. The browser's own DecompressionStream does the unzipping.

const LOCAL_FILE = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
// Far more text than any handout, and a stop for a file built to unpack into gigabytes.
const MAX_XML_BYTES = 50 * 1024 * 1024;

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_XML_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

// One zip entry's text, or null if it isn't there.
async function readEntry(bytes: Uint8Array, wanted: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_OF_DIRECTORY) end--;
  if (end < 0) return null;

  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_DIRECTORY) return null;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name === wanted) {
      const local = view.getUint32(at + 42, true);
      if (view.getUint32(local, true) !== LOCAL_FILE) return null;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return new TextDecoder().decode(data);
      return method === 8 ? inflate(data) : null;
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function docxXmlToText(xml: string) {
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (all, dec, hex, name) =>
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name] ?? all),
    );
}

// null when it isn't a readable .docx.
export async function docxText(bytes: Uint8Array): Promise<string | null> {
  try {
    const xml = await readEntry(bytes, 'word/document.xml');
    return xml == null ? null : docxXmlToText(xml);
  } catch {
    return null;
  }
}
