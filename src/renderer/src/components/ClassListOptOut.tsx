import { Checkbox } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';

// 'list-members': every student can leave themselves off class lists.
export function ClassListOptOut() {
  const sharing = useQuery({ queryKey: ['profile', 'sharing'], queryFn: () => rpc.profile.sharing() });
  const save = useAction((hidden: boolean) => rpc.profile.setHiddenFromClassLists({ hidden }));
  return <Checkbox mb="md" label="Leave me off class lists" checked={!!sharing.data?.hiddenFromClassLists} onChange={(e) => save.mutate(e.currentTarget.checked)} />;
}
