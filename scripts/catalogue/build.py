#!/usr/bin/env python3
"""Step 3 of the catalogue import: writes what the website reads, into src/shared/catalogue/data.

Everything here is fact: course codes, titles and credits, program structure, contact details,
award values, and the dates, amounts, links and phone numbers found in each section. Running text
is never copied; each section's summary comes from notes/*.json, written by hand in our own words
while reading the catalogue 20 pages at a time (see next_batch.py).

    python3 -I build.py <work-dir> <output-dir>
"""
import collections, glob, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
# The catalogue's parts and where each starts. Its contents pages indent these inconsistently.
PARTS = [
    ('About this publication', 1), ('University Regulations', 20), ('University and Facilities', 71), ('Agricultural & Environmental Sciences', 87),
    ('Arts', 150), ('Bachelor of Arts & Science', 428), ('Dental Medicine & Oral Health Sciences', 661), ('Education', 684),
    ('Engineering', 743), ('Environment', 821), ('Law', 873), ('Management', 902), ('Medicine & Health Sciences', 940),
    ('Music', 1006), ('Nursing', 1059), ('Physical & Occupational Therapy', 1083), ('Science', 1104),
    ('Study Abroad & Field Studies', 1286),
]
NEAR_SAME, NEAR_MIN_WORDS = 0.85, 15  # How alike two sections must be to share a summary.
NO_TITLE = 'Title not given in the catalogue'
SHORT_LINE = 15  # Words. Requirement lines up to this ("3 credits from:") are kept as they're just the rule.

