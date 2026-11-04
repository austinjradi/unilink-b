# What the catalogue doesn't say outright: exams from the December schedule, then guesses for
# when courses run, what comes before them and how program rules work. Facts and guesses stay
# apart, so the site can always say which one it's showing.
import collections
import os
import re

CODE = r'[A-Z]{3}[A-Z0-9] \d{3}(?:[A-Z]\d?){0,2}'
CODE_IN = re.compile(rf'\b{CODE}\b')
SUBJECT = r'\b[A-Z]{3}[A-Z0-9]\b'

# ---- The December 2026 final exam schedule. `pdftotext -layout` of it is exams.txt in the work folder.

EXAM_ROW = re.compile(r'^\s*([A-Z]{3}[A-Z0-9] \d{3}[A-Z0-9]*)\s+(\S+)\s+(.+?)\s{2,}((?:IN-PERSON|ONLINE)[^\n]*?)\s{2,}'
                      r'(\d\d-[A-Z][a-z]{2}-\d{4}) at (\d+:\d\d [AP]M)\s+(\d\d-[A-Z][a-z]{2}-\d{4}) at (\d+:\d\d [AP]M)', re.M)
MONTHS = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}

def iso_date(text):
    day, month, year = text.split('-')
    return f'{year}-{MONTHS[month]:02d}-{day}'

def time_24(text):
    clock, half = text.split(' ')
    hour, minute = clock.split(':')
    return f'{int(hour) % 12 + (12 if half == "PM" else 0):02d}:{minute}'

def exam_kind(text):
    words = {'IN-PERSON': 'In person', 'ONLINE': 'Online', 'FORMAL EXAM': 'formal exam', 'IN DEPARTMENT EXAM': 'in the department', 'ORAL EXAM': 'oral exam',
             'LAB EXAM': 'lab exam', 'TIMED EXAM': 'timed', 'TAKE-HOME': 'take-home', 'D.T. CAMPUS': 'downtown', 'MAC CAMPUS': 'Macdonald campus'}
    return ', '.join(words.get(part, part.lower()) for part in text.split(' - '))

def read_exams(work):
    path = f'{work}/exams.txt'
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf8') as f:
        return [{'code': m[0], 'section': m[1], 'title': m[2], 'kind': exam_kind(m[3]), 'start': (iso_date(m[4]), time_24(m[5])), 'end': (iso_date(m[6]), time_24(m[7]))}
                for m in EXAM_ROW.findall(f.read())]

# Titles that don't end in a sit-down exam, used for guessing Winter finals.
NO_FINAL = re.compile(r'(?i)\b(seminars?|projects?|research|thesis|internships?|stage|practicum|practica|ensembles?|field|fieldwork|studio|independent|reading|readings|'
                      r'dissertation|clinical|clerkship|tutorial|workshop|placement|co-?op|work term|recital|choir|orchestra|band|performance|residency|portfolio|special topics)\b')

def build_exams(rows, courses):
    kinds = sorted({r['kind'] for r in rows})
    on_schedule = {r['code'] for r in rows}
    no_final = sorted(code for code, title, _ in courses if code not in on_schedule and NO_FINAL.search(title))
    return {
        'kinds': kinds,
        'rows': [[r['code'], r['section'], kinds.index(r['kind']), *r['start'], *r['end']] for r in rows],
        'noFinal': no_final,
    }

def add_scheduled_courses(courses, rows, no_title):
    """The schedule also lists courses the catalogue's tables don't, so those are courses too."""
    by_code = {c[0]: c for c in courses}
    for row in rows:
        known = by_code.get(row['code'])
        if known is None:
            by_code[row['code']] = known = [row['code'], row['title'], None]
            courses.append(known)
        elif known[1] == no_title:
            known[1] = row['title']
    courses.sort(key=lambda c: c[0])

# ---- When a course runs and how many sections it has

TERM_OF_SUFFIX = {'D1': 'F', 'D2': 'W', 'N1': 'W', 'N2': 'F', 'J1': 'F', 'J2': 'W', 'J3': 'W', 'AA': 'F', 'AB': 'W', 'AC': 'F', 'AD': 'W'}
PREVIOUS_PART = {'D2': 'D1', 'N2': 'N1', 'J2': 'J1', 'J3': 'J2', 'AB': 'AA', 'AC': 'AB', 'AD': 'AC'}
NO_REGULAR_FINAL = re.compile(r'(?i)\b(seminars?|projects?|research|thesis|internships?|stage|practicum|dissertation|independent|reading|readings|field|clinical|special topics)\b')

