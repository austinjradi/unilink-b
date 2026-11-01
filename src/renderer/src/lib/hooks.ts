import { createContext, useContext } from 'react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

// Every write goes through here: run it, refresh all data (the app is small and
// local, so refetching everything is cheap), and toast the result.
export function useAction<I = void, O = unknown>(fn: (input: I) => Promise<O>, options: ActionOptions<I, O> = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, input) => {
      await queryClient.invalidateQueries();
      const message = typeof options.success === 'function' ? options.success(data, input) : options.success;
      if (message) notifications.show({ color: 'teal', message });
      options.onSuccess?.(data, input);
    },
    onError: (error) => notifications.show({ color: 'red', title: "That didn't work", message: error.message }),
  });
}
