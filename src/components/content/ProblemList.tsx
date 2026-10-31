import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { api, errorMessage } from '../../api';
import type { InstalledContent, Problem, ProblemFix } from '../../types';

/** Applies a problem's fix: turns a mod off, installs a missing one, or opens settings. */
export async function applyFix(
  profileId: string,
  fix: ProblemFix,
  { onModsChanged, onOpenSettings }: { onModsChanged?: (mods: InstalledContent[]) => void; onOpenSettings: () => void },
) {
  if (fix.type === 'settings') return onOpenSettings();
  const mods =
    fix.type === 'disable'
      ? await api.content.setEnabled({ profileId, kind: 'mod' }, fix.fileName, false)
      : await api.diagnose.installDependency(profileId, fix.modId);
  onModsChanged?.(mods);
}

interface Props {
  problems: Problem[];
  onFix: (fix: ProblemFix) => Promise<void> | void;
  onError: (message: string) => void;
}

/** Problems, each with buttons that fix it. */
export default function ProblemList({ problems, onFix, onError }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const run = async (key: string, fix: ProblemFix) => {
    setBusy(key);
    try {
      await onFix(fix);
      setDone((d) => new Set(d).add(key));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="problem-list">
      {problems.map((p) => (
        <li key={p.id}>
          <p>{p.message}</p>
          {p.fixes.length > 0 && (
            <div className="problem-fixes">
              {p.fixes.map((fix, i) => {
                const key = `${p.id}#${i}`;
                if (done.has(key)) {
                  return (
                    <span key={key} className="problem-done">
                      <Check size={14} /> Done
                    </span>
                  );
                }
                return (
                  <button
                    key={key}
                    className={`btn btn-sm ${i === 0 ? 'btn-secondary' : 'btn-ghost'}`}
                    disabled={busy !== null}
                    onClick={() => run(key, fix)}
                  >
                    {busy === key && <LoaderCircle size={13} className="spin" />}
                    {fix.label}
                  </button>
                );
              })}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
