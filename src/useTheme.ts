import { useEffect } from 'react';
import { api } from './api';
import { useStoredChoice } from './stored';
import type { ThemePreference } from './types';

// index.html reads the same key before the page loads, to avoid a flash of the wrong theme.
const STORAGE_KEY = 'workbench.theme';

export function useTheme() {
  const [preference, setPreference] = useStoredChoice<ThemePreference>(STORAGE_KEY, ['light', 'dark', 'system'], 'system');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      document.documentElement.dataset.theme = resolved;
      api.window.setTheme(resolved === 'dark').catch(() => {});
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);

  return { preference, setPreference };
}
