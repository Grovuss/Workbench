const STORAGE_KEY = 'workbench.reduceMotion';

/** Whether animations were turned off in Settings (on top of the system's reduced-motion setting). */
export function reduceMotionStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setReduceMotion(on: boolean) {
  document.documentElement.toggleAttribute('data-reduce-motion', on);
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable; it still applies until the app closes.
  }
}