def split_title(title):
    """'Calculus 2' -> ('calculus', 2). 'Physics II' -> ('physics', 2)."""
    title = title.strip()
    found = re.match(r'^(.*?)[\s:,-]+(\d|I{1,3}|IV)$', title)
    if not found:
        return None
    step = found.group(2)
    return found.group(1).strip().lower(), int(step) if step.isdigit() else {'I': 1, 'II': 2, 'III': 3, 'IV': 4}[step]

def suffix_of(code):
    found = re.search(r'\d{3}([A-Z]\d?[A-Z]?\d?)$', code)
    return found.group(1) if found else None

def title_series(courses):
    series = collections.defaultdict(dict)
    for code, title, _ in courses:
        parts = split_title(title)
        if parts and not suffix_of(code):
            series[(code.split(' ')[0], parts[0])][parts[1]] = code
    return series

TERM_LABEL = re.compile(r'(?i)\b(fall|winter)\b')

def build_offerings(courses, rows, programs, sample):
    sections_on_schedule = collections.defaultdict(list)
    for row in rows:
        if not row['section'].endswith('L') and row['section'] not in sections_on_schedule[row['code']]:
            sections_on_schedule[row['code']].append(row['section'])
        sections_on_schedule[row['code']]  # A course with only a lab exam is still on the schedule.
    labelled = collections.defaultdict(set)
    for program in programs:
        for part in program['parts']:
            for course_list in part['lists']:
                terms = {m[0].upper() for m in TERM_LABEL.findall(' '.join(filter(None, [course_list['label'], part['title']])))}
                for code in course_list['courses']:
                    labelled[code] |= terms
    series = title_series(courses)
    step_of = {}
    for (subject, _), steps in series.items():
        if len(steps) > 1:
            for step, code in steps.items():
                step_of[code] = (step, steps)

    offerings = {}
    for code, title, _ in courses:
        level = int(code.split(' ')[1][0])
        suffix = suffix_of(code)
        listed = code in sections_on_schedule
        fall_sections = sorted(sections_on_schedule[code]) if listed else []
        terms, why = set(), None
        if listed:
            terms.add('F')
            why = 'schedule'
        if suffix in TERM_OF_SUFFIX:
            terms.add(TERM_OF_SUFFIX[suffix])
            why = why or 'two-term'
        elif labelled.get(code):
            terms |= labelled[code]
            why = why or 'program'
        if code in step_of:
            step = step_of[code][0]
            # The second step of a pair usually follows the first: Fall, then Winter.
            terms.add('F' if step % 2 else 'W')
            why = why or 'title'
        if listed and len(fall_sections) >= 2 and level <= 3:
            terms |= {'F', 'W'}
        if not terms:
            if level >= 5 or NO_REGULAR_FINAL.search(title):
                terms, why = {'F', 'W'}, 'no-final'
            else:
                # It would be on the December schedule if it ran in Fall with a final.
                terms, why = {'W'}, 'not-in-december'
        if code in sample:
            terms, why = {'F', 'W'}, why if listed else 'sample'
        offerings[code] = '|'.join(['B' if len(terms) == 2 else terms.copy().pop(), why, ','.join(fall_sections)]).rstrip('|')
    return offerings

# ---- What comes before a course

# Said in so many words on these pages of the catalogue. `any` is a list of alternatives, each a
# set of courses to take together. "general" says "in general"; "co" also allows taking both at once.
STATED_PREREQS = {
    'HISP 243': {'how': 'stated', 'page': 319, 'any': [['HISP 220D2'], ['HISP 219']]},
    'HISP 244': {'how': 'stated', 'page': 319, 'any': [['HISP 220D2'], ['HISP 219']]},
    'ENVR 400': {'how': 'stated', 'page': 327, 'any': [['ENVR 203']]},
    'MATH 357': {'how': 'stated', 'page': 362, 'any': [['MATH 204']]},
    'MATH 533': {'how': 'stated', 'page': 362, 'any': [['MATH 204']]},
    'MATH 204': {'how': 'general', 'page': 362, 'any': [['MATH 203']]},
    'PHYS 102': {'how': 'stated', 'page': 435, 'any': [['PHYS 101']]},
    'PHYS 142': {'how': 'stated', 'page': 435, 'any': [['PHYS 131']]},
    'MUJZ 260': {'how': 'stated', 'page': 712, 'any': [['MUJZ 161']]},
    'CHEM 222': {'how': 'stated', 'page': 1238, 'any': [['CHEM 212']]},
    'NSCI 200': {'how': 'co', 'page': 1238, 'any': [['CHEM 212']]},
}
ECON_UPPER = {'how': 'general', 'page': 191, 'any': [['ECON 230D2'], ['ECON 250D2'], ['ECON 208', 'ECON 209'], ['MGCR 293', 'ECON 295']]}

