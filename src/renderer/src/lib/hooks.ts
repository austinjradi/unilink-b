import { createContext, useContext } from 'react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changesWithWrites } from './preload';
import { isOn } from '@shared/variants';
import { t } from './i18n';
import { type Out, rpc } from './rpc';

// auth.me returns a user or null. NonNullable removes the null, leaving just the user type.
export type Me = NonNullable<Out<typeof rpc.auth.me>>;

// The argument is the default: what useContext returns when there's no Provider above.
export const MeContext = createContext<Me | null>(null);

// A custom hook is a function whose name starts with `use` and that calls other hooks.
// Throwing here turns a misuse into a clear error, instead of a null crash somewhere later.
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() used outside the signed-in app');
  return me;
}

// I is the type passed to mutate(), O the type the call returns.
// success can be fixed text, or a function of the result and the input.
interface ActionOptions<I, O> {
  success?: string | ((data: O, input: I) => string);
  onSuccess?: (data: O, input: I) => void;
}

// 'offline-queue': while offline a change waits, in order, until the connection is back.
const WAITING = 'Saved for when you’re back online.';
// Only used with the offline-queue switch: a promise chain, like
// `saving` in bridge.ts, that keeps queued changes in order.
let queue: Promise<unknown> = Promise.resolve();
// Resolves at once when online, otherwise when the browser fires its
// online event. `{ once: true }` removes the listener after it runs.
function whenOnline() {
  if (navigator.onLine) return Promise.resolve();
  notifications.show({ message: WAITING });
  return new Promise((resolve) => window.addEventListener('online', resolve, { once: true }));
}

// Every write goes through here: run it, refresh all data (the app is small and
// local, so refetching everything is cheap), and toast the result.
// With no input type given, I is void, so mutate() takes no argument.
export function useAction<I = void, O = unknown>(fn: (input: I) => Promise<O>, options: ActionOptions<I, O> = {}) {
  const queryClient = useQueryClient();
  // useMutation is TanStack Query's hook for writes. It returns an object with
  // mutate(input), isPending, error and more, and does nothing until mutate is called.
  return useMutation({
    mutationFn: async (input: I) => {
      if (isOn('offline-queue')) {
        queue = queue.then(whenOnline);
        await queue;
      }
      return fn(input);
    },
    // Awaiting the refresh means the toast and onSuccess run once
    // fresh data has arrived, so the screen is already up to date.
    onSuccess: async (data, input) => {
      await queryClient.invalidateQueries({ predicate: changesWithWrites });
      // Plain-string messages are English keys; functions return already-translated text.
      const message = typeof options.success === 'function' ? options.success(data, input) : options.success && t(options.success);
      if (message) notifications.show({ color: 'teal', message });
      options.onSuccess?.(data, input);
    },
    // error.message is already translated (see RpcError in lib/rpc.ts).
    onError: (error) => notifications.show({ color: 'red', title: t("That didn't work"), message: error.message }),
  });
}
