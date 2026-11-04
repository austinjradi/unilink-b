#!/usr/bin/env python3
"""Step 1 of the catalogue import: turns the McGill Course Catalogue PDF into lines of text.

Reads 20 pages at a time with mutool and writes one JSON file per batch, so a run can stop and
carry on. Each line keeps what the parser needs: page, position, size and whether it's bold.

    python3 -I extract.py <catalogue.pdf> <work-dir>

Nothing from the PDF itself ends up in the repository, only what the later steps make of it.
"""
import html, json, os, re, subprocess, sys

BATCH = 20

# The PDF's fonts are Type 3 with ligatures in the private use area, and tools that only follow
# its Unicode table drop them ("Leave o Absence"). Worked out from the words each one appears in.
GLYPHS = {chr(code): text for text, codes in {
    'f': [0xe010, 0xe013, 0xe023],
    'ff': [0xe011, 0xe01d, 0xe046, 0xe04c, 0xe04d],
    'fi': [0xe028, 0xe03c, 0xe045, 0xe06d],
    'fl': [0xe029, 0xe034, 0xe05d],
    'ffi': [0xe016, 0xe02d, 0xe042, 0xe04b],
    'ffl': [0xe083],
    'tt': [0xe038, 0xe039, 0xe043, 0xe04a],
    '\u00ab': [0xe056, 0xe077],
    '\u00bb': [0xe057, 0xe078],
}.items() for code in codes}

# The "ft" ligature is labelled plain "f" in the PDF, so only its width gives it away: about 0.7
# of the font size against 0.3 to 0.4 for a real f ("Sofware", "afer").
FT_WIDTH = 0.65

def clean(text):
    text = ''.join(GLYPHS.get(c, c) for c in text)
    # Non-breaking hyphens came out as "#" when the page was printed ("Student#for#a#Day").
    return re.sub(r'(?<=\w)#(?=\w)', '-', text).replace('\u00a0', ' ').strip()

LINE = re.compile(r'<line [^>]*bbox="([^"]+)"[^>]*>(.*?)</line>', re.S)
FONT = re.compile(r'<font name="([^"]*)" size="([^"]*)">(.*?)</font>', re.S)
CHAR = re.compile(r'<char [^>]*?quad="([^"]*)"[^>]*?c="([^"]*)"')

def chars_of(body, size):
    out = []
    for quad, c in CHAR.findall(body):
        c = html.unescape(c)
        if c == 'f':
            q = quad.split()
            if (float(q[2]) - float(q[0])) / size >= FT_WIDTH:
                c = 'ft'
        out.append(c)
    return ''.join(out)

def parse_batch(xml, first):
    pages = []
    for i, page in enumerate(re.findall(r'<page .*?</page>', xml, re.S)):
        lines = []
        for bbox, body in LINE.findall(page):
            x0, y0, x1, y1 = [float(v) for v in bbox.split()]
            parts = [(name, float(size), chars_of(chars, float(size))) for name, size, chars in FONT.findall(body)]
            text = clean(''.join(p[2] for p in parts))
            if not text:
                continue
            main = max(parts, key=lambda p: len(p[2].strip()))
            lines.append({'x': round(x0, 1), 'y': round(y0, 1), 'x1': round(x1, 1), 'size': round(main[1], 1),
                          'font': main[0].split('+')[-1], 'text': text})
        lines.sort(key=lambda l: (l['x'] > 306, l['y'], l['x']))
        pages.append({'pdf': first + i, 'lines': lines})
    return pages

def main(pdf, work):
    os.makedirs(f'{work}/xml', exist_ok=True)
    os.makedirs(f'{work}/lines', exist_ok=True)
    total = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    for start in range(1, total + 1, BATCH):
        end = min(start + BATCH - 1, total)
        out = f'{work}/lines/{start:04d}-{end:04d}.json'
        if os.path.exists(out):
            continue
        xml_path = f'{work}/xml/{start:04d}.xml'
        if not os.path.exists(xml_path):
            subprocess.run(['mutool', 'draw', '-q', '-F', 'stext', '-o', xml_path, pdf, f'{start}-{end}'],
                           stderr=subprocess.DEVNULL, check=True)
        with open(xml_path, encoding='utf8') as f:
            pages = parse_batch(f.read(), start)
        with open(out, 'w', encoding='utf8') as f:
            json.dump(pages, f, ensure_ascii=False)
        print(f'pages {start}-{end}: {sum(len(p["lines"]) for p in pages)} lines')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
