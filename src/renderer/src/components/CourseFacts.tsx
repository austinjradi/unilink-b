import { Group, Paper, Stack, Text } from '@mantine/core';
import { courseParts, loadOfferings, loadPrereqs, parseOffering, sectionsIn, type OfferingWhy } from '@shared/catalogue';
import { TERMS } from '@shared/dates';
import { finalExamsFor, type FinalExam } from '@shared/keyDates';
import { prereqCourses, prereqOf, unmetPrereq, type PrereqRule } from '@shared/prereqs';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { t, term, tx } from '../lib/i18n';
import { ReqInfo } from './ReqInfo';

// Which terms, sections, final and prerequisite a course has. Only the December exam schedule and
// the catalogue's own sentences are McGill's word; the rest is worked out by scripts/catalogue/infer.py.
export const useOfferings = () => useQuery({ queryKey: ['catalogue', 'offerings'], queryFn: loadOfferings, staleTime: Infinity });
export const usePrereqs = () => useQuery({ queryKey: ['catalogue', 'prereqs'], queryFn: loadPrereqs, staleTime: Infinity });

const OFFERING_WHY: Record<OfferingWhy, string> = {
  schedule: tx('It’s on McGill’s December 2026 exam schedule.'),
  'two-term': tx('From its code: the first part of a two-term course runs in Fall and the second in Winter.'),
  program: tx('A program lists it under that term.'),
  title: tx('From its title: part 1 usually runs in Fall and part 2 in Winter.'),
  'no-final': tx('Courses like this often have no final, so the December schedule doesn’t tell us. It could run in either term.'),
  'not-in-december': tx('It isn’t on the December exam schedule, so it probably runs in Winter.'),
  sample: tx('It’s one of the demo’s courses, and it isn’t on the December exam schedule.'),
};

export function prereqLine(rule: PrereqRule, code: string) {
  const courses = prereqCourses(rule);
  const page = rule.page ?? 0;
  switch (rule.how) {
    case 'stated':
      return page ? t('Needs {{courses}} first (catalogue, page {{page}}).', { courses, page }) : t('Needs {{courses}} first.', { courses });
    case 'general':
      return t('Usually needs {{courses}} first (catalogue, page {{page}}).', { courses, page });
    case 'co':
      return t('Needs {{courses}} before or alongside it (catalogue, page {{page}}).', { courses, page });
    case 'two-term':
      return t('Second part of a two-term course: take {{courses}} first.', { courses });
    case 'title':
      return t('Probably comes after {{courses}}, going by the titles.', { courses });
    default:
      return t('Probably comes after a lower-level {{subject}} course.', { subject: courseParts(code).subject });
  }
}

export function examTime(exam: FinalExam) {
  const day = (date: string) => dayjs(date).format(t('ddd, MMM D'));
  return `${day(exam.date)} · ${exam.start}–${exam.endDate ? `${day(exam.endDate)} ` : ''}${exam.end}`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Text size="sm" fw={700} w={110} style={{ flex: 'none' }}>
        {label}
      </Text>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        {children}
      </Stack>
    </Group>
  );
}

// A3 + G2 on a course's own page.
export function CourseFacts({ code }: { code: string }) {
  const offerings = useOfferings();
  const prereqs = usePrereqs();
  if (!offerings.data || !prereqs.data) return null;
  const offering = parseOffering(offerings.data[code]);
  const terms = offering?.terms ?? [...TERMS];
  const rule = prereqOf(code, prereqs.data);
  const { number } = courseParts(code);
  return (
    <Paper withBorder radius="lg" p="md">
      <Text fw={700} mb={8}>
        {t('When it runs')} <ReqInfo id="catalogue-sample" />
      </Text>
      <Stack gap="xs">
        <Fact label={t('Term')}>
          <Text size="sm">
            {terms.map(term).join(', ')}
          </Text>
          {offering && (
            <Text size="xs" c="dimmed">
              {t(OFFERING_WHY[offering.why])}
            </Text>
          )}
        </Fact>
        <Fact label={t('Sections')}>
          {terms.map((name) => (
            <Text size="sm" key={name}>
              {term(name)}: {sectionsIn(number, offering, name).join(', ')}
            </Text>
          ))}
        </Fact>
        <Fact label={t('Final exam')}>
          {terms.map((name) => {
            const exams = finalExamsFor(code, name);
            if (!exams.length) {
              return (
                <Text size="sm" key={name}>
                  {term(name)}: {name === TERMS[0] ? t('none on the December schedule') : t('none expected')}
                </Text>
              );
            }
            return exams.map((exam) => (
              <Text size="sm" key={`${name}-${exam.section}`}>
                {term(name)}: {examTime(exam)} · {exam.location} {exam.section?.endsWith('L') && `(${t('lab')})`}
              </Text>
            ));
          })}
        </Fact>
        <Fact label={t('Before it')}>
          <Text size="sm">{rule ? prereqLine(rule, code) : t('Nothing listed or expected.')}</Text>
        </Fact>
      </Stack>
    </Paper>
  );
}

// Beside a course someone might plan: what stands in the way, without stopping them.
export function PlanHint({ code, planTerm, record }: { code: string; planTerm: string; record: { code: string; term: string }[] }) {
  const offerings = useOfferings();
  const prereqs = usePrereqs();
  if (!offerings.data || !prereqs.data) return null;
  const offering = parseOffering(offerings.data[code]);
  const rule = unmetPrereq(code, planTerm, record, prereqs.data);
  const otherTerm = offering && !offering.terms.includes(planTerm);
  if (!rule && !otherTerm) return null;
  return (
    <Text size="xs" c="dimmed" mt={4}>
      {otherTerm && t('Usually runs in {{terms}}.', { terms: offering.terms.map(term).join(', ') })} {rule && prereqLine(rule, code)}
    </Text>
  );
}
