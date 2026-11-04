#!/usr/bin/env python3
"""Step 2 of the catalogue import: turns the lines from extract.py into a tree of sections.

Works through the 20-page batches in order and writes <work-dir>/sections.json. Each section has
its heading, level, printed page and a list of blocks: paragraphs, bullets, course tables and
other tables. Headings go by font size, which the catalogue uses consistently.

    python3 -I parse.py <work-dir>
"""
import glob, json, re, sys

LEVELS = {21.9: 1, 18.0: 1, 15.9: 2, 12.0: 3, 10.0: 4, 9.0: 5}
COURSE = re.compile(r'^[A-Z][A-Z0-9]{3} \d{3}[A-Z0-9]{0,4}$')
# A row printed on one line, which happens where a table runs over a page.
WHOLE_ROW = re.compile(r'^([A-Z][A-Z0-9]{3} \d{3}[A-Z0-9]{0,4}) (.+?)\.?\s+(\d+(?:\.\d+)?)$')
BODY_GAP = 15  # A paragraph ends where the gap to the next line is bigger than this.

def is_running_head(line):
    return line['y'] < 50

def columns(page):
    """Reading order: the left column top to bottom, then the right. Full-width lines stay put."""
    left = [l for l in page['lines'] if l['x'] < 306 and not is_running_head(l)]
    right = [l for l in page['lines'] if l['x'] >= 306 and not is_running_head(l)]
    return [left, right]

def row_groups(lines):
    """Groups lines on the same baseline, so table rows come back together."""
    rows = []
    for line in sorted(lines, key=lambda l: (l['y'], l['x'])):
        if rows and abs(rows[-1][0]['y'] - line['y']) < 3:
            rows[-1].append(line)
        else:
            rows.append([line])
    return [sorted(r, key=lambda l: l['x']) for r in rows]

