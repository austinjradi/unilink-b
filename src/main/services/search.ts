import { and, asc, desc, eq, gte, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadCourses, loadIndex } from '@shared/catalogue';
import { isOn } from '@shared/variants';
import { assessments, chatLinks, classes, courses, enrollments, plannerAssignments, posts, replies, studySessions, users } from '../db/schema';
import { procedure } from '../rpc/core';
import { classLabels, sectionCode } from './access';
import { canSeePost } from './board';
import { visibleDeadlines } from './calendar';
import { canSeeSession } from './studySessions';

// One box for everything a student remembers but can't place: their classes, and within them
// only what they can already see elsewhere (private posts and invite-only sessions stay hidden).

const MIN_LENGTH = 2;
const CATALOGUE_RESULTS = 6;

export const searchRouter = {
  everything: procedure(z.object({ query: z.string().trim().max(100) }), async ({ query }, ctx) => {
    if (query.length < MIN_LENGTH) return [];
    const { db, userId } = ctx;
    const term = `%${query}%`;
    const lower = query.toLowerCase();
    const mine = db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId)).all().map((r) => r.id);
    const label = classLabels(db);
    const labelOf = (classId: number | null) => (classId == null ? null : (label.get(classId) ?? null));
    const results: { kind: 'class' | 'catalogue' | 'person' | 'post' | 'deadline' | 'graded' | 'session' | 'plan' | 'chat' | 'program' | 'rule'; id: number; title: string; sub: string | null; when?: Date; to: string }[] = [];

    if (mine.length) {
      for (const c of db
        .select({ id: classes.id, code: sectionCode, title: courses.title })
        .from(classes)
        .innerJoin(courses, eq(classes.courseId, courses.id))
        .where(and(inArray(classes.id, mine), or(like(sectionCode, term), like(courses.title, term))))
        .limit(5)
        .all()) {
        results.push({ kind: 'class', id: c.id, title: c.code, sub: c.title, to: `/classes/${c.id}` });
      }

      for (const p of db
        .select({ id: posts.id, title: posts.title, classId: posts.classId })
        .from(posts)
        .where(
          and(
            inArray(posts.classId, mine),
            canSeePost(userId),
            isNull(posts.deletedAt),
            or(like(posts.title, term), like(posts.body, term), inArray(posts.id, sql`(select ${replies.postId} from ${replies} where ${replies.body} like ${term})`)),
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(8)
        .all()) {
        results.push({ kind: 'post', id: p.id, title: p.title, sub: labelOf(p.classId), to: `/classes/${p.classId}/discussion?post=${p.id}` });
      }

      for (const a of db
        .select({ id: assessments.id, name: assessments.name, classId: assessments.classId })
        .from(assessments)
        .where(and(inArray(assessments.classId, mine), like(assessments.name, term)))
        .limit(5)
        .all()) {
        results.push({ kind: 'graded', id: a.id, title: a.name, sub: labelOf(a.classId), to: `/classes/${a.classId}/grades` });
      }

      for (const s of db
        .select()
        .from(studySessions)
        .where(
          and(
            inArray(studySessions.classId, mine),
            gte(studySessions.endsAt, ctx.now()),
            isNull(studySessions.cancelledAt),
            or(like(studySessions.title, term), like(studySessions.tag, term), like(studySessions.location, term)),
          ),
        )
        .orderBy(asc(studySessions.startsAt))
        .all()
        .filter((s) => canSeeSession(db, userId, s))
        .slice(0, 5)) {
        results.push({ kind: 'session', id: s.id, title: s.title, sub: labelOf(s.classId), when: s.startsAt, to: `/classes/${s.classId}/sessions` });
      }

      for (const l of db
        .select({ id: chatLinks.id, label: chatLinks.label, platform: chatLinks.platform, classId: chatLinks.classId })
        .from(chatLinks)
        .where(and(inArray(chatLinks.classId, mine), isOn('private-links') ? or(eq(chatLinks.isPublic, true), eq(chatLinks.ownerId, ctx.userId)) : undefined, or(like(chatLinks.label, term), like(chatLinks.platform, term))))
        .limit(5)
        .all()) {
        results.push({ kind: 'chat', id: l.id, title: l.label || l.platform, sub: labelOf(l.classId), to: `/classes/${l.classId}/chats` });
      }
    }

    // What's still to come, soonest first, then what's already past, latest first.
    const found = visibleDeadlines(db, userId).filter((d) => d.title.toLowerCase().includes(lower));
    const upcoming = found.filter((d) => d.dueAt >= ctx.now());
    const past = found.filter((d) => d.dueAt < ctx.now()).reverse();
    for (const d of [...upcoming, ...past].slice(0, 6)) {
      results.push({
        kind: 'deadline',
        id: d.id,
        title: d.title,
        sub: labelOf(d.classId),
        when: d.dueAt,
        to: d.official ? `/classes/${d.classId}/assignments` : d.classId ? `/classes/${d.classId}` : '/calendar',
      });
    }

    for (const p of db
      .select({ id: plannerAssignments.id, title: plannerAssignments.title, classId: plannerAssignments.classId })
      .from(plannerAssignments)
      .where(and(eq(plannerAssignments.userId, userId), like(plannerAssignments.title, term)))
      .limit(5)
      .all()) {
      results.push({ kind: 'plan', id: p.id, title: p.title, sub: labelOf(p.classId), to: '/planner' });
    }

    if (isOn('search-catalogue')) {
      for (const c of db
        .select({ id: courses.id, subject: courses.subject, number: courses.number, title: courses.title })
        .from(courses)
        .where(or(like(sql`${courses.subject} || ' ' || ${courses.number}`, term), like(sql`${courses.subject} || ${courses.number}`, term), like(courses.title, term)))
        .limit(8)
        .all()) {
        const code = `${c.subject} ${c.number}`;
        results.push({ kind: 'catalogue', id: c.id, title: code, sub: c.title, to: `/courses/find?q=${encodeURIComponent(code)}` });
      }
    }

    if (isOn('search-classmates') && mine.length) {
      const seen = new Set<number>();
      for (const p of db
        .select({ id: users.id, name: users.name, classId: enrollments.classId })
        .from(users)
        .innerJoin(enrollments, eq(enrollments.userId, users.id))
        .where(and(inArray(enrollments.classId, mine), like(users.name, term), ne(users.id, userId)))
        .limit(20)
        .all()) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        results.push({ kind: 'person', id: p.id, title: p.name, sub: labelOf(p.classId), to: `/classes/${p.classId}` });
      }
    }

    // The full course catalogue, which nobody has to be in a class to look through.
    const matches = (text: string | null) => !!text && text.toLowerCase().includes(lower);
    if (isOn('search-catalogue')) {
      const listed = new Set(results.filter((r) => r.kind === 'catalogue').map((r) => r.title));
      const compact = lower.replace(/\s+/g, '');
      let shown = 0;
      for (const [code, title] of await loadCourses()) {
        if (shown === CATALOGUE_RESULTS) break;
        if (listed.has(code) || !(matches(title) || code.toLowerCase().replace(' ', '').includes(compact))) continue;
        shown++;
        results.push({ kind: 'catalogue', id: 1_000_000 + shown, title: code, sub: title, to: `/catalogue/courses/${encodeURIComponent(code)}` });
      }
    }
    const index = await loadIndex();
    index.programs
      .filter((p) => matches(p.name) || matches(p.unit))
      .slice(0, CATALOGUE_RESULTS)
      .forEach((p, i) => results.push({ kind: 'program', id: i, title: p.name, sub: p.faculty, to: `/catalogue/programs/${encodeURIComponent(p.id)}` }));
    index.guide
      .filter((g) => matches(g.title))
      .slice(0, CATALOGUE_RESULTS)
      .forEach((g, i) => results.push({ kind: 'rule', id: i, title: g.title, sub: g.part, to: `/catalogue/guide/${encodeURIComponent(g.key)}` }));

    return results;
  }),
};
