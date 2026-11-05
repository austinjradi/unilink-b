import { degreeRouter, recordRouter } from '../services/academics';
import { assignmentsRouter } from '../services/assignments';
import { authRouter, profileRouter } from '../services/auth';
import { boardRouter } from '../services/board';
import { calendarRouter } from '../services/calendar';
import { catalogueRouter, classesRouter } from '../services/classes';
import { coursesRouter } from '../services/courses';
import { linksRouter } from '../services/links';
import { notificationsRouter } from '../services/notifications';
import { plannerRouter } from '../services/planner';
import { searchRouter } from '../services/search';
import { timePollsRouter } from '../services/timePolls';
import { studyModeRouter } from '../services/studyMode';
import { studySessionsRouter } from '../services/studySessions';
import { todosRouter } from '../services/todos';

// Every router, under the name the renderer uses: `auth` here is `rpc.auth` in React. A new feature's
// router needs one line here and nothing else. The comments name the requirement each one implements.
export const appRouter = {
  auth: authRouter, // G4
  profile: profileRouter, // G4
  catalogue: catalogueRouter, // S1, G2
  classes: classesRouter, // S1
  links: linksRouter, // S2
  studySessions: studySessionsRouter, // S3
  board: boardRouter, // S4
  record: recordRouter, // A1
  degree: degreeRouter, // A2
  calendar: calendarRouter, // A3, G2
  courses: coursesRouter, // A4, A5
  assignments: assignmentsRouter, // posted by a section's professor
  notifications: notificationsRouter, // G3
  studyMode: studyModeRouter, // ST1
  planner: plannerRouter, // ST2
  todos: todosRouter, // ST3
  search: searchRouter, // across all of the above
  timePolls: timePollsRouter, // S3
};

// `typeof` on a value gives its type. The renderer imports only this type (with `import
// type`), so it knows the whole API's shape without importing backend code into React.
export type AppRouter = typeof appRouter;
