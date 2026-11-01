# UniLink

A desktop app for McGill students: find your classes and classmates, share group chats, host study sessions,
discuss course topics, and keep deadlines, grades and assignment plans in one place.

It implements the ten in-scope ("green") features from the UniLink requirements board:

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

## Not built yet

- **A shared server.** Data is stored locally, so classmates are only shared between accounts on the
  same machine. The RPC layer is the seam: move `services/` behind an HTTP API and point `lib/rpc.ts` at it.
- **Email (G3).** Password reset codes are shown on screen in dev builds instead of being emailed.
- **Live integrations (G2).** Google Calendar and myCourses use `.ics` export/import. The course catalogue
  is a built-in sample (`db/catalogue.ts`), not the full McGill eCalendar.
- **Packaging.** Add electron-builder (or Forge), and ship `drizzle/` as an extra resource; the main process
  already looks for it in `process.resourcesPath` when packaged.
