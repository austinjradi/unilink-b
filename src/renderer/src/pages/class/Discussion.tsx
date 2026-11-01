import { Feed } from '../../components/Feed';

// S4: the class's board, in the same feed layout as Home.
export function Discussion({ classId }: { classId: number }) {
  return <Feed classId={classId} />;
}
