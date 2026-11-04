import { Button, Group } from '@mantine/core';
import { useEffect, useRef } from 'react';

// The next page of a long list, fetched as it's about to scroll into view. It's still a button,
// for keyboards and browsers that can't tell.
export function LoadOnScroll({ label, shown, loading, onMore }: { label: string; shown: number; loading?: boolean; onMore: () => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  // Watches again after each page: if it's still in view, there's room for another.
  useEffect(() => {
    if (!anchor.current || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(([entry]) => entry.isIntersecting && more.current(), { rootMargin: '600px 0px' });
    watcher.observe(anchor.current);
    return () => watcher.disconnect();
  }, [shown]);
  return (
    <Group ref={anchor} justify="center" mt="sm" style={{ alignSelf: 'center' }}>
      <Button variant="default" radius="xl" loading={loading} onClick={onMore}>
        {label}
      </Button>
    </Group>
  );
}
