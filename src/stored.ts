import { useState } from 'react';

// Small per-device preferences (sort orders, views, theme) in localStorage. Storage can be
// unavailable, so reads fall back and writes fail quietly.

/** The saved value if it's one of `allowed`, otherwise `fallback`. */
export function readStored<T extends string | number>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.find((a) => String(a) === saved) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: string | number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Applies until the app closes.
  }
}

/** A set of strings that's remembered between runs, with a function that adds or removes one. */
export function useStoredSet(key: string) {
  const [value, setValue] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
      return new Set(Array.isArray(saved) ? saved.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (item: string) =>
    setValue((prev) => {
      const next = new Set(prev);
      if (!next.delete(item)) next.add(item);
      writeStored(key, JSON.stringify([...next]));
      return next;
    });
  return [value, toggle] as const;
}

/** A choice that's remembered between runs. */
export function useStoredChoice<T extends string | number>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, allowed, fallback));
  const set = (next: T) => {
    setValue(next);
    writeStored(key, next);
  };
  return [value, set] as const;
}
