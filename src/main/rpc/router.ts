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
import { studyModeRouter } from '../services/studyMode';
import { studySessionsRouter } from '../services/studySessions';
import { todosRouter } from '../services/todos';

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
};

export type AppRouter = typeof appRouter;
