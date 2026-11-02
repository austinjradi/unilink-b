import { useState } from 'react';
import { Group, Paper, Table, Text, VisuallyHidden } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { t, term } from '../lib/i18n';
import { SectionCard } from './ui';

type Point = { term: string; gpa: number; cgpa: number };

const HEIGHT = 170;
const MARGIN = { top: 12, right: 100, bottom: 24, left: 34 };
const SERIES = [
  { key: 'gpa', color: 'var(--ul-series-1)' },
  { key: 'cgpa', color: 'var(--ul-series-2)' },
] as const;

// A1: how a student's GPA has moved, term by term, on McGill's 4.00 scale.
export function GpaTrend({ points }: { points: Point[] }) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return null;

  const label = { gpa: t('Term GPA'), cgpa: t('CGPA') };
  const values = points.flatMap((p) => [p.gpa, p.cgpa]);
  // The scale starts where the grades do, so a change of a few tenths can be seen.
  const low = Math.max(0, Math.floor(Math.min(...values)) - (Math.min(...values) % 1 < 0.25 ? 1 : 0));
  const ticks = Array.from({ length: (4 - low) / (4 - low > 2 ? 1 : 0.5) + 1 }, (_, i) => low + i * (4 - low > 2 ? 1 : 0.5));
  const plot = Math.max(0, width - MARGIN.left - MARGIN.right);
  const x = (i: number) => MARGIN.left + (plot * i) / (points.length - 1);
  const y = (value: number) => MARGIN.top + ((4 - value) / (4 - low)) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  // Fewer term names on a narrow screen, always keeping the latest.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plot / 76))));
  const nameShown = (i: number) => (points.length - 1 - i) % every === 0;
  const last = points[points.length - 1];
  // The end labels move apart when the lines finish close together.
  const [gpaLabel, cgpaLabel] = (() => {
    const a = y(last.gpa);
    const b = y(last.cgpa);
    const gap = 15 - Math.abs(a - b);
    if (gap <= 0) return [a, b];
    return a <= b ? [a - gap / 2, b + gap / 2] : [a + gap / 2, b - gap / 2];
  })();

  return (
    <SectionCard
      title={t('GPA by term')}
      actions={
        <Group gap="md">
          {SERIES.map((s) => (
            <Group key={s.key} gap={6} wrap="nowrap">
              <svg width={10} height={10} aria-hidden>
                <circle cx={5} cy={5} r={4} fill={s.color} />
              </svg>
              <Text size="xs" c="dimmed" fw={700}>
                {label[s.key]}
              </Text>
            </Group>
          ))}
        </Group>
      }
    >
      <div ref={ref} style={{ position: 'relative', height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            aria-hidden
            style={{ display: 'block', touchAction: 'pan-y' }}
            onPointerMove={(e) => {
              const left = e.clientX - e.currentTarget.getBoundingClientRect().left;
              setActive(Math.max(0, Math.min(points.length - 1, Math.round(((left - MARGIN.left) / plot) * (points.length - 1)))));
            }}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + plot} y1={y(tick)} y2={y(tick)} stroke="var(--ul-border)" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">
                  {tick.toFixed(tick % 1 ? 1 : 0)}
                </text>
              </g>
            ))}
            {points.map(
              (p, i) =>
                nameShown(i) && (
                  <text key={p.term} x={x(i)} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--mantine-color-dimmed)">
                    {term(p.term)}
                  </text>
                ),
            )}
            {active != null && <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--mantine-color-dimmed)" strokeWidth={1} />}
            {SERIES.map((s) => (
              <g key={s.key}>
                <polyline points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {points.map((p, i) => (
                  <circle key={p.term} cx={x(i)} cy={y(p[s.key])} r={active === i ? 5 : 4} fill={s.color} stroke="var(--mantine-color-body)" strokeWidth={2} />
                ))}
              </g>
            ))}
            <text x={MARGIN.left + plot + 10} y={gpaLabel + 4} fontSize={11} fontWeight={700} fill="var(--mantine-color-text)">
              {label.gpa.length > 9 ? last.gpa.toFixed(2) : `${label.gpa} ${last.gpa.toFixed(2)}`}
            </text>
            <text x={MARGIN.left + plot + 10} y={cgpaLabel + 4} fontSize={11} fontWeight={700} fill="var(--mantine-color-text)">
              {label.cgpa} {last.cgpa.toFixed(2)}
            </text>
          </svg>
        )}
        {active != null && (
          <Paper
            shadow="md"
            withBorder
            px="xs"
            py={6}
            style={{
              position: 'absolute',
              top: 4,
              pointerEvents: 'none',
              ...(x(active) > width / 2 ? { right: width - x(active) + 10 } : { left: x(active) + 10 }),
            }}
          >
            <Text size="xs" c="dimmed" fw={700} style={{ whiteSpace: 'nowrap' }}>
              {term(points[active].term)}
            </Text>
            {SERIES.map((s) => (
              <Text key={s.key} size="xs" style={{ whiteSpace: 'nowrap' }}>
                <b>{points[active][s.key].toFixed(2)}</b> {label[s.key]}
              </Text>
            ))}
          </Paper>
        )}
      </div>
      <VisuallyHidden>
        <Table>
          <caption>{t('GPA by term')}</caption>
          <thead>
            <tr>
              <th>{t('Term')}</th>
              <th>{label.gpa}</th>
              <th>{label.cgpa}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.term}>
                <td>{term(p.term)}</td>
                <td>{p.gpa.toFixed(2)}</td>
                <td>{p.cgpa.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </VisuallyHidden>
    </SectionCard>
  );
}
