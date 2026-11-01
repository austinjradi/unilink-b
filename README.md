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
| S1  | Class and classmate discovery           | Courses → Find courses; class page → Overview     | `services/classes.ts`, `shared/courseQuery.ts` |
| S2  | Group chat links                        | Class page → Group chats                          | `services/links.ts`, `class/GroupChats.tsx`   |
| S3  | Study session creation and invitations  | Class page → Study sessions; Home                 | `services/studySessions.ts`                   |
| S4  | Peer discussion board                   | Class page → Discussion                           | `services/board.ts`, `class/Discussion.tsx`   |
| A3  | Dates and deadlines                     | Calendar; class times on class page → Overview    | `services/calendar.ts`, `pages/Calendar.tsx`  |
| A4  | Grade calculator                        | Class page → Grades                               | `shared/grades.ts`, `class/Grades.tsx`        |
| A5  | Course info and grading scheme          | Class page → Overview and Grades                  | `services/courses.ts`                         |
| G2  | Integrations                            | Integrations page; Calendar → Sync                | `shared/ics.ts`, `db/catalogue.ts`            |
| G4  | Account sign-up and login               | Sign-in screens; Settings → Account               | `services/auth.ts`, `shared/validation.ts`    |
| ST2 | Assignment planner                      | Planner; Home                                     | `shared/planner.ts`, `services/planner.ts`    |

The yellow features, with what couldn't be fully built:

| ID  | Feature                              | Where in the app                         | Code                                          | Limits |
| --- | ------------------------------------ | ---------------------------------------- | --------------------------------------------- | ------ |
| A1  | Course, credit and grade tracking    | Academics → Course record                | `shared/academics.ts`, `services/academics.ts` | None |
| A2  | Degree requirements and planning     | Academics → Degree plan                  | `shared/degree.ts`, `db/programs.ts`          | **Sample programs only**: no McGill program data source exists yet |
| G3  | Notifications / email                | Bell in the sidebar; Profile → Notifications | `services/notifications.ts`              | **Email isn't delivered**: no mail server, so emails wait in an outbox |
| ST1 | Study mode                           | Study Mode tab; pill in the top bar      | `shared/studyMode.ts`, `services/studyMode.ts` | **Can't block websites**; runs only while a UniLink tab is open; no system Do Not Disturb in a browser |
| ST3 | To-do list                           | Home (first thing you see)               | `services/todos.ts`, `pages/Dashboard.tsx`    | None |

## UI design

The interface follows the team's wireframes in `A2Team.pdf`:

- **Top navigation:** pill tabs, and your goat avatar on the right.
- **Goat mascot:** customizable under Settings → Goat (`components/Goat.tsx`, `shared/goat.ts`).
- **Home:** today's tasks and deadline countdowns on the left, a cross-class discussion feed with 🐐
  reactions in the middle, and filters on the right.
- **Threads:** one list of replies, with the accepted answer pinned first.
- **Grade Calculator:** a "You need at least X%" bubble and a scenarios table.
- **Calendar & Planner:** Month, Week and Semester views.
- **Group chat links:** cards with Open/Report buttons.
- **Study Sessions:** your upcoming sessions, plus a search page.
- **Study Mode:** its own tab, with a pill in the top bar while it's on.
- **Settings:** sections down the side.

The design uses rounded fonts (Nunito, with Fredoka for headings), bundled locally through Fontsource, and
works in light and dark mode.

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

Three classmates are listed on the sign-in screen with the password `unilink-demo1` (every demo classmate
uses it). Signing in as one of them shows a student mid-term: five classes, a course record going back a year
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

The site needs HTTPS (or `localhost`) only for system notifications; everything else also works over plain
HTTP, e.g. from a phone on the same network with `npm run dev -- --host`.

## Stack

