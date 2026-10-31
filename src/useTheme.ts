import { useEffect, useState } from 'react';
import { api } from './api';
import type { ThemePreference } from './types';

const STORAGE_KEY = 'workbench.theme';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // Storage unavailable; fall through to default.
  }
  return 'system';
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStored);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      document.documentElement.dataset.theme = resolved;
      api.window.setTheme(resolved === 'dark').catch(() => {});
    };
    apply();
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Ignore.
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);

  return { preference, setPreference };
}