STAGES = [('elementary', 1), ('beginners', 1), ('beginner', 1), ('introductory', 1), ('introduction to', 1), ('intermediate', 2), ('advanced', 3)]

def stage_of(title):
    """'Advanced Spanish' -> ('spanish', 3), 'Spanish Language: Intermediate' -> ('spanish language', 2)."""
    low = re.sub(r'\s+', ' ', title.lower()).strip()
    for word, stage in STAGES:
        if low.startswith(word + ' '):
            return low[len(word) + 1:].strip(' :-'), stage
        if low.endswith(' ' + word):
            return low[:-len(word) - 1].strip(' :-'), stage
    return None

def build_prereqs(courses):
    known = {c[0] for c in courses}
    rules = {code: rule for code, rule in STATED_PREREQS.items() if code in known}
    lowest = {}
    stages = collections.defaultdict(dict)
    for code, title, _ in courses:
        subject, number = code.split(' ')
        level = int(number[0]) * 100
        if level:
            lowest[subject] = min(lowest.get(subject, level), level)
        found = stage_of(title)
        if found and not suffix_of(code):
            stages[(subject, found[0])].setdefault(found[1], code)
    for code, title, _ in courses:
        subject, number = code.split(' ')
        if subject == 'ECON' and number[0] in '34' and code not in rules:
            rules[code] = ECON_UPPER
        elif subject == 'CHEM' and int(number[0]) >= 3 and code not in rules:
            if 'physical chemistry' in title.lower():
                rules[code] = {'how': 'general', 'page': 810, 'any': [['CHEM 213', 'CHEM 273']]}
            elif 'organic' in title.lower():
                rules[code] = {'how': 'general', 'page': 810, 'any': [['CHEM 212']]}
    series = title_series(courses)
    for code, _, _ in courses:
        if code in rules:
            continue
        suffix = suffix_of(code)
        if suffix in PREVIOUS_PART:
            first = code[:-len(suffix)] + PREVIOUS_PART[suffix]
            if first in known:
                rules[code] = {'how': 'two-term', 'any': [[first]]}
    for steps in series.values():
        for step, code in steps.items():
            if step - 1 in steps and steps[step - 1] < code and code not in rules:
                rules[code] = {'how': 'title', 'any': [[steps[step - 1]]]}
    for steps in stages.values():
        for stage, code in steps.items():
            before = [s for s in steps if s < stage and steps[s] < code]
            if before and code not in rules:
                rules[code] = {'how': 'title', 'any': [[steps[max(before)]]]}
    return {'rules': rules, 'lowest': lowest}

# ---- Program rules: what a part of a program asks for besides its total

SENTENCE = re.compile(r'(?<=[.;])\s+(?=[A-Z])')
LIST_WORD = r'(?:blocks?|groups?|lists?|sets?|categor(?:y|ies)|areas?|streams?|themes?|modules?|baskets?|clusters?|sections?|parts?|course lists?)'

def num(text):
    value = float(text)
    return int(value) if value == int(value) else value

def level_of(code):
    return int(code.split(' ')[1][0])

def subject_of(code):
    return code.split(' ')[0]

def level_filter(sentence):
    """The courses a sentence's level words pick out, as a test on the level's first digit."""
    low = sentence.lower()
    found = re.search(r'\bbelow the (\d)00[- ]level\b', low)
    if found:
        top = int(found.group(1))
        return lambda n: n < top, f'below the {top}00 level'
    found = re.search(r'\b(\d)00[- ]level or (?:higher|above)\b|\babove the (\d)00[- ]level\b', low)
    if found:
        if found.group(1):
            bottom = int(found.group(1))
            return lambda n: n >= bottom, f'at the {bottom}00 level or higher'
        bottom = int(found.group(2)) + 1
        return lambda n: n >= bottom, f'at the {bottom}00 level or higher'
    many = re.findall(r'\b(\d)00(?=[- ,/]|\s+(?:or|and)\b)', low)
    if many and re.search(r'\blevels?\b', low):
        levels = sorted({int(n) for n in many})
        names = ' or '.join(f'{n}00' for n in levels)
        return lambda n: n in levels, f'at the {names} level'
    return None

