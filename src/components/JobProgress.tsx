import { useEffect, useState } from 'react';
import ProgressBar from './ProgressBar';
import { api } from '../api';
import type { ImportProgress } from '../types';

/** Progress from long main-process jobs (imports, modpack installs and updates, server packs); reset before starting one. */
export function useJobProgress() {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  useEffect(
    () =>
      api.game.onEvent((event) => {
        if (event.type === 'import-progress') setProgress({ label: event.label, done: event.done, total: event.total });
      }),
    [],
  );
  return [progress, () => setProgress(null)] as const;
}

/** A bar and "Downloading mods · 12 / 40" for a running job. */
export default function JobProgress({ progress, label, waiting = 'Starting…' }: { progress: ImportProgress | null; label: string; waiting?: string }) {
  return (
    <div className="import-status">
      <ProgressBar value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : null} label={label} />
      <span>{progress ? `${progress.label}${progress.total > 1 ? ` · ${progress.done} / ${progress.total}` : ''}` : waiting}</span>
    </div>
  );
}