def slug(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')

def key_of(section):
    return f"{section['page']}-{slug(section['title'])[:60]}"

def number(text):
    try:
        return float(text)
    except ValueError:
        return None

# --- The tree in the printed contents pages ---------------------------------------------------

def read_toc(work):
    with open(f'{work}/lines/0001-0020.json', encoding='utf8') as f:
        pages = json.load(f)
    entries, pending = [], None
    for page in pages:
        if not 3 <= page['pdf'] <= 20:
            continue
        for line in page['lines']:
            if line['y'] < 95:
                continue
            text = line['text']
            base = 51.0 if line['x'] < 306 else 326.4
            if pending is None:
                pending = {'depth': round((line['x'] - base) / 15), 'title': ''}
            done = re.search(r'\s*\.{2,}\s*(\d+)$', text) or re.search(r'\s+(\d{2,4})$', text)
            body = text[: done.start()] if done else text
            pending['title'] = (pending['title'] + ' ' + body.rstrip('. ')).strip()
            if done:
                pending['page'] = int(done.group(1))
                entries.append(pending)
                pending = None
    return entries

# --- Facts inside running text ----------------------------------------------------------------

MONTH = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'
FACTS = {
    'dates': re.compile(rf'\b{MONTH} \d{{1,2}}(?:, \d{{4}})?|\b{MONTH} \d{{4}}'),
    'money': re.compile(r'\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|per credit|per term|each))?'),
    'phones': re.compile(r'(?:1-)?\b\d{3}[- ]\d{3}[- ]\d{4}\b(?:,? ext\.? ?\d+)?'),
    'emails': re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+'),
    'links': re.compile(r'(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:ca|com|org|net|edu|gov|qc\.ca)/\S*|\b(?:[\w-]+\.)+(?:ca|com|org|net)\b(?!\.\w)'),
    'percents': re.compile(r'\b\d+(?:\.\d+)?%'),
}

def facts_in(text):
    # A link broken over two lines comes back with a space after its slash.
    text = re.sub(r'(\.(?:ca|com|org|net)/(?:[\w%-]+/)*)\s+(?=[\w-])', r'\1', text)
    found = {}
    for kind, pattern in FACTS.items():
        items = []
        for match in pattern.findall(text):
            match = match.rstrip('.,;:)')
            if kind == 'links':
                match = re.sub(r'\([^)]*$', '', match)
                # An email's domain isn't a link of its own.
                if '@' in match or re.fullmatch(r'[\w.+-]+', match) and any(match in e for e in FACTS['emails'].findall(text)):
                    continue
            if match and match not in items:
                items.append(match)
        if items:
            found[kind] = items
    return found

COURSE_MENTION = re.compile(r'\b[A-Z]{4} \d{3}(?:[A-Z]\d)?\b')

# --- Programs ---------------------------------------------------------------------------------

KINDS = [
    ('Joint Honours', r'Joint Honours|Jt Honours'), ('Honours', r'Honours'), ('Major', r'\bMajor|Majeure|majeure'),
    ('Minor', r'\bMinor|Mineure|mineure'), ('Concentration', r'Concentration'),
    ('Foundation', r'Foundation'), ('Faculty Program', r'Faculty Program|Interfaculty'), ('Liberal Program', r'Liberal Program'),
    ('Specialization', r'Specialization|Spécialisation'), ('Certificate', r'\(Cert\.|Certificate'), ('Diploma', r'\(Dip\.|Diploma|\(Gr\. Dip'),
]

def kind_of(name):
    for kind, pattern in KINDS:
        if re.search(pattern, name):
            return kind
    return 'Degree'

def parse_header(text):
    head = {}
    m = re.search(r'Offered by:\s*(.*?)(?=\s*Degree:|\s*Program credit weight:|$)', text)
    if m:
        offered = m.group(1).strip()
        head['offeredBy'] = offered
        f = re.search(r'\(([^()]*)\)\s*$', offered)
        head['faculty'] = f.group(1) if f else None
        head['unit'] = offered[: f.start()].strip() if f else offered
    m = re.search(r'Degree:\s*(.*?)(?=\s*Program credit weight:|\s*Offered by:|$)', text)
    if m:
        head['degrees'] = [d.strip() for d in m.group(1).split(';') if d.strip()]
    m = re.search(r'Program credit weight:\s*([\d.]+)', text)
    if m:
        head['credits'] = number(m.group(1))
    return head

CREDITS_IN = re.compile(r'(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(?:credits?|crédits?)', re.I)
REQUIREMENT = re.compile(r'(?i)\b(required|complementary|elective|courses?|cours|group|list|stream|option|concentration|block|bloc|série|year|term|stage)\b')

def credit_range(text):
    m = CREDITS_IN.search(text)
    if not m:
        return None
    low = float(m.group(1))
    return [low, float(m.group(2)) if m.group(2) else low]

def section_kind(title):
    t = title.lower()
    if re.search(r'complementary|complémentaire|elective|option|au choix', t):
        return 'choose'
    if re.search(r'required|obligatoire|core', t):
        return 'required'
    return 'choose'

def build_programs(sections):
    programs, ids = [], collections.Counter()
    i = 0
    while i < len(sections):
        section = sections[i]
        first = section['blocks'][0] if section['blocks'] else None
        if not (first and first['type'] == 'para' and 'Offered by:' in first['text']):
            i += 1
            continue
        head = parse_header(' '.join(b.get('text', '') for b in section['blocks'][:3]))
        name = section['title']
        section['program'] = None
        pid = slug(re.sub(r'\(\d[\d.\-]* credits?\)', '', name))
        ids[pid] += 1
        if ids[pid] > 1:
            pid = f'{pid}-{ids[pid]}'
        program = {'id': pid, 'name': re.sub(r'\s*\(\d[\d.\-]* credits?\)\s*$', '', name), 'kind': kind_of(name), 'page': section['page'],
                   'faculty': head.get('faculty'), 'unit': head.get('unit'), 'degrees': head.get('degrees', []), 'credits': head.get('credits'),
                   'parts': [], 'key': section['key'], 'prose': []}
        j = i + 1
        current = None
        while j < len(sections) and not (sections[j]['level'] == 1):
            sub = sections[j]
            sub['program'] = pid
            title = sub['title']
            is_top = sub['level'] <= 2
            if is_top and re.match(r'(?i)^(program description|degree requirements|program prerequisites|location|available programs)', title) is None:
                current = {'title': title, 'credits': credit_range(title), 'kind': section_kind(title), 'lists': []}
                program['parts'].append(current)
            elif is_top:
                current = None
            label = title if current is not None and sub['level'] > 2 else None
            lines = []
            for block in sub['blocks']:
                if block['type'] == 'courses':
                    if current is None:
                        current = {'title': title, 'credits': credit_range(title), 'kind': section_kind(title), 'lists': []}
                        program['parts'].append(current)
                    rule = next((l for l in reversed(lines) if len(l.split()) <= SHORT_LINE), None)
                    current['lists'].append({'label': label, 'rule': rule, 'page': block['page'], 'courses': [r['code'] for r in block['rows']]})
                    lines = []
                else:
                    text = block['text']
                    if current is not None and len(text.split()) <= SHORT_LINE and re.search(r'(?i)credit|crédit|one of|from|or$|^or\b', text):
                        lines.append(text)
                    elif not re.match(r'^(Offered by:|Expand all)', text) and not title.startswith('Degree Requirements'):
                        program['prose'].append(sub['key'])
            j += 1
        program['prose'] = list(dict.fromkeys(program['prose']))
        programs.append(program)
        i = j if j > i + 1 else i + 1
    return programs

def build_courses(sections):
    titles, credits, faces = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter), {}
    for section in sections:
        for block in section['blocks']:
            if block['type'] != 'courses':
                continue
            for row in block['rows']:
                code = row['code']
                title = row['title']
                m = re.match(r'^(.*?)\.\s*\(([^)]*)\)$', title)
                if m:
                    title = m.group(1)
                # A couple of rows give only the code; they still count as listed.
                titles[code]['' if re.search(r'Not Found$', title) or not title else title.rstrip('. ')] += 1
                value = number(row['credits'])
                if value is not None:
                    credits[code][value] += 1
                faces.setdefault(code, block['page'])
    out = []
    for code in sorted(titles):
        c = credits[code].most_common(1)
        named = [(title, n) for title, n in titles[code].most_common() if title]
        out.append([code, named[0][0] if named else NO_TITLE, c[0][0] if c else None])
    return out

