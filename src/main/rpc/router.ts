import { authRouter, profileRouter } from '../services/auth';
import { boardRouter } from '../services/board';
import { calendarRouter } from '../services/calendar';
import { catalogueRouter, classesRouter } from '../services/classes';
import { coursesRouter } from '../services/courses';
import { linksRouter } from '../services/links';
import { plannerRouter } from '../services/planner';
import { studySessionsRouter } from '../services/studySessions';

export const appRouter = {
  auth: authRouter, // G4
  profile: profileRouter, // G4
  catalogue: catalogueRouter, // S1, G2
  classes: classesRouter, // S1
  links: linksRouter, // S2
  studySessions: studySessionsRouter, // S3
  board: boardRouter, // S4
  calendar: calendarRouter, // A3, G2
  courses: coursesRouter, // A4, A5
  planner: plannerRouter, // ST2
};

export type AppRouter = typeof appRouter;
