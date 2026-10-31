import type { WorkbenchApi } from './types';

// Bridge exposed by electron/preload.cjs.
export const api: WorkbenchApi = window.workbench;

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