# --- Contacts and awards ----------------------------------------------------------------------

def build_contacts(sections, toc_of):
    out, seen = [], set()
    owner = None
    for section in sections:
        if section['level'] == 1:
            owner = re.sub(r'^About ', '', section['title'])
        for index, block in enumerate(section['blocks']):
            if block['type'] == 'courses':
                continue
            text = block['text']
            is_location = section['title'].startswith('Location') or re.search(r'(?:Telephone|Tel\.|Website|Email):', text)
            if not is_location:
                continue
            if not re.search(r'(?:Telephone|Tel\.|Fax|Website|Email)\b|\bQC\b|\bStreet\b|\bSt\.|\bAvenue\b', text):
                continue
            facts = facts_in(text)
            address = [l for l in block.get('lines', []) if not re.match(r'^(Telephone|Fax|Website|Email|Tel\.)', l) and len(l.split()) <= 12]
            if not (facts.get('phones') or facts.get('emails') or facts.get('links') or re.search(r'\bQC\b', text)):
                continue
            sig = (tuple(address[:3]), tuple(facts.get('phones', [])), tuple(facts.get('emails', [])))
            if sig in seen:
                continue
            seen.add(sig)
            out.append({'where': toc_of(section), 'unit': owner, 'section': section['title'], 'page': block['page'], 'address': address[:6] if re.search(r'\bQC\b|Room|Building|Street|\bSt\.', text) else [],
                        'phones': facts.get('phones', []), 'emails': facts.get('emails', []), 'links': facts.get('links', [])})
    return out

def build_awards(sections, toc_of):
    out = []
    for index, section in enumerate(sections):
        text = ' '.join(b.get('text', '') for b in section['blocks'] if b['type'] != 'courses')
        path = toc_of(section)
        value = re.search(r'Value:\s*(.*?)(?:\.\s|\.$|$)', text)
        looks = value or (re.search(r'(?i)scholarship|award|bursary|prize|medal|loan fund|aid fund', section['title']) and re.search(r'(?i)awarded|established|value|available', text))
        if not looks or len(text.split()) > 400 or section['title'].endswith('Office'):
            continue
        kind = next((k for k, p in [('Loan', 'Loan Fund'), ('Loan', 'Aid Fund'), ('Medal', 'Medal'), ('Prize', 'Prize'), ('Bursary', 'Bursar'), ('Scholarship', 'Scholarship'), ('Award', 'Award'), ('Fellowship', 'Fellowship')] if p.lower() in section['title'].lower()), 'Award')
        out.append({'name': section['title'], 'kind': kind, 'value': value.group(1).strip() if value else None, 'faculty': path, 'page': section['page'], 'key': section['key']})
    return out