MIN_WORDS = r'(?:at least|a minimum of|minimum of|minimum|no fewer than|not less than)'
MAX_WORDS = r'(?:a maximum of|maximum of|maximum|no more than|not more than|at most|up to|only)'

NUMBER_WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'twelve': 12, 'fifteen': 15, 'eighteen': 18}

def plain_numbers(sentence):
    words = '|'.join(NUMBER_WORDS)
    sentence = re.sub(rf'(?i)\b({words})(?=(?:-|\s+)(?:credits?|of (?:the|these)\b))', lambda m: str(NUMBER_WORDS[m.group(1).lower()]), sentence)
    sentence = re.sub(r'(?i)\b(\d+(?:\.\d+)?)\s+credits?\s+minimum\b', r'at least \1 credits', sentence)
    return re.sub(r'(?i)\b(\d+(?:\.\d+)?)\s+credits?\s+maximum\b', r'at most \1 credits', sentence)

CLAUSE = re.compile(r'\s+and\s+(?=(?:a\s+)?(?:minimum|maximum|at least|at most|no more|\d+\s+credits))|,\s*(?=(?:with\s+)?(?:at least|a maximum|a minimum|no more than))')

def rule_from(sentence, pool, lists):
    """The rules in one sentence, as dicts with the courses they count and their limits."""
    out = []
    add = lambda text, courses, **limits: out.append({'text': text, 'courses': sorted(set(courses)), **limits}) if courses else None
    codes_here = list(dict.fromkeys(CODE_IN.findall(sentence)))

    # Drawn from at least 3 disciplines, with no more than 9 credits from any one.
    found = re.search(rf'(?i)\bat least (\d|two|three|four)\s+(?:different\s+)?(?:disciplines?|departments?|subjects?|subject codes?)\b', sentence)
    if found:
        wanted = NUMBER_WORDS.get(found.group(1).lower()) or int(found.group(1))
        add(f'Courses from at least {wanted} different subjects', pool, minSubjects=wanted)
    found = re.search(rf'(?i)\b(?:{MAX_WORDS})\s+(\d+(?:\.\d+)?)\s+credits?\s+(?:may be taken\s+)?(?:can be\s+)?(?:from|in)\s+(?:any|a)\s+(?:one|single)(?:\s+(\w+))?', sentence)
    if found:
        credits = num(found.group(1))
        if re.fullmatch(rf'(?i){LIST_WORD}', found.group(2) or '') and len(lists) > 1:
            for i, course_list in enumerate(lists):
                add(f'At most {credits} credits from {course_list["label"] or f"list {i + 1}"}', course_list['courses'], max=credits)
        else:
            add(f'At most {credits} credits from any one subject', pool, max=credits, perSubject=True)
    if out:
        return out

    # 18 credits, of which 6 credits must be from Group A and 12 credits from Group B.
    named = re.findall(rf'(?i)\b(\d+(?:\.\d+)?)\s+credits?\s+(?:must be\s+)?(?:from|in)\s+(?:the\s+)?{LIST_WORD}\s+([A-Z0-9])\b', sentence)
    if len(named) > 1:
        for credits, name in named:
            for course_list in lists:
                if re.search(rf'\b{name}\b\s*(?:[:(]|$)', course_list['label'] or ''):
                    add(f'At least {num(credits)} credits from {course_list["label"]}', course_list['courses'], min=num(credits))
        if out:
            return out

    # Either A or B, but not both; C or D, but not both.
    pairs = [part for part in re.split(r'(?i)\bnot both\b[.,;]*', sentence) if len(CODE_IN.findall(part)) >= 2]
    if len(pairs) > 1:
        for part in pairs:
            codes = list(dict.fromkeys(CODE_IN.findall(part)))
            add(f'Only one of {", ".join(codes)}', codes, maxCourses=1)
        return out
    if len(codes_here) >= 2 and re.search(r'(?i)\bnot both\b|\bonly one of\b|\bat most one of\b|\bbut not\b|\bnot (?:both|all)\b|\bone of these\b.*\bonly\b|\beither\b.*\bnot\b|\bno credit\b.*\bboth\b', sentence):
        add(f'Only one of {", ".join(codes_here)}', codes_here, maxCourses=1)
        return out

    # Only one course from each set.
    if re.search(rf'(?i)\bonly one (?:course )?(?:from|of) each {LIST_WORD}\b|\bone course from each {LIST_WORD}\b.*\bonly\b', sentence):
        for i, course_list in enumerate(lists):
            add(f'Only one course from {course_list["label"] or f"set {i + 1}"}', course_list['courses'], maxCourses=1)
        return out

    # At least 3 credits from each of subject codes A, B and C.
    found = re.search(rf'(?i)\b(\d+(?:\.\d+)?)\s+credits?\s+from\s+each\s+of\s+(?:the\s+)?(?:following\s+)?(?:subject\s+codes?|subjects?|disciplines?|departments?)?\s*:?\s*((?:{SUBJECT}(?:,?\s*(?:and|or)?\s*)?)+)', sentence)
    if found:
        credits = num(found.group(1))
        for subject in re.findall(SUBJECT, found.group(2)):
            add(f'At least {credits} credits from {subject}', [c for c in pool if subject_of(c) == subject], min=credits)
        if out:
            return out

    # 3 credits from each of Blocks A, B and C / from each group / at most 3 credits from each category.
    found = re.search(rf'(?i)\b(\d+(?:\.\d+)?)\s+credits?\s+(?:must be\s+)?(?:taken\s+|selected\s+|chosen\s+)?(?:from|in)\s+each(?:\s+of)?(?:\s+the)?(?:\s+\w+)?(?:\s+{LIST_WORD})?\b', sentence)
    # "From each of any three subject areas" doesn't say which, so that's for the student to check.
    if found and len(lists) > 1 and not re.search(r'(?i)\beach of any\b', sentence):
        credits = num(found.group(1))
        is_max = re.search(rf'(?i)\b{MAX_WORDS}\s*$', sentence[:found.start()])
        for i, course_list in enumerate(lists):
            name = course_list['label'] or f'list {i + 1}'
            add(f'{"At most" if is_max else "At least"} {credits} credits from {name}', course_list['courses'], **({'max': credits} if is_max else {'min': credits}))
        return out
    if found and re.search(r'(?i)\beach of any\b', sentence):
        return out

    # Limits on a list by its name: "at least 9 credits must be taken from the Basic Life Sciences List".
    found = re.search(r'(?i)\b(at least|at most|a minimum of|a maximum of|no more than)\s+(\d+(?:\.\d+)?)\s+credits?\s+(?:\w+\s+){0,3}?from\s+the\s+([\w&\' -]+?)\s+(?:list|group|block)\b', sentence)
    if found:
        name = found.group(3).lower()
        is_max = re.match(MAX_WORDS, found.group(1), re.I)
        credits = num(found.group(2))
        for course_list in lists:
            if name in (course_list['label'] or '').lower():
                add(f'{"At most" if is_max else "At least"} {credits} credits from {course_list["label"]}', course_list['courses'], **({'max': credits} if is_max else {'min': credits}))
        if out:
            return out

    # Limits on a named list.
    found = re.search(rf'(?i)\b({MIN_WORDS}|{MAX_WORDS})\s+(\d+(?:\.\d+)?)\s+credits?\b[^.]*?\b(?:from|in)\s+{LIST_WORD}\s+([A-Z0-9])\b', sentence)
    if found:
        for course_list in lists:
            if re.search(rf'\b{found.group(3)}\b\s*(?:[:(]|$)', course_list['label'] or ''):
                is_max = re.match(MAX_WORDS, found.group(1), re.I)
                credits = num(found.group(2))
                add(f'{"At most" if is_max else "At least"} {credits} credits from {course_list["label"]}', course_list['courses'], **({'max': credits} if is_max else {'min': credits}))
        if out:
            return out

    # At least 9 of the 15 credits at the 400 level or higher / a maximum of 12 credits at the 200 level.
    levels = level_filter(sentence)
    if levels:
        test, words = levels
        if re.search(r'(?i)\bat least one course\b', sentence):
            add(f'At least one course {words}', [c for c in pool if test(level_of(c))], min=1)
            if out:
                return out
        found = re.search(rf'(?i)\b({MIN_WORDS}|{MAX_WORDS})\s+(\d+(?:\.\d+)?)\b', sentence)
        if not found:
            found_plain = re.search(r'(?i)\b(\d+(?:\.\d+)?)\s+(?:of\s+(?:the|these)\s+(?:\d+\s+)?)?(?:credits?\s+)?(?:(?:of\s+)?which\s+)?(?:\w+\s+){0,3}?(?:must|should|have to|need to|will)\s+be\b', sentence)
            if found_plain:
                credits = num(found_plain.group(1))
                add(f'At least {credits} credits {words}', [c for c in pool if test(level_of(c))], min=credits)
                return out
        if found:
            is_max = re.match(MAX_WORDS, found.group(1), re.I)
            credits = num(found.group(2))
            add(f'{"At most" if is_max else "At least"} {credits} credits {words}', [c for c in pool if test(level_of(c))], **({'max': credits} if is_max else {'min': credits}))
            if out:
                return out

    # Limits on subjects or named courses: "no more than 6 credits from COMP", "at least 3 credits from MATH 240, MATH 235".
    found = re.search(rf'(?i)\b({MIN_WORDS}|{MAX_WORDS})\s+(\d+(?:\.\d+)?)\s+credits?\b', sentence)
    if found:
        rest = sentence[found.end():]
        is_max = re.match(MAX_WORDS, found.group(1), re.I)
        credits = num(found.group(2))
        codes = CODE_IN.findall(rest)
        if codes:
            add(f'{"At most" if is_max else "At least"} {credits} credits from {", ".join(dict.fromkeys(codes))}', codes, **({'max': credits} if is_max else {'min': credits}))
            return out
        subjects = re.findall(SUBJECT, rest)
        if subjects:
            names = ', '.join(dict.fromkeys(subjects))
            add(f'{"At most" if is_max else "At least"} {credits} credits from {names}', [c for c in pool if subject_of(c) in subjects], **({'max': credits} if is_max else {'min': credits}))
            if out:
                return out
    return out

