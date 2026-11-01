# UniLink (web)

UniLink for McGill students, running entirely in the browser: find your classes and classmates, share group
chats, host study sessions, discuss course topics, and keep deadlines, grades and assignment plans in one place.

This is the UniLink desktop app (Electron, in the `unilink` project) ported to a static website, so it can be shown to anyone with a link and
nothing to install. There's no server: the app's backend runs inside the page, and everything is saved in the
visitor's own browser.

It implements the ten in-scope ("green") features from the UniLink requirements board, plus the five
"if time allows" ("yellow") ones listed further down:

| ID  | Feature                                 | Where in the app                                  | Code                                          |
| --- | --------------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| S1  | Class and classmate discovery           | Classes page; class page → Overview               | `services/classes.ts`, `pages/Classes.tsx`    |
| S2  | Group chat links                        | Class page → Group chats                          | `services/links.ts`, `class/GroupChats.tsx`   |
| S3  | Study session creation and invitations  | Class page → Study sessions; Home                 | `services/studySessions.ts`                   |
| S4  | Peer discussion board                   | Class page → Discussion                           | `services/board.ts`, `class/Discussion.tsx`   |
| A3  | Dates and deadlines                     | Calendar; class times on class page → Overview    | `services/calendar.ts`, `pages/Calendar.tsx`  |
| A4  | Grade calculator                        | Class page → Grades                               | `shared/grades.ts`, `class/Grades.tsx`        |
| A5  | Course info and grading scheme          | Class page → Overview and Grades                  | `services/courses.ts`                         |
| G2  | Integrations                            | Integrations page; Calendar → Sync                | `shared/ics.ts`, `db/catalogue.ts`            |
| G4  | Account sign-up and login               | Sign-in screens; Profile                          | `services/auth.ts`, `pages/Auth.tsx`          |
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
- **Threads:** threaded replies.
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

Every visitor starts with three demo classmates in COMP 251 and MATH 240 (Fall 2026), listed on the sign-in
screen with the password `unilink-demo1`. Sign up with any `@mail.mcgill.ca` address to get your own account.
**Reset demo data** under that list wipes everything saved in the browser and starts over.

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

Only `services/auth.ts`, `services/planner.ts` (one import), `db/client.ts` and `db/demo.ts` differ in
`src/main`. In the renderer, the sign-in screen has the reset link, and the header scrolls on phones.

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

## Decisions on the board's open questions

| Requirement | Question on the board | What the app does |
| --- | --- | --- |
| S1.1 | Search by code, name, other filters? | Code (`COMP 251` or `comp251`) or title, plus term and subject filters |
| S1.2 | Is "COMP 251" one class or one per term/section? | One class per course per term; sections share it |
| S1 note | When are classmates visible? | No member list. Name and email show once someone posts, replies, or joins a study session |
| S2.1 | What info is shown per link? | Platform (auto-detected), name, who added it, when |
| S2.2 | Private first, then public? | Yes: links start private to whoever adds them; they can share with the class anytime |
| S2.2 | Duplicates | Rejected per class after normalizing the URL (http→https, trailing slash, #fragment) |
| S2.4 | How are flagged links handled? | Reports are shown on the link. At 3 reports it's marked as likely broken. The owner changing the URL clears them |
| S3.4 | How do you invite if members are hidden? | By McGill email (must be in the class), with suggestions from classmates you can already see |
| G4.1 | Password requirements? | 8+ characters with at least one letter and one number |
| G4.5–6 | Which profile info? | Name, email (read-only), program, year, and daily study time for the planner |
| ST2 | What is "free time"? | A daily study budget (default 120 min) minus other planned tasks and study sessions you're going to |
| A1 | Which grades count? | McGill letter grades count in the GPA (J counts as 0). P/S earn credits without GPA; F, J, U and W earn nothing |
| A2 | What counts toward a program? | Required courses plus "choose N credits" groups need C or better. Everything else that earns credit counts as electives |
| G3 | Which features notify? | Session invites, cancellations and start reminders; replies to your posts; reports on your links; deadlines within 24 h; a morning task summary; study mode on/off. Each can go to desktop and/or email |
| ST1 | When does study mode turn on? | During class times and study sessions you're going to (toggle each, plus per class), or a focus session started by hand. Stopping it skips the current class or session only |
| ST3 | What's "today"? | Planned work scheduled up to today, plus your own to-dos due today, overdue or undated. Upcoming deadlines come next, and your own can be checked off |

## Not built yet

- **A shared server.** Data lives in each visitor's browser, so classmates are only shared between accounts in
  the same browser. The RPC layer is the seam: move `src/main` behind an HTTP API and point
  `window.unilink.call()` (in `web/bridge.ts`) at it.
- **Email delivery (G3).** Emails (notifications, password reset codes) are written to an `outbox` table and
  can be viewed under Profile → Notifications → Email outbox. Reset codes are also shown on screen.
- **Website blocking (ST1).** Needs a browser extension that asks UniLink whether study mode is on. Study mode
  only runs while a UniLink tab is open.
- **Program data (A2).** The three programs in `db/programs.ts` are illustrative samples, not official McGill
  requirements. Like the course catalogue, real data needs an eCalendar import.
- **Live integrations (G2).** Google Calendar and myCourses use `.ics` export/import. The course catalogue
  is a built-in sample (`db/catalogue.ts`), not the full McGill eCalendar.
- **Two tabs saving at the same instant.** The last save wins. A save takes milliseconds, so this only
  happens by accident.
