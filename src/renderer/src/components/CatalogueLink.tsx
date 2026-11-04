import type { ReactNode } from 'react';
import { Anchor } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { loadCourses, type CourseRow } from '@shared/catalogue';
import { t } from '../lib/i18n';

// Shared, because a long list has one of these per row.
const codeSets = new WeakMap<CourseRow[], Set<string>>();
function toCodes(rows: CourseRow[]) {
  const codes = codeSets.get(rows) ?? new Set(rows.map(([code]) => code));
  codeSets.set(rows, codes);
  return codes;
}

// A link to a course's catalogue page, for courses the catalogue has. Others show just the text.
export function CatalogueLink({ code, children }: { code: string; children?: ReactNode }) {
  const codes = useQuery({ queryKey: ['catalogue', 'courses'], queryFn: loadCourses, staleTime: Infinity, select: toCodes });
  if (!codes.data?.has(code)) return <>{children}</>;
  return (
    <Anchor component={Link} to={`/catalogue/courses/${encodeURIComponent(code)}`} inherit>
      {children ?? t('See in the catalogue')}
    </Anchor>
  );
}
