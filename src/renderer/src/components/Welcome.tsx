import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconBrandGithub, IconInfoCircle, IconListDetails } from '@tabler/icons-react';
import { setListOpen } from '../lib/reqView';

// A welcome shown once per browser, on the first visit, on top of whatever page opens: what the
// site is, where its code lives, and how to review the requirements it was built from. Like the
// other requirement tools (ReqInfo, RequirementsView), it's for reviewers, so it stays in English.

const SEEN_KEY = 'unilink-welcome-seen';
const REPO_URL = 'https://github.com/austinjradi/unilink-b';

// localStorage throws when site data is blocked (some private windows), so both helpers catch.
// Then the welcome simply shows on every visit, which is harmless.
function alreadySeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Nothing to remember it in.
  }
}

export function Welcome() {
  // A lazy initial value: localStorage is read once, on the first render, not on every render.
  const [opened, setOpened] = useState(() => !alreadySeen());
  // Closing it any way at all (a button, Escape, the overlay, the X) counts as having seen it.
  const close = () => {
    rememberSeen();
    setOpened(false);
  };
  return (
    // `lang="en"` tells screen readers this stays English, even when the app is in French.
    <Modal opened={opened} onClose={close} title="Welcome to UniLink" lang="en" size="lg" centered>
      <Stack gap="md">
        <Text size="sm">
          UniLink helps McGill students find their classmates, share group chats, set up study sessions, and keep deadlines,
          grades and assignment plans in one place.
        </Text>
        <Text size="sm">
          This demo runs entirely in your browser. Sign in with one of the demo accounts listed on the sign-in screen, or make
          your own. Nothing you do here leaves this browser.
        </Text>
        <Text size="sm">
          It was built from a requirements board. The requirements list shows every requirement, how this version meets it,
          and the alternatives, many of which you can switch on to try. Throughout the site, the{' '}
          <IconInfoCircle size={14} style={{ verticalAlign: '-2px' }} aria-label="info" /> next to a feature does the same
          for that feature.
        </Text>
        {/* `grow` makes the two buttons share the row equally. */}
        <Group grow>
          {/* Closes the welcome first, then swaps the site for the requirements list (lib/reqView.ts). */}
          <Button
            leftSection={<IconListDetails size={16} />}
            onClick={() => {
              close();
              setListOpen(true);
            }}
          >
            See the requirements
          </Button>
          {/* component="a" renders the Button as a link. It opens a new tab, so the welcome stays here. */}
          <Button component="a" href={REPO_URL} target="_blank" rel="noopener noreferrer" variant="default" leftSection={<IconBrandGithub size={16} />}>
            View the code on GitHub
          </Button>
        </Group>
        <Button variant="subtle" onClick={close}>
          Continue to the site
        </Button>
      </Stack>
    </Modal>
  );
}
