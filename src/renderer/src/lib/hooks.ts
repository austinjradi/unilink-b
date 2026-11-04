import { createContext, useContext } from 'react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isOn } from '@shared/variants';
import { t } from './i18n';
import { type Out, rpc } from './rpc';

export type Me = NonNullable<Out<typeof rpc.auth.me>>;

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() used outside the signed-in app');
  return me;
}

interface ActionOptions<I, O> {
  success?: string | ((data: O, input: I) => string);
  onSuccess?: (data: O, input: I) => void;
}

// 'offline-queue': while offline a change waits, in order, until the connection is back.
const WAITING = 'Saved for when you’re back online.';
let queue: Promise<unknown> = Promise.resolve();
function whenOnline() {
  if (navigator.onLine) return Promise.resolve();
  notifications.show({ message: WAITING });
  return new Promise((resolve) => window.addEventListener('online', resolve, { once: true }));
}

// Every write goes through here: run it, refresh all data (the app is small and
// local, so refetching everything is cheap), and toast the result.
export function useAction<I = void, O = unknown>(fn: (input: I) => Promise<O>, options: ActionOptions<I, O> = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: I) => {
      if (isOn('offline-queue')) {
        queue = queue.then(whenOnline);
        await queue;
      }
      return fn(input);
    },
    onSuccess: async (data, input) => {
      await queryClient.invalidateQueries();
      // Plain-string messages are English keys; functions return already-translated text.
      const message = typeof options.success === 'function' ? options.success(data, input) : options.success && t(options.success);
      if (message) notifications.show({ color: 'teal', message });
      options.onSuccess?.(data, input);
    },
    onError: (error) => notifications.show({ color: 'red', title: t("That didn't work"), message: error.message }),
  });
}
