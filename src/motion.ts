import { readStored, writeStored } from './stored';

const STORAGE_KEY = 'workbench.reduceMotion';

/** Whether animations were turned off in Settings (on top of the system's reduced-motion setting). */
export const reduceMotionStored = () => readStored(STORAGE_KEY, ['1', '0'], '0') === '1';

export function setReduceMotion(on: boolean) {
  document.documentElement.toggleAttribute('data-reduce-motion', on);
  writeStored(STORAGE_KEY, on ? '1' : '0');
}
