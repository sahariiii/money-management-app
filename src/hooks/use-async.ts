import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

type State<T> = { data?: T; error?: Error; loading: boolean };

/**
 * Runs an api.ts call when the screen gains focus or `key` changes, so data
 * edited on another screen (e.g. a recategorized transaction) is fresh on return.
 * Keeps the previous data while refetching to avoid flicker.
 *
 * `key` should capture every input of `load`, e.g. `month` or `JSON.stringify(filters)`.
 */
export function useAsync<T>(load: () => Promise<T>, key: string | number = '') {
  const [state, setState] = useState<State<T>>({ loading: true });
  const [version, setVersion] = useState(0);

  useFocusEffect(
    useCallback(
      () => {
        let active = true;
        load().then(
          (data) => active && setState({ data, loading: false }),
          (error: Error) => active && setState((s) => ({ ...s, error, loading: false })),
        );
        return () => {
          active = false;
        };
      },
      // `load` is a new closure every render; `key` says when its inputs changed.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key, version],
    ),
  );

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((data: T) => setState({ data, loading: false }), []);
  return { ...state, reload, setData };
}