# Words that make a sentence a rule worth showing, even when we can't check it automatically.
RULE_WORDS = re.compile(r'(?i)\b(at least|a maximum|maximum of|minimum of|no more than|not more than|at most|not both|only one|from each|must include|must be from|must be at)\b')
NOT_A_COURSE_RULE = re.compile(r'(?i)\b(grade|graded|gpa|cgpa|average|year of|consult|adviser|advisor|admission|admitted|apply|applying|application|term|summer|residency|french|english|credits? earned|transfer|permission|program requirement|research paper|themes?)\b')

def part_rules(part, lines, following=()):
    """Rules from the part's own text. Sentences we can't turn into a check keep their words."""
    # A heading without credits belongs to the part before it ("Group C" under "24 credits from...").
    lists = part['lists'] + [{**course_list, 'label': course_list['label'] or other['title']} for other in following for course_list in other['lists']]
    pool = sorted({c for course_list in lists for c in course_list['courses']})
    rules, seen = [], set()
    for line in lines:
        for sentence in SENTENCE.split(line):
            whole = sentence.strip()
            sentence = plain_numbers(whole)
            if not RULE_WORDS.search(sentence) and not re.search(r'(?i)\bbut not\b', sentence):
                continue
            # "At least 6 credits from:" just heads its list, which already has those credits.
            if sentence.endswith(':') and not level_filter(sentence):
                continue
            found = []
            several_lists = len(re.findall(rf'(?i)\bcredits?\s+(?:must be\s+)?(?:from|in)\s+(?:the\s+)?{LIST_WORD}\s+[A-Z0-9]\b', sentence)) > 1
            clauses = [sentence] if len(CODE_IN.findall(sentence)) >= 2 or several_lists else CLAUSE.split(sentence)
            for clause in clauses:
                found += rule_from(clause, pool, lists)
            for rule in found:
                if rule['text'] not in seen:
                    seen.add(rule['text'])
                    rules.append(rule)
            if not found and not NOT_A_COURSE_RULE.search(whole) and len(whole.split()) <= 40 and whole not in seen:
                seen.add(whole)
                rules.append({'text': whole})
    return rules

def add_rules(programs, lines_of):
    stats = collections.Counter()
    for program in programs:
        # A heading with text but no courses of its own introduces the lists after it.
        carried = []
        for part_index, part in enumerate(program['parts']):
            lines = carried + lines_of.get((program['id'], part_index), [])
            if not part['lists']:
                carried = lines
                continue
            carried = []
            following = []
            for later in program['parts'][part_index + 1:]:
                if later['credits']:
                    break
                following.append(later)
            rules = part_rules(part, lines, following if part['credits'] else ())
            if rules:
                part['rules'] = rules
                for rule in rules:
                    stats['checked' if 'courses' in rule else 'by hand'] += 1
    return stats
