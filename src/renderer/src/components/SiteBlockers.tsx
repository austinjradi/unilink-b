import { useEffect, useState } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { useNetwork } from '@mantine/hooks';
import { useVariant } from '../lib/variants';
import { WithInfo } from './ReqInfo';

// 'require-connection' and 'refuse-no-storage': the whole site stops and says why.
export function SiteBlockers() {
  const needsConnection = useVariant('require-connection');
  const refusesNoStorage = useVariant('refuse-no-storage');
  const network = useNetwork();
  const [cantSave, setCantSave] = useState(false);
  useEffect(() => window.unilink.onSaveProblem(setCantSave), []);

  const queuesChanges = useVariant('offline-queue');
  if (queuesChanges && !network.online) {
    return (
      <div className="site-note" role="status">
        <WithInfo id="offline-badge">You’re offline. Look around as much as you like: anything you change goes through when you’re back.</WithInfo>
      </div>
    );
  }
  const offline = needsConnection && !network.online;
  if (!offline && !(refusesNoStorage && cantSave)) return null;
  return (
    <div className="site-block" role="alert">
      <Stack maw={420} gap="xs" ta="center">
        <Title order={2}>
          <WithInfo id={offline ? 'offline-badge' : 'save-problem'}>{offline ? 'You’re offline' : 'This browser can’t save'}</WithInfo>
        </Title>
        <Text c="dimmed">{offline ? 'UniLink needs a connection. It will come back as soon as you do.' : 'UniLink won’t run here, because nothing you did would last. Try a normal window in another browser.'}</Text>
      </Stack>
    </div>
  );
}