# --- Everything else: the guide ---------------------------------------------------------------

def load_notes():
    notes = {}
    for path in sorted(glob.glob(f'{HERE}/notes/*.json')):
        with open(path, encoding='utf8') as f:
            notes.update(json.load(f))
    return notes

def norm(text):
    return re.sub(r'\W+', ' ', re.sub(r'\(p\. ?\d+\)', '', text)).lower().strip()

def section_prose(section):
    return [b['text'] for b in section['blocks'] if b['type'] != 'courses']

# A line that only points elsewhere: "Computer Science Major (B.Sc.) (63 credits) (p. 1170)".
POINTER = re.compile(r'^(.{3,160}?)\s*\(p\. ?(\d+)\)\)?[.,;]?(?: listed under.*)?$')

# Or just names a program: "Anthropology Honours (B.A.) (60 credits)".
NAMED_PROGRAM = re.compile(r'^(?:\*\*)?(.{3,160}?\(\d+ (?:credits|cr\u00e9dits)\).{0,120})$')

def is_pointer(block):
    return block['type'] == 'bullet' and (POINTER.match(block['text']) or NAMED_PROGRAM.match(block['text']))

def needs_note(section):
    """Whether a section has running text to summarize, not just requirement lines or contact details."""
    texts = [b['text'] for b in section['blocks'] if b['type'] != 'courses' and not is_pointer(b) and not re.match(r'^(Offered by:|Expand all)', b['text'])]
    return any(len(t.split()) > SHORT_LINE or (not re.search(r'(?i)credit|credit|from:?$|or$|^or\b|^value:', t) and not facts_in(t) and len(t.split()) > 6) for t in texts)

def load(work):
    with open(f'{work}/sections.json', encoding='utf8') as f:
        sections = json.load(f)
    # Sections reading like an earlier one share its summary: B.A. and B.A. & Sc. repeat a lot,
    # sometimes changing only the degree's name. Their own dates and links are still kept.
    seen_keys, first_of, by_title = collections.Counter(), {}, collections.defaultdict(list)
    for section in sections:
        key = key_of(section)
        seen_keys[key] += 1
        section['key'] = f'{key}-{seen_keys[key]}' if seen_keys[key] > 1 else key
        signature = norm(' '.join(section_prose(section)))
        section['shared'] = section['key']
        if not signature:
            continue
        if signature in first_of:
            section['shared'] = first_of[signature]
            continue
        words = set(signature.split())
        title = section['title'].lower()
        if len(words) >= NEAR_MIN_WORDS:
            match = next((k for k, other in by_title[title] if len(words & other) / len(words | other) >= NEAR_SAME), None)
            if match:
                section['shared'] = match
                first_of[signature] = match
                continue
            by_title[title].append((section['key'], words))
        first_of[signature] = section['key']
    return sections

def top_of(section):
    found = PARTS[0][0]
    for title, page in PARTS:
        if page <= section['page']:
            found = title
    return found

def print_batch(work, first, last):
    """What to read next: the running text of printed pages first to last, leaving out repeats."""
    sections = load(work)
    build_programs(sections)
    notes = load_notes()
    parent = None
    for section in sections:
        if section['level'] == 1:
            parent = section['title']
        if not first <= section['page'] <= last or section['key'] in notes or section['shared'] != section['key'] or not needs_note(section):
            continue
        print(f"### {section['key']} | L{section['level']} | under: {parent}")
        for block in section['blocks']:
            if block['type'] == 'courses':
                print(f"[{len(block['rows'])} courses]")
            elif not re.match(r'^(Offered by:|Expand all)', block['text']) and not is_pointer(block):
                print(('* ' if block['type'] == 'bullet' else '') + block['text'])
    left = sum(1 for s in sections if s['shared'] == s['key'] and s['key'] not in notes and needs_note(s) and s['page'] > last)
    print(f'--- {left} sections left after page {last}')