class Parser:
    def __init__(self):
        self.sections = []
        self.current = None
        self.heading = None
        self.table = None
        self.para = None

    def flush_para(self):
        self.para = None

    def new_section(self, level, text, page):
        self.current = {'level': level, 'title': text, 'page': page, 'blocks': []}
        self.sections.append(self.current)
        self.para = None
        self.table = None

    def add_block(self, block):
        if self.current is None:
            self.new_section(1, 'Front matter', 0)
        self.current['blocks'].append(block)

    def feed_heading(self, row, page):
        line = row[0]
        level = LEVELS[line['size']]
        text = ' '.join(l['text'] for l in row)
        h = self.heading
        # A heading that wraps comes as several lines of the same size, close together.
        if h and h['size'] == line['size'] and h['page'] == page and 0 < line['y'] - h['y'] < line['size'] * 1.5 and abs(h['x'] - line['x']) < 3 and self.current and not self.current['blocks']:
            self.current['title'] += ' ' + text
        else:
            self.new_section(level, text, page)
        self.heading = {'size': line['size'], 'y': line['y'], 'x': line['x'], 'page': page}

    def feed_table_row(self, row, page, base):
        cells = [l['text'] for l in row if l['size'] != 6.4]
        notes = [l['text'] for l in row if l['size'] == 6.4]
        if cells[:1] == ['Course'] and 'Title' in cells:
            self.table = {'type': 'courses', 'page': page, 'rows': []}
            self.add_block(self.table)
            self.para = None
            return True
        # "or HIST" then "409AB" a line below: an alternative to the row above, split over two lines.
        split = re.match(r'^or ([A-Z][A-Z0-9]{3})$', cells[0]) if cells else None
        if split and self.table is not None:
            self.split_code = (split.group(1), ' '.join(cells[1:]))
            return True
        if getattr(self, 'split_code', None) and len(cells) == 1 and re.match(r'^\d{3}[A-Z0-9]{0,4}$', cells[0]):
            subject, title = self.split_code
            self.split_code = None
            self.table['rows'].append({'code': f'{subject} {cells[0]}', 'title': title.rstrip('.'), 'credits': '', 'notes': notes})
            return True
        # A table carrying on after a break, without its header.
        if self.table is None and len(cells) >= 3 and COURSE.match(cells[0]) and re.match(r'^[\d.\-]+$', cells[-1]):
            self.table = {'type': 'courses', 'page': page, 'rows': []}
            self.add_block(self.table)
            self.para = None
        whole = WHOLE_ROW.match(cells[0]) if len(cells) == 1 else None
        if whole:
            if self.table is None:
                self.table = {'type': 'courses', 'page': page, 'rows': []}
                self.add_block(self.table)
                self.para = None
            self.table['rows'].append({'code': whole.group(1), 'title': whole.group(2), 'credits': whole.group(3), 'notes': notes})
            return True
        if self.table is not None and cells:
            first = cells[0].replace(' ', ' ')
            if COURSE.match(first):
                title = ' '.join(cells[1:-1]) if len(cells) >= 3 else (cells[1] if len(cells) > 1 else '')
                credits = cells[-1] if len(cells) >= 3 else ''
                stuck = re.match(r'^(.*\.)\s+([\d.]+)$', title) if not credits else None
                if stuck:
                    title, credits = stuck.group(1), stuck.group(2)
                self.table['rows'].append({'code': first, 'title': title.rstrip('.'), 'credits': credits, 'notes': notes})
                return True
            # A title that wraps onto a second line, in the title column.
            if self.table['rows'] and row[0]['x'] - base > 60 and row[0]['x'] - base < 80 and len(cells) == 1:
                self.table['rows'][-1]['title'] = (self.table['rows'][-1]['title'] + ' ' + cells[0]).strip().rstrip('.')
                return True
            # Credits alone on a line, when the title wrapped ("3" sits on the first or last line).
            if self.table['rows'] and row[0]['x'] - base > 200 and len(cells) == 1 and re.match(r'^[\d.\-]+$', cells[0]):
                if not self.table['rows'][-1]['credits']:
                    self.table['rows'][-1]['credits'] = cells[0]
                return True
        return False

    def feed_body(self, row, page, base):
        line = row[0]
        text = ' '.join(l['text'] for l in row)
        if re.match(r'^Expand all\s*Contract all$', text):
            return
        if self.feed_table_row(row, page, base):
            return
        self.table = None
        bullet = re.match(r'^(?:[•·∙]|\d+\.)\s+', text)
        if bullet:
            self.para = {'type': 'bullet', 'page': page, 'x': line['x'], 'y': line['y'], 'text': text[bullet.end():], 'lines': [text[bullet.end():]], 'ordered': text[0].isdigit()}
            self.add_block(self.para)
            return
        p = self.para
        if p and p['page'] == page and 0 < line['y'] - p['y'] < BODY_GAP and line['x'] >= p['x'] - 1:
            sep = '' if p['text'].endswith('-') and not p['text'].endswith(' -') else ' '
            p['text'] += sep + text
            p['lines'].append(text)
            p['y'] = line['y']
            return
        # A paragraph carrying on at the top of the next column or page.
        if p and line['y'] < 90 and p['y'] > 600 and not re.search(r'[.:;!?)]$', p['text']):
            p['text'] += ' ' + text
            p['lines'].append(text)
            p['y'] = line['y']
            p['page'] = page
            return
        self.para = {'type': 'para', 'page': page, 'x': line['x'], 'y': line['y'], 'text': text, 'lines': [text]}
        self.add_block(self.para)

    def feed_page(self, page):
        printed = page['pdf'] - 1
        for column, lines in enumerate(columns(page)):
            base = 36.0 if column == 0 else 311.4
            for row in row_groups(lines):
                main = [l for l in row if l['size'] != 6.4]
                if not main:
                    continue  # Footnote numbers on their own.
                if main[0]['size'] in LEVELS:
                    self.feed_heading(main, printed)
                else:
                    self.feed_body(row, printed, base)

def main(work):
    parser = Parser()
    for path in sorted(glob.glob(f'{work}/lines/*.json')):
        with open(path, encoding='utf8') as f:
            for page in json.load(f):
                if page['pdf'] >= 21:  # The cover, disclaimer and contents were read separately.
                    parser.feed_page(page)
    for section in parser.sections:
        for block in section['blocks']:
            for key in ('x', 'y'):
                block.pop(key, None)
    with open(f'{work}/sections.json', 'w', encoding='utf8') as f:
        json.dump(parser.sections, f, ensure_ascii=False, indent=0)
    return parser.sections

if __name__ == '__main__':
    sections = main(sys.argv[1])
    tables = [b for s in sections for b in s['blocks'] if b['type'] == 'courses']
    rows = [r for t in tables for r in t['rows']]
    print(f'{len(sections)} sections, {len(tables)} course tables, {len(rows)} course rows, {len(set(r["code"] for r in rows))} distinct codes')
