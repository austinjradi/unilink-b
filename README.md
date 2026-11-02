# UniLink (web), version B

UniLink for McGill students, running entirely in the browser: find your classes and classmates, share group
chats, host study sessions, discuss course topics, and keep deadlines, grades and assignment plans in one place.

**Version B** is a second take on the UniLink web port ([`unilink-web`](https://github.com/austinjradi/unilink-web), "version A", [live here](https://austinjradi.github.io/unilink-web/)). It has the same features,
the same look and the same code layout, but makes different decisions everywhere the requirements board leaves
something open: what a class is, who sees what, how study sessions fill up, how the discussion board works,
whether course info is personal or shared, how passwords are reset, and what "free time" means to the planner.
[Decisions compared](#decisions-compared-version-a-vs-version-b) lists every one side by side. `git diff 73f42b5`
shows exactly how B differs from A.

Like A, it's a static website with no server: the app's backend runs inside the page, and everything is saved in
the visitor's own browser. B keeps its data under its own name (IndexedDB `unilink-b`), so both versions can run
on the same site without touching each other's data.

It implements the ten in-scope ("green") features from the UniLink requirements board, plus the five
"if time allows" ("yellow") ones listed further down:

| ID  | Feature                                 | Where in the app                                  | Code                                          |
| --- | --------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| S1  | Class and classmate discovery           | Courses → Find courses (search, or paste your Minerva schedule); class page → Overview | `services/classes.ts`, `shared/courseQuery.ts` |
| S2  | Group chat links                        | Class page → Group chats                          | `services/links.ts`, `class/GroupChats.tsx`   |
| S3  | Study session creation and invitations  | Class page → Study sessions; Home                 | `services/studySessions.ts`                   |
| S4  | Peer discussion board                   | Class page → Discussion                           | `services/board.ts`, `class/Discussion.tsx`   |
| A3  | Dates and deadlines                     | Calendar (Key dates view; Add → Dates from a syllabus); class times on class page → Overview | `services/calendar.ts`, `pages/Calendar.tsx`, `shared/keyDates.ts`, `shared/syllabus.ts` |
| A4  | Grade calculator                        | Class page → Grades                               | `shared/grades.ts`, `class/Grades.tsx`        |
| A5  | Course info and grading scheme          | Class page → Overview and Grades                  | `services/courses.ts`                         |
| G2  | Integrations                            | Integrations page; Calendar → Sync                | `shared/ics.ts`, `db/catalogue.ts`            |
| G4  | Account sign-up and login               | Sign-in screens; Settings → Account               | `services/auth.ts`, `shared/validation.ts`    |
| ST2 | Assignment planner                      | Planner (attach the handout to split it by question); Home | `shared/planner.ts`, `shared/assignment.ts`, `services/planner.ts` |

The yellow features, with what couldn't be fully built:

| ID  | Feature                              | Where in the app                         | Code                                          | Limits |
| --- | ------------------------------------ | ---------------------------------------- | --------------------------------------------- | ------ |
| A1  | Course, credit and grade tracking    | Courses → Course record (add by hand, from your classes, or by pasting a transcript) | `shared/academics.ts`, `shared/transcript.ts`, `services/academics.ts` | None |
| A2  | Degree requirements and planning     | Academics → Degree plan                  | `shared/degree.ts`, `db/programs.ts`          | **Sample programs only**: no McGill program data source exists yet |
| G3  | Notifications / email                | Bell in the sidebar; Profile → Notifications | `services/notifications.ts`              | **Email isn't delivered**: no mail server, so emails wait in an outbox |
| ST1 | Study mode                           | Study Mode tab; pill in the top bar      | `shared/studyMode.ts`, `services/studyMode.ts` | **Can't block websites**; runs only while a UniLink tab is open; no system Do Not Disturb in a browser |
| ST3 | To-do list                           | Home (first thing you see); a date typed at the end ("read chapter 3 friday") becomes the due date | `services/todos.ts`, `pages/Home.tsx`, `shared/taskDate.ts` | None |

## Professors

Beyond the requirements board, a section can have a professor. Signing up as **Professor** takes a `@mcgill.ca`
email (students have `@mail.mcgill.ca`), and **Teach** on a section puts their name on it. They can teach several
sections of a course. The demo has **Daniel Ouellet**, a made-up professor teaching both COMP 251 sections, with a
posted assignment, a pinned announcement and a reported thread waiting in COMP 251-001.

| A professor can | Where | How it works |
| --- | --- | --- |
| Run the grading scheme, course details and class times | Class page → Grading scheme, Overview | Sections are wiki-style until a professor teaches them; then only the professor can change these, and students see them read-only. Students are told when the scheme changes, once a day at most. If the last professor leaves, it's wiki-style again |
| Post assignments with a handout | Class page → Assignments (new tab) | A class deadline with instructions and a file, on everyone's calendar. Everyone's notified, and again if the due date moves. A weight adds it to the scheme. **Plan it** brings the handout and its problems into the student's plan, which follows the assignment's date |
| Moderate the discussion | Class page → Discussion | **Pin** to the top of the class board, **lock** a thread so only they can reply, **endorse** a reply, or **remove** a post or reply with an optional reason. The author is told. A removed post with replies stays up, blanked |
| Hear about problems | Notifications; Discussion → Filters | Students can **report** a post or reply. The professor sees the reason, never who gave it, and a "Reported by students" filter, and can remove it or dismiss the report. Nobody else can tell it was reported |
| Make announcements | New post → Announcement | A note from a professor to the whole section notifies everyone |
| Correct class deadlines | Calendar | They can edit or remove a class deadline a student added, not private ones |
| See how an assignment is going | Class page → Assignments | How many students checked it off, as a count only, and only in sections of 5 or more so it can't point at anyone |
| Hold office hours | Study Sessions | A session with the Office hours type, weekly if they like. It and any group chat link they add are tagged as theirs |
| Send an assignment out later | Assignments | Written now, it stays hidden from students, with no notification, until the time set or **Send it out now** |
| Teach several sections at once | Assignments, New post, Grading scheme | An assignment or announcement can **also post to** their other sections, and a scheme can be **copied to a section** that has none (never over one with marks) |

What stays private: **students' marks**, which professors never see, and **private posts**, which they see only if a
student picks them as the audience. There's no class list for them either: students appear once they post or reply,
as they do for each other (S1). Group chat links stay editable only by whoever added them, as S2.5 requires. Planner,
Calculator, Study Mode, the course record and the degree plan are hidden for professors.

**Limits:** nothing checks that someone is really a professor, since there's no mail server to verify a `@mcgill.ca`
address and no McGill login, so a real deployment needs one of those first. A handout lives in the browser that
uploaded it, like everything else here. Students can't hand work in; assignments go one way.

## UI design

The interface follows the team's wireframes in `A2Team.pdf`:

- **Top navigation:** pill tabs, and your goat avatar on the right. On phones and small tablets the tabs move into a menu. The search icon (or
  Ctrl/Cmd+K) searches your classes, posts and replies, deadlines, graded work, study sessions, plans and group chats at once,
  and only what you could already see elsewhere (`services/search.ts`).
- **Goat mascot:** customizable under Settings → Goat (`components/Goat.tsx`, `shared/goat.ts`).
- **Home:** a checklist of first steps for a new account, ticked off as they're done; today's tasks and deadline countdowns on the left, a cross-class discussion feed with 🐐
  reactions in the middle, and filters on the right.
- **Threads:** one list of replies, with the accepted answer pinned first, and a Follow button for reply notifications. Posts and replies you haven't sent are kept as drafts on this device, per account. A classmate's name opens their
  profile card; the feed sorts by newest or most 🐐, and posts since your last visit to a class are marked New
  (counted on its course card).
- **Grade Calculator:** a "You need at least X%" bubble and a scenarios table, and below them every class this term with a
  projected term GPA and CGPA on McGill's scale. A component made of many small marks takes them all at once ("8/10 9/10 7/10"),
  counting only the best ones if the syllabus drops the rest.
- **Calendar & Planner:** Month, Week, Semester and Key dates views, with a chip per class to show or hide it. Pick any day to list everything on it; on phones
  the month shows a coloured dot per event. The Google Calendar export can include your planned tasks, as all-day events.
- **Courses:** each class card shows the next lecture, the next thing due and unanswered questions; a class's
  Overview lists what's coming up in it.
- **Group chat links:** cards with Open/Report buttons.
- **Study Sessions:** your upcoming sessions, plus a search page you can filter by class, format, free spots and date. A session
  or a poll's time that overlaps one of your classes or another session you're going to says so (`busyChecker` in `services/calendar.ts`). A
  section's tab can also **find a time**: offer two to five times, classmates tick the ones that work, and only the counts show.
  Picking one sets up the session and tells everyone who answered, who then choose whether to join (`services/timePolls.ts`).
- **Study Mode:** its own tab, with a pill in the top bar while it's on. A planned task (on Home or the Planner) can start a
  **focus session as long as the task is meant to take**, and when it ends the app asks whether you finished it.
- **Degree plan:** which of your courses count and what's left, with the **credits a term** it takes to graduate in your expected year.
- **Course record:** credits and CGPA, plus a **CGPA goal**: type the CGPA you're aiming for and see what your next credits
  have to average, or how far straight A's would get you if it's out of reach (`goalOutlook` in `shared/academics.ts`).
- **Settings:** sections down the side.

The design uses rounded fonts (Nunito, with Fredoka for headings), bundled locally through Fontsource, and
works in light and dark mode. Text meets WCAG AA contrast in both (the colours are set in `theme.ts`), controls have accessible names,
and keyboard users get a skip link.

## Getting started

Needs Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload
```

Other scripts:

```bash
npm test           # unit + integration tests (plain Node; SQLite runs through sql.js)
npm run typecheck
npm run build      # static site in dist/
npm run preview    # serve dist/ at http://localhost:4173
npm run db:generate  # create a migration after editing src/main/db/schema.ts
```

Every visitor starts in a busy Fall 2026 term: about 130 demo classmates spread over the catalogue's sections,
and around 30 sections with shared course details, class times, grading schemes and deadlines, a discussion
board with answered and open questions, group chats classmates vouch for (and one hidden after reports), and
study sessions: open, full with a waitlist, online, invite-only, and some already over. Everything lives in
`db/demoContent.ts`; `db/demo.ts` turns it into rows, with dates relative to the first visit.

Three classmates and a professor are listed on the sign-in screen with the password `unilink-demo1` (every demo
account uses it). Signing in as one of them shows a student mid-term: five classes, a course record going back a year
and a degree program (A1–A2), marks on each section's scheme (A4), assignments broken into planned tasks
(ST2), to-dos (ST3), private deadlines, and notifications about replies and accepted answers (G3).

Or sign up with any `@mail.mcgill.ca` address and join a section, **COMP 251-001** for the most going on.
Alex's invite-only "Midterm review" session there doesn't show up until you enter its code, `ALEXMT`.
**Reset demo data** under the demo list wipes everything saved in the browser and starts over. Browsers that
already had an older, smaller demo get the new classmates and sections added on their next visit.

To see the social features from both sides, open a second tab, sign out there and sign in as another
classmate. The tabs keep each other up to date.

## Deploying

`dist/` is plain static files with relative paths and hash routing, so any static host works without
configuration: GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any web server.

- **GitHub Pages:** push this repository to GitHub, then under Settings → Pages set the source to
  "GitHub Actions". `.github/workflows/deploy.yml` tests, builds and publishes every push to `main`.
- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`, output directory `dist`.
- **Anywhere else:** run `npm run build` and upload the contents of `dist/`.

The site needs HTTPS (or `localhost`) for system notifications, and to work offline and install to a home screen;
everything else also works over plain HTTP, e.g. from a phone on the same network with `npm run dev -- --host`.

**Backups:** with no server, a browser's copy is the only copy. Settings → Privacy downloads everything in the browser
(the database and attachments) as one file, without anyone's sign-in, and it can be restored there or from the sign-in
screen on another computer. Restoring replaces what's there, after checking the file (`shared/backup.ts`).
The site also asks the browser not to clear its data for space (`navigator.storage.persist()`), suggests a backup once a month, and shows a
warning with a backup button if saving ever fails, for instance in some private windows or with full storage.

**Offline:** since everything a visitor saves is already in their browser, the built site keeps working with no
connection after one visit, and can be installed like an app (`public/manifest.webmanifest`). The service worker
(`src/web/sw.js`, its file list filled in by `vite.config.ts`) always tries the network for the page itself, so a
new deploy takes over on the next load. A tab left open across a deploy reloads itself if it needs a file that's gone.

## Stack

- **React 19 + TypeScript**, built with **Vite 8** as a static site
- **Mantine 9** UI components, **TanStack Query** for data fetching, **React Router** (hash routing)
- **Drizzle ORM** on **SQLite compiled to WebAssembly** (sql.js), with the same SQL migrations in `drizzle/`
- **IndexedDB** for saving the database file and attachments between visits
- **pdf.js** reads attached assignment PDFs (loaded only when one is attached)
- **zod** validates every call; **Vitest** for tests; **@noble/hashes** for scrypt password hashing

## How it fits together

The code is the desktop app's, with the Electron parts swapped for browser ones. Folder names are kept so
changes can be compared and copied between the two projects (`diff -r ../unilink/src src`).

```
src/
  main/            the desktop app's "main process", here running inside the page
    db/            schema.ts (all tables), client.ts (open + migrate), migrations.ts, catalogue + demo seed data
    rpc/           core.ts (procedure/dispatch helpers), router.ts (the whole API)
    services/      one file per feature area; each exports a router of procedures
    crypto.ts      the hashing and random helpers node:crypto provided
  web/             what replaces Electron
    bridge.ts      sets up window.unilink: opens the database, runs the background tick, saves after changes
    platform.ts    file picker, downloads, opening attachments, notifications
    storage.ts     IndexedDB
    node/          browser stand-ins for node:fs/promises and node:path (aliased in vite.config.ts)
  renderer/src/    React app: pages/, components/, lib/rpc.ts (typed client)
  shared/          pure logic used by both sides: grades, planner, links, ics, validation, dates
    i18n/          translate(), plural English forms (en.ts), French dictionary (fr/*.json)
tests/             shared.test.ts (pure logic), services.test.ts (real router + in-memory SQLite),
                   i18n.test.ts (every UI string has a French translation)
```

The renderer calls the backend through a small tRPC-style layer. A procedure is declared once in a service:

```ts
join: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => { … })
```

The renderer calls it as `rpc.classes.join({ classId })`, fully typed from that declaration. In the desktop
app every call crosses one IPC channel; here `window.unilink.call()` dispatches straight to the router in the
same page. Either way it's validated with zod and runs as the signed-in user (`ctx.userId`). Errors come back
as `{ code, message, key, params }` and show up as notifications, translated in the renderer.

### What changed from the desktop app

| Desktop (Electron) | Web |
| --- | --- |
| better-sqlite3, a file in the user data folder | sql.js (SQLite in WebAssembly). The whole database file is saved to IndexedDB after every change |
| `node:crypto` scrypt | `@noble/hashes` scrypt with Node's default settings, so password hashes have the same format |
| Native open/save dialogs, files on disk | A file picker; exports download; attachments are stored in IndexedDB and open in a new tab |
| Desktop notifications | A toast in the page, or a system notification when the tab is in the background and the site has permission |
| GNOME Do Not Disturb (ST1) | Not available |
| Demo classmates in dev builds only | Always on, plus **Reset demo data** |
| One app window | Any number of tabs; each saved change is sent to the others, and each tab keeps its own sign-in |

In version A, only `services/auth.ts`, `services/planner.ts` (one import), `db/client.ts` and `db/demo.ts` differ
in `src/main`; version B's own decisions change much more (see below). In the renderer, the sign-in screen has the reset link, and the header scrolls on phones.

### Languages (English and French)

Language is chosen on the sign-in screen or under Settings → General, and saved on the account, so
notifications and emails go out in the same language. The English text is the translation key:

```tsx
<Text>{t('Add a deadline')}</Text>
<Text>{t('{{count}} credits', { count })}</Text>   // plural: needs `_one` / `_other` forms
```

- `t()` translates now, `tx()` only marks a string for translation (for labels in constants).
- English plural forms live in `shared/i18n/en.ts`; every French string lives in `shared/i18n/fr/*.json`.
- The main process stores messages as `{ key, params }` (notifications, errors) so they can be shown in
  whichever language the reader picks. Errors are `new AppError('English text', code, params)`.
- `node scripts/i18n-keys.mjs` lists strings that are missing a French translation. `npm test` fails if
  any are missing, if placeholders don't match, or if the French file has entries nothing uses.
- User content (posts, titles, course names from the catalogue) isn't translated.

## Decisions compared: version A vs version B

The requirements board specifies the features but leaves many details open, either as explicit questions or by
not saying. Each row is one of those choices. Everything the board *does* specify (McGill email sign-up, joining
many classes but each once, no member list, owner-only link edits, links opening in a new tab, posts visible to
the class or selected students, the McGill grading system, deleting the account and its data…) is the same in
both versions.

| Requirement | Left open | Version A (`unilink-web`) | Version B (this project) |
| --- | --- | --- | --- |
| S1.2 | Is "COMP 251" one class, or one per term/section? | One class per course per term; sections share it | **One class per section** ("COMP 251-001"). You can be in one section of a course per term; *Switch section* moves you. Each section has its own board, chats, sessions and shared info |
| S1.1 | Search by code, name, other filters? | Code or title, plus term and subject filters | **Code wildcards** like the board's "COMP 2XX" (X, \* or ? = any digit), title words, plus term and **course level** filters |
| S1.1 | Anything about when a section meets? | No | Search and the section's page show its **class times** (as its classmates entered them) and **warn when they clash** with your other classes that term. Joining is still allowed |
| S4 | Who can be picked as a post's audience? | Anyone in the class, by email | Only **classmates you can already see** (who've posted or replied). Anyone else gets the same answer, so typing emails can't reveal who's in the class |
| S1 note | When do classmates become visible, and what's shown? | Name and email, once they post, reply or join a study session | **Only posting or replying** reveals someone (joining a session doesn't). Shown: name, email, **pronouns and faculty**. The class page lists the classmates you can see |
| S2.1 | What's shown per link? | Platform, name, who added it, when | Platform, name, who added it, **what it's for** (whole course, this section, project team, study group), and **how many classmates say it works** and when it was last checked |
| S2.2 | Private first, then public? | Yes: private to whoever adds it until they share it | **No:** links are shared with the section as soon as they're added |
| S2.2 | Duplicates | Same URL in the same class, after light normalization | Same **chat** (invite code), under any of its URLs (`discord.gg/x` = `discord.com/invite/x`, tracking parameters ignored), across **every section of the course**. The error says who shared it and where |
| S2.4 | How are flagged links handled? | Reports are shown on the link; at 3 it's marked likely broken; changing the URL clears them | Classmates vote **"it works" or report** (with a reason). A link is **hidden** once 2+ report it and reports outnumber "works"; the owner is notified then and can **mark it fixed** without changing the URL |
| S3 | Who can see a session? | Everyone in the class | **Open** to the section, or **invite-only** (hidden from anyone without the code) |
| S3.4 | How do you invite if members are hidden? | By McGill email (must be in the class) | With a 6-character **invite code** the host shares anywhere (group chat, DM), or a ready-made **invite message with a link** that opens the session with a Join button. Codes can be regenerated. No email invites |
| S3 | Size limit | Optional; full sessions refuse new people | **Required** (2–30, default 6); once full, people join a **waitlist** and move up automatically |
| S3 | Where | A place or call link, in one text field | **In person** (a place) or **online** (a meeting link, shown only to people going) |
| S3.1 | Sessions that meet every week? | Created one at a time | A session can **repeat weekly** (2–12 weeks). The weeks share one invite code, which joins every upcoming week; anyone can **join every week** from any of them; the host can cancel one week or that week and all later ones |
| S3 | Who's going | Everyone sees names and emails of people going | **Only people going** see who else is; others see a count and the host's first name |
| S3.5 | Host leaves; session changes | Hosts can't leave, only cancel. Edits don't notify | Leaving **hands the session to the next person going** (cancelled only if nobody's left). Moving the time or place **notifies everyone in it** |
| S4 | Post types and topics | Free-form "type" with suggestions (Assignment, Midterm, Just yapping…) | Posts are a **question or a note**, under a **fixed topic list** (Lectures, Assignments, Exams, Labs and tutorials, Logistics, Off-topic) |
| S4 | Replies | Threaded, one level of replies to replies | **One flat list.** Whoever asked can **accept an answer**: it's pinned first, the question shows as answered, and the feed can filter to unanswered questions |
| S4 | Anything besides text in a post? | Inline code | Code blocks and clickable links, and **up to 4 images** per post or reply (PNG, JPEG, GIF or WebP, 5 MB each), added or pasted as a screenshot. Images follow the post's visibility and go when it's deleted |
| S4 | Repeated questions | Nothing | While you write a title, the composer lists up to three **similar posts** in the class you can see (answered ones marked), so you can open the existing thread instead |
| S4 | Who hears about new replies? | The post's author | **Everyone following the thread**: posting or replying follows it, anyone who can see it can follow or unfollow (unfollowing sticks), and the feed can show only followed threads |
| S4 | Deleting a post | Deletes its replies too | A post **with replies is blanked** and the thread stays; one without replies is removed |
| A3 | Term key dates and final exams? | Not included | **Built in** (`shared/keyDates.ts`): McGill's 2026–27 key dates (classes start and end, add/drop, withdrawal with and without refund, reading breaks, exam period) on everyone's calendar, deadlines among them on Home; **no classes on breaks and holidays** (weekly class times skip them on the calendar, in the .ics export and for study mode); a **sample final exam schedule** per course, with your own finals on your calendar and each class page |
| A3 | "Imported from my syllabus in a later version" | Not built | **Read the course outline or any PDF, Word or text file, or paste the schedule**: lines with a date and something to hand in or write are found (English or French dates, times, weights) and reviewed before adding. Weighted ones join the section's grading scheme; the rest become class deadlines |
| A3 | Whose class times and deadlines? | Personal: each student enters their own | **Shared with the section**: one person enters the lecture times or a class deadline and everyone sees it. Deadlines with no class stay private; each student checks deadlines off separately; only whoever added a deadline can edit it |
| A5 | Whose course details? | Personal ("only you see these") | Professor, email, office hours, room and the **course outline file** are **shared, wiki-style** (anyone in the section edits; "edited by Priya 2 days ago"), until a [professor](#professors) teaches the section. Notes stay private |
| A4/A5 | Whose grading scheme? | Personal, with your scores | The scheme is **shared by the section**, or set by its [professor](#professors) if it has one; **marks are private**. A component can't be removed once a classmate has a mark on it (a professor can), and the scheme can't add up to more than 100% |
| A4/A5 | Courses graded on two schemes ("the final replaces the midterm if higher")? | Not supported | The section can add a **second scheme**, with its own weight per component; your grade is **whichever is higher**, and "what you need" and the scenarios use the better scheme for each target |
| A4 | Weights that don't add up to 100% | Grades are scaled up to the listed total | The missing weight counts as **work still to come** (not scaled), so "what you need" covers it too |
| G4.1 | Password requirements? | 8+ characters with a letter and a number | **Passphrases:** 12+ characters, no character rules, but **not a common password** and **not your own name** from your email |
| G4.1/5 | Which profile info? | Name, email (read-only), program, year, daily study time | Name, **pronouns** (optional), **faculty**, **expected graduation**. The McGill email stays the one you signed up with |
| G4.2 | What does "log in securely" mean beyond a hashed password? | Nothing more | **Five wrong passwords or recovery codes in a row pause sign-in for 15 minutes** (with a warning two tries before), and the next sign-in tells you how many attempts failed |
| G4.4 | How does password reset work? | 6-digit code by email (shown on screen in the demo), valid 15 minutes | A **recovery code** shown once at sign-up, and replaced with a new one after each reset. No reset emails |
| G4.7 | What happens to shared things when you delete your account? | Everything you created is deleted | Your data is deleted; you can choose to **leave your posts and replies up without your name** ("Former student"). Class times, deadlines and schemes you added to a section stay with it. Sessions you host pass to the next person going |
| ST2 | What is "free time"? | One daily study budget (default 120 min) minus other tasks and sessions | **Free minutes per weekday** (default 90 Mon–Thu, 60 Fri, 180 weekends) minus other tasks and sessions you're going to, and none on **days off** you pick, like a trip. **"Start from my class times"** fills them in: four hours on a day with no classes, less your time in class, at least an hour |
| ST2 | "Upload the file": what's done with it? | Kept with the plan, to open later | Kept, and **read** (PDF, Word or text): its numbered questions or problems are offered as tasks, with time shared out by their points |
| ST2 | How is work spread? | Evenly over the days before the deadline, 1 buffer day | **As early as possible** (each task on the first day with room), **2 buffer days** by default. Missed tasks move to the next free time |
| ST2 | "If a deadline moves, the plan adjusts": which deadline? | The plan's own due date, changed by hand | A plan can **start from a class deadline or graded item** and then **follows it**: when a classmate moves the shared date, the plan takes it, re-plans and notifies you. Picking your own date stops following. A plan due the same day as its class deadline is listed once |

The yellow features (A1, A2, G3, ST1, ST3) keep version A's decisions, adjusted where they touch the above:
notifications cover waitlist spots, host hand-offs, session changes, replies in followed threads, accepted answers,
hidden links and failed sign-ins instead of invitations and individual reports; study mode follows the section's shared class times.
McGill's **add/drop and withdrawal deadlines** remind students a week ahead and the day before. Students also get **one summary of the week ahead**, the first time they open the app after Sunday 16:00, listing what's due in
the next seven days (nothing if nothing is due; it can be turned off for desktop and email like the rest).

### Where the decisions live

| Decision | Code |
| --- | --- |
| Sections, wildcard search, classmate visibility, time clashes | `db/catalogue.ts` (`sectionsFor`), `services/classes.ts`, `shared/courseQuery.ts`, `shared/meetings.ts` |
| Link identity, purposes, hiding rule | `shared/links.ts`, `services/links.ts` |
| Invite codes, waitlist, hand-off, weekly series | `services/studySessions.ts` |
| Questions, accepted answers, topics, deleted posts, following threads, similar posts, images, formatting | `services/board.ts`, `components/Feed.tsx`, `shared/similar.ts`, `shared/postText.ts` |
| Shared section info and private marks | `services/courses.ts`, `services/calendar.ts` (`visibleDeadlines`), `db/schema.ts` (`class_details`, `assessment_scores`, `deadline_done`) |
| Unlisted weight, a second scheme | `shared/grades.ts`, `services/courses.ts` (`setSecondScheme`) |
| Passphrases, recovery codes, sign-in pauses, deletion | `shared/validation.ts`, `services/auth.ts`, `services/access.ts` (`formerStudentId`) |
| Free time per weekday, front-loaded plans | `shared/planner.ts`, `services/planner.ts` |
| Tasks from the assignment file | `shared/assignment.ts`, `shared/docx.ts`, `web/platform.ts` (`readText`) |
| Plans that follow a class deadline | `services/planner.ts` (`followMovedDeadlines`), `services/calendar.ts` (`collect`) |
| Professors: who can change what, assignments, moderation | `services/access.ts` (`canEditShared`, `requireTeacher`), `services/assignments.ts`, `services/board.ts` |

The database changes are migrations `0004_version_b` (new tables and columns), `0005_version_b_cleanup`
(columns and tables B no longer uses) `0006_planner_follows_deadlines` (what a plan follows) `0007_board_visits` (new posts since your last visit), `0008_reply_edits`, `0009_thread_follows`, `0010_sign_in_limits`, `0011_second_grading_scheme`, `0012_weekly_sessions`, `0013_professors`, `0014_board_images`, `0015_mute_replies`, `0016_days_off`, `0017_post_reports`, `0018_course_outline`, `0019_cgpa_goal`, `0020_focus_on_task`, `0021_time_polls`, `0022_several_marks`, `0023_weekly_todos` and `0024_assignment_release`.

## Not built yet

- **A shared server.** Data lives in each visitor's browser, so classmates are only shared between accounts in
  the same browser. The RPC layer is the seam: move `src/main` behind an HTTP API and point
  `window.unilink.call()` (in `web/bridge.ts`) at it.
- **Email delivery (G3).** Notification emails are written to an `outbox` table and can be viewed under
  Settings → Notifications → Email outbox. (Password resets don't need email in version B.)
- **Website blocking (ST1).** Needs a browser extension that asks UniLink whether study mode is on. Study mode
  only runs while a UniLink tab is open.
- **Official exam schedule (A3).** Key dates follow McGill's published 2026–27 dates (the Winter add/drop and
  withdrawal dates weren't out yet and are marked approximate). The final exam schedule is a sample; the real
  one is published per course during the term and would need an import, like the catalogue.
- **Program data (A2).** The three programs in `db/programs.ts` are illustrative samples, not official McGill
  requirements. Like the course catalogue, real data needs an eCalendar import.
- **Live integrations (G2).** Google Calendar and myCourses use `.ics` export/import. The course catalogue
  is a built-in sample (`db/catalogue.ts`), not the full McGill eCalendar.
- **Two tabs saving at the same instant.** The last save wins. A save takes milliseconds, so this only
  happens by accident.
