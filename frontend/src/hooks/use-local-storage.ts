"use client";

import { useCallback, useState } from "react";

/**
 * A string preference persisted in localStorage. Only for per-viewer conveniences (sidebar width,
 * remembered tab); storage failures (private mode, blocked storage) fall back to in-memory state.
 * Must run in the browser (the app shell renders client-side only).
 */
export function useLocalStorageState<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (window.localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* keep the in-memory value */
      }
    },
    [key],
  );

  return [value, update];
}