- **React 19 + TypeScript**, built with **Vite 8** as a static site
- **Mantine 9** UI components, **TanStack Query** for data fetching, **React Router** (hash routing)
- **Drizzle ORM** on **SQLite compiled to WebAssembly** (sql.js), with the same SQL migrations in `drizzle/`
- **IndexedDB** for saving the database file and attachments between visits
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
| S1 note | When do classmates become visible, and what's shown? | Name and email, once they post, reply or join a study session | **Only posting or replying** reveals someone (joining a session doesn't). Shown: name, email, **pronouns and faculty**. The class page lists the classmates you can see |
| S2.1 | What's shown per link? | Platform, name, who added it, when | Platform, name, who added it, **what it's for** (whole course, this section, project team, study group), and **how many classmates say it works** and when it was last checked |
| S2.2 | Private first, then public? | Yes: private to whoever adds it until they share it | **No:** links are shared with the section as soon as they're added |
| S2.2 | Duplicates | Same URL in the same class, after light normalization | Same **chat** (invite code), under any of its URLs (`discord.gg/x` = `discord.com/invite/x`, tracking parameters ignored), across **every section of the course**. The error says who shared it and where |
| S2.4 | How are flagged links handled? | Reports are shown on the link; at 3 it's marked likely broken; changing the URL clears them | Classmates vote **"it works" or report** (with a reason). A link is **hidden** once 2+ report it and reports outnumber "works"; the owner is notified then and can **mark it fixed** without changing the URL |
| S3 | Who can see a session? | Everyone in the class | **Open** to the section, or **invite-only** (hidden from anyone without the code) |
| S3.4 | How do you invite if members are hidden? | By McGill email (must be in the class) | With a 6-character **invite code** the host shares anywhere (group chat, DM). Codes can be regenerated. No email invites |
| S3 | Size limit | Optional; full sessions refuse new people | **Required** (2–30, default 6); once full, people join a **waitlist** and move up automatically |
| S3 | Where | A place or call link, in one text field | **In person** (a place) or **online** (a meeting link, shown only to people going) |
| S3 | Who's going | Everyone sees names and emails of people going | **Only people going** see who else is; others see a count and the host's first name |
| S3.5 | Host leaves; session changes | Hosts can't leave, only cancel. Edits don't notify | Leaving **hands the session to the next person going** (cancelled only if nobody's left). Moving the time or place **notifies everyone in it** |
| S4 | Post types and topics | Free-form "type" with suggestions (Assignment, Midterm, Just yapping…) | Posts are a **question or a note**, under a **fixed topic list** (Lectures, Assignments, Exams, Labs and tutorials, Logistics, Off-topic) |
| S4 | Replies | Threaded, one level of replies to replies | **One flat list.** Whoever asked can **accept an answer**: it's pinned first, the question shows as answered, and the feed can filter to unanswered questions |
| S4 | Deleting a post | Deletes its replies too | A post **with replies is blanked** and the thread stays; one without replies is removed |
| A3 | Whose class times and deadlines? | Personal: each student enters their own | **Shared with the section**: one person enters the lecture times or a class deadline and everyone sees it. Deadlines with no class stay private; each student checks deadlines off separately; only whoever added a deadline can edit it |
| A5 | Whose course details? | Personal ("only you see these") | Professor, email, office hours and room are **shared, wiki-style** (anyone in the section edits; "edited by Priya 2 days ago"). Notes stay private |
| A4/A5 | Whose grading scheme? | Personal, with your scores | The scheme is **shared by the section**; **marks are private**. A component can't be removed once a classmate has a mark on it, and the scheme can't add up to more than 100% |
| A4 | Weights that don't add up to 100% | Grades are scaled up to the listed total | The missing weight counts as **work still to come** (not scaled), so "what you need" covers it too |
| G4.1 | Password requirements? | 8+ characters with a letter and a number | **Passphrases:** 12+ characters, no character rules, but **not a common password** and **not your own name** from your email |
| G4.1/5 | Which profile info? | Name, email (read-only), program, year, daily study time | Name, **pronouns** (optional), **faculty**, **expected graduation**. Email **can be changed** with your password |
| G4.4 | How does password reset work? | 6-digit code by email (shown on screen in the demo), valid 15 minutes | A **recovery code** shown once at sign-up (and replaced after each use, or from Settings). No reset emails |
| G4.7 | What happens to shared things when you delete your account? | Everything you created is deleted | Your data is deleted; you can choose to **leave your posts and replies up without your name** ("Former student"). Class times, deadlines and schemes you added to a section stay with it. Sessions you host pass to the next person going |
| ST2 | What is "free time"? | One daily study budget (default 120 min) minus other tasks and sessions | **Free minutes per weekday** (default 90 Mon–Thu, 60 Fri, 180 weekends) minus other tasks and sessions you're going to |
| ST2 | How is work spread? | Evenly over the days before the deadline, 1 buffer day | **As early as possible** (each task on the first day with room), **2 buffer days** by default. Missed tasks move to the next free time |

The yellow features (A1, A2, G3, ST1, ST3) keep version A's decisions, adjusted where they touch the above:
notifications cover waitlist spots, host hand-offs, session changes, accepted answers and hidden links instead of
invitations and individual reports; study mode follows the section's shared class times.

### Where the decisions live

| Decision | Code |
| --- | --- |
| Sections, wildcard search, classmate visibility | `db/catalogue.ts` (`sectionsFor`), `services/classes.ts`, `shared/courseQuery.ts` |
| Link identity, purposes, hiding rule | `shared/links.ts`, `services/links.ts` |
| Invite codes, waitlist, hand-off | `services/studySessions.ts` |
| Questions, accepted answers, topics, deleted posts | `services/board.ts`, `components/Feed.tsx` |
| Shared section info and private marks | `services/courses.ts`, `services/calendar.ts` (`visibleDeadlines`), `db/schema.ts` (`class_details`, `assessment_scores`, `deadline_done`) |
| Unlisted weight | `shared/grades.ts` |
| Passphrases, recovery codes, deletion | `shared/validation.ts`, `services/auth.ts`, `services/access.ts` (`formerStudentId`) |
| Free time per weekday, front-loaded plans | `shared/planner.ts`, `services/planner.ts` |

The database changes are migrations `0004_version_b` (new tables and columns) and `0005_version_b_cleanup`
(columns and tables B no longer uses).

## Not built yet

- **A shared server.** Data lives in each visitor's browser, so classmates are only shared between accounts in
  the same browser. The RPC layer is the seam: move `src/main` behind an HTTP API and point
  `window.unilink.call()` (in `web/bridge.ts`) at it.
- **Email delivery (G3).** Notification emails are written to an `outbox` table and can be viewed under
  Settings → Notifications → Email outbox. (Password resets don't need email in version B.)
- **Website blocking (ST1).** Needs a browser extension that asks UniLink whether study mode is on. Study mode
  only runs while a UniLink tab is open.
- **Program data (A2).** The three programs in `db/programs.ts` are illustrative samples, not official McGill
  requirements. Like the course catalogue, real data needs an eCalendar import.
- **Live integrations (G2).** Google Calendar and myCourses use `.ics` export/import. The course catalogue
  is a built-in sample (`db/catalogue.ts`), not the full McGill eCalendar.
- **Two tabs saving at the same instant.** The last save wins. A save takes milliseconds, so this only
  happens by accident.
