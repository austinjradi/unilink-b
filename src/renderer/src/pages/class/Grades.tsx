import { GradeCalculator } from '../../components/GradeCalculator';

// A5 grading scheme + A4 calculator for one class (same view as the Calculator page).
export function Grades({ classId }: { classId: number }) {
  return <GradeCalculator classId={classId} />;
}