def main(work, out):
    os.makedirs(out, exist_ok=True)
    sections = load(work)
    toc = read_toc(work)
    programs = build_programs(sections)
    for program in programs:
        program['part'] = top_of(program)
        if not program['faculty'] or ';' in program['faculty'] or not program['faculty'].startswith(('Faculty', 'Desautels', 'Schulich', 'School', 'Ingram')):
            program['faculty'] = program['part']
    courses = build_courses(sections)
    contacts = build_contacts(sections, top_of)
    awards = build_awards(sections, top_of)
    notes = load_notes()

    guide, words_total, words_done, missing = [], 0, 0, 0
    by_key = {s['key']: s for s in sections}
    # The disclaimer sits on the page before any heading, so it has no section of its own.
    front = '1-about-this-publication'
    guide.append({'key': front, 'title': PARTS[0][0], 'level': 1, 'page': 1, 'part': PARTS[0][0], 'points': notes[front]})
    # Tables that no program lists, such as writing courses or off-campus courses, are shown with their section.
    lists_with = {}
    for program in programs:
        for part in program['parts']:
            for course_list in part['lists']:
                for code in course_list['courses']:
                    lists_with.setdefault(code, set()).add(id(course_list))
    def unlisted_codes(section):
        codes = set()
        for block in section['blocks']:
            if block['type'] != 'courses':
                continue
            rows = {row['code'] for row in block['rows']}
            if not section.get('program') or not rows or not set.intersection(*(lists_with.get(code, set()) for code in rows)):
                codes |= rows
        return codes
    for section in sections:
        text = ' '.join(section_prose(section))
        key = section['key']
        points = notes.get(key) or notes.get(section['shared'])
        if isinstance(points, str):
            points = [points]
        # A few short lines, like "The normal course load is 15 to 18 credits per term", are just the rule.
        if not points and not needs_note(section):
            points = [b['text'] for b in section['blocks'] if b['type'] != 'courses' and not is_pointer(b) and not re.match(r'^(Offered by:|Expand all|Telephone|Fax|Email|Website|Tel\.)', b['text']) and not section.get('program')] or None
        refs = []
        for block in section['blocks']:
            if block['type'] != 'courses' and is_pointer(block):
                m = POINTER.match(block['text'])
                refs.append({'label': m.group(1).strip(), 'page': int(m.group(2))} if m else {'label': block['text'].lstrip('*').strip()})
        facts = facts_in(text)
        mentions = sorted(set(COURSE_MENTION.findall(text)) | unlisted_codes(section))
        words = len(text.split())
        wanted = needs_note(section)
        if wanted:
            words_total += words
            if points:
                words_done += words
            else:
                missing += 1
        if not (points or facts or mentions or wanted or refs):
            continue
        entry = {'key': key, 'title': section['title'], 'level': section['level'], 'page': section['page'], 'part': top_of(section)}
        if section.get('program'):
            entry['program'] = section['program']
        if points:
            entry['points'] = points
        if facts:
            entry['facts'] = facts
        if mentions:
            entry['courses'] = mentions
        if refs:
            entry['refs'] = refs
        guide.append(entry)

    def write(name, data):
        with open(f'{out}/{name}.json', 'w', encoding='utf8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(f'{name}.json: {os.path.getsize(f"{out}/{name}.json") // 1024} KB, {len(data)} entries')

    index = {
        'parts': [{'title': t, 'page': p} for t, p in PARTS],
        'programs': [{k: p[k] for k in ('id', 'name', 'kind', 'part', 'faculty', 'unit', 'credits', 'page')} for p in programs],
        'guide': [{'key': g['key'], 'title': g['title'], 'part': g['part'], 'page': g['page']} for g in guide if not g.get('program')],
    }
    for program in programs:
        del program['part'], program['key']
    write('index', index)
    write('courses', courses)
    write('programs', programs)
    write('contacts', contacts)
    write('awards', awards)
    write('guide', guide)
    write('contents', toc)
    print(f'summarized {words_done}/{words_total} words of running text ({100 * words_done // max(words_total, 1)}%), {missing} sections to go')

if __name__ == '__main__':
    if len(sys.argv) > 3 and sys.argv[2] == 'batch':
        print_batch(sys.argv[1], int(sys.argv[3]), int(sys.argv[4]))
    else:
        main(sys.argv[1], sys.argv[2])
