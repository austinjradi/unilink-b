# UniLink

A desktop app for McGill students: find your classes and classmates, share group chats, host study sessions,
discuss course topics, and keep deadlines, grades and assignment plans in one place.

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
| ST1 | Study mode                           | Study mode page; sidebar chip            | `shared/studyMode.ts`, `services/studyMode.ts` | **Can't block websites**; runs only while the app is open; system Do Not Disturb on GNOME only |
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
- **Study sessions:** your upcoming sessions, plus a search page.
- **Settings:** sections down the side.

The design uses rounded fonts (Nunito, with Fredoka for headings), bundled locally through Fontsource, and
works in light and dark mode.

## Getting started

Needs Node 22+.

```bash
npm install        # also rebuilds the SQLite driver for Electron
npm run dev        # app with hot reload
```

Other scripts:

```bash
npm test           # unit + integration tests (run inside Electron's Node)
npm run typecheck
npm run build      # production build into out/
npm start          # run the production build
npm run db:generate  # create a migration after editing src/main/db/schema.ts
```

When run from source, the app seeds three demo classmates in COMP 251 and MATH 240 (Fall 2026) so the
social features have someone to interact with. The sign-in screen lists them; the password is
`unilink-demo1`. Sign up with any `@mail.mcgill.ca` address to get your own account.

### Linux: "The SUID sandbox helper binary was found, but is not configured correctly"

Ubuntu 23.10 and later block unprivileged user namespaces, so Electron falls back to its setuid
`chrome-sandbox` helper and aborts because that file isn't owned by root. Allow Electron dev builds through
AppArmor once per machine. This keeps the sandbox on and survives `npm install`:

```bash
sudo tee /etc/apparmor.d/electron-dev > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile electron-dev @{HOME}/**/node_modules/electron/dist/electron flags=(unconfined) {
  userns,
  include if exists <local/electron-dev>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/electron-dev
```

(Alternatively `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755
node_modules/electron/dist/chrome-sandbox`, but that has to be redone whenever Electron is reinstalled.)

The database lives in Electron's user data folder (`~/.config/unilink/unilink.db` on Linux). Delete it to
start fresh.

## Stack

- **Electron 45** with a sandboxed, context-isolated renderer
- **React 19 + TypeScript**, built with **electron-vite** (Vite 8)
- **Mantine 9** UI components, **TanStack Query** for data fetching, **React Router** (hash routing)
- **Drizzle ORM** on **SQLite** (better-sqlite3), with SQL migrations in `drizzle/`
- **zod** validates every call from the renderer; **Vitest** for tests

## How it fits together

```
src/
  main/            Electron main process (Node)
    db/            schema.ts (all tables), client.ts (open + migrate), catalogue + demo seed data
    rpc/           core.ts (procedure/dispatch helpers), router.ts (the whole API)
    services/      one file per feature area; each exports a router of procedures
                   (studyMode.ts also holds the 30-second background tick for reminders and study mode)
  preload/         exposes window.unilink.call(path, input), and nothing else
  renderer/src/    React app: pages/, components/, lib/rpc.ts (typed client)
  shared/          pure logic used by both sides: grades, planner, links, ics, validation, dates
tests/             shared.test.ts (pure logic), services.test.ts (real router + in-memory SQLite)
```

The renderer calls the main process through a small tRPC-style layer. A procedure is declared once in a
service:

```ts
join: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => { … })
```

The renderer calls it as `rpc.classes.join({ classId })`, fully typed from that declaration. Every call
goes over one IPC channel, is validated with zod, and runs as the signed-in user (`ctx.userId`). Errors
come back as `{ code, message }` and show up as notifications. To add a feature, add a procedure to a
service and call it from a page; there's no other wiring.

Native OS features (file pickers, opening files) are behind the `Platform` interface in `rpc/core.ts`,
so the services can be tested without Electron.

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

- **A shared server.** Data is stored locally, so classmates are only shared between accounts on the
  same machine. The RPC layer is the seam: move `services/` behind an HTTP API and point `lib/rpc.ts` at it.
- **Email delivery (G3).** Emails (notifications, password reset codes) are written to an `outbox` table and
  can be viewed under Profile → Notifications → Email outbox. Sending them needs a mail server (SMTP or an
  email API) with credentials, which belongs on a backend, not in a desktop app. Dev builds also show reset
  codes on screen.
- **Website blocking (ST1).** Not possible from the app itself: blocking sites in a browser needs admin rights
  (editing the hosts file or a firewall) or a browser extension. The planned route is a small extension
  that asks UniLink whether study mode is on. Study mode also only runs while UniLink is open, and
  system-wide Do Not Disturb exists only on GNOME. Windows and macOS don't let apps turn on Focus.
- **Program data (A2).** The three programs in `db/programs.ts` are illustrative samples, not official McGill
  requirements. Like the course catalogue, real data needs an eCalendar import.
- **Live integrations (G2).** Google Calendar and myCourses use `.ics` export/import. The course catalogue
  is a built-in sample (`db/catalogue.ts`), not the full McGill eCalendar.
- **Packaging.** Add electron-builder (or Forge), and ship `drizzle/` as an extra resource; the main process
  already looks for it in `process.resourcesPath` when packaged.
