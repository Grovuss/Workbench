import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Lock, LoaderCircle } from 'lucide-react';
import Modal from './Modal';
import ProfileIcon from './ProfileIcon';
import { api, errorMessage } from '../api';
import type { LaunchStatus, PendingUpdates, Profile } from '../types';

interface Props {
  profiles: Profile[];
  launches: Record<string, LaunchStatus>;
  onClose: () => void;
}

type Row = { state: 'checking' } | { state: 'failed'; error: string } | ({ state: 'ready' } & PendingUpdates);
type Progress = 'updating' | 'done' | { error: string };

// Profiles checked at once; each check makes a couple of Modrinth requests per kind of content.
const CHECKS_AT_ONCE = 3;

/** Checks every profile for content updates, then updates the chosen ones. Held items are left alone. */
export default function UpdateAllModal({ profiles, launches, onClose }: Props) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const queue = [...profiles];
    const next = async (): Promise<void> => {
      const profile = queue.shift();
      if (!profile || cancelled) return;
      setRows((r) => ({ ...r, [profile.id]: { state: 'checking' } }));
      try {
        const result = await api.content.pendingUpdates(profile.id);
        if (cancelled) return;
        setRows((r) => ({ ...r, [profile.id]: { state: 'ready', ...result } }));
        if (result.updates.length) setSelected((s) => new Set(s).add(profile.id));
      } catch (err) {
        if (!cancelled) setRows((r) => ({ ...r, [profile.id]: { state: 'failed', error: errorMessage(err) } }));
      }
      return next();
    };
    Array.from({ length: CHECKS_AT_ONCE }, next);
    return () => {
      cancelled = true;
    };
    // Checked once, when opened.
  }, []);

  const busy = (p: Profile) => Boolean(launches[p.id]);
  const checked = profiles.filter((p) => rows[p.id] && rows[p.id].state !== 'checking').length;
  const withUpdates = profiles.filter((p) => {
    const row = rows[p.id];
    return row?.state === 'ready' && row.updates.length > 0;
  });
  const upToDate = profiles.filter((p) => {
    const row = rows[p.id];
    return row?.state === 'ready' && row.updates.length === 0;
  });
  const failed = profiles.filter((p) => rows[p.id]?.state === 'failed');
  const chosen = withUpdates.filter((p) => selected.has(p.id) && !busy(p) && progress[p.id] !== 'done');
  const finished = checked === profiles.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const updateChosen = async () => {
    setRunning(true);
    for (const profile of chosen) {
      const row = rows[profile.id];
      if (row?.state !== 'ready') continue;
      setProgress((p) => ({ ...p, [profile.id]: 'updating' }));
      try {
        for (const kind of new Set(row.updates.map((u) => u.kind))) {
          await api.content.update(
            { profileId: profile.id, kind },
            row.updates.filter((u) => u.kind === kind).map((u) => u.fileName),
          );
        }
        setProgress((p) => ({ ...p, [profile.id]: 'done' }));
      } catch (err) {
        setProgress((p) => ({ ...p, [profile.id]: { error: errorMessage(err) } }));
      }
    }
    setRunning(false);
  };

  const pendingCount = chosen.reduce((sum, p) => {
    const row = rows[p.id];
    return sum + (row?.state === 'ready' ? row.updates.length : 0);
  }, 0);

  return (
    <Modal
      title="Update profiles"
      wide
      onClose={running ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={running}>
            {Object.values(progress).includes('done') && !running ? 'Done' : 'Cancel'}
          </button>
          <button className="btn btn-primary" onClick={updateChosen} disabled={running || chosen.length === 0}>
            {running ? <LoaderCircle size={15} className="spin" /> : null}
            {running
              ? 'Updating…'
              : chosen.length
                ? `Update ${pendingCount} ${pendingCount === 1 ? 'item' : 'items'} in ${chosen.length} ${chosen.length === 1 ? 'profile' : 'profiles'}`
                : 'Update'}
          </button>
        </>
      }
    >
      <p className="modal-text">
        {finished
          ? withUpdates.length
            ? 'Choose which profiles to update. Anything you’ve held at a version is left alone.'
            : 'Everything is up to date.'
          : `Checking profiles… ${checked} of ${profiles.length}`}
      </p>

      {withUpdates.length > 0 && (
        <ul className="update-all-list">
          {withUpdates.map((p) => {
            const row = rows[p.id] as Extract<Row, { state: 'ready' }>;
            const state = progress[p.id];
            const expanded = open === p.id;
            return (
              <li key={p.id} className="update-all-item">
                <div className="update-all-row">
                  <input
                    type="checkbox"
                    className="update-all-check"
                    checked={selected.has(p.id) && !busy(p)}
                    disabled={busy(p) || running || state === 'done'}
                    onChange={() => toggle(p.id)}
                    aria-label={`Update ${p.name}`}
                  />
                  <ProfileIcon profile={p} className="sidebar-pin-icon" />
                  <button className="update-all-name" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)}>
                    <strong>{p.name}</strong>
                    <span>
                      {row.updates.length} {row.updates.length === 1 ? 'update' : 'updates'}
                      {row.held > 0 && (
                        <>
                          {' · '}
                          <Lock size={11} /> {row.held} held
                        </>
                      )}
                    </span>
                    <ChevronDown size={15} className="project-version-chevron" />
                  </button>
                  <span className="update-all-state">
                    {busy(p) ? (
                      'Close the game to update'
                    ) : state === 'updating' ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : state === 'done' ? (
                      <span className="update-all-done">
                        <Check size={15} /> Updated
                      </span>
                    ) : state ? (
                      <span className="update-all-error" title={state.error}>
                        <AlertTriangle size={14} /> Failed
                      </span>
                    ) : null}
                  </span>
                </div>
                {expanded && (
                  <ul className="update-all-files">
                    {row.updates.map((u) => (
                      <li key={`${u.kind}:${u.fileName}`}>
                        <span>{u.title}</span>
                        <span className="update-all-versions">
                          {u.from ?? '?'} → <strong>{u.to}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {finished && (upToDate.length > 0 || failed.length > 0) && (
        <p className="update-all-summary">
          {upToDate.length > 0 && `${upToDate.length} ${upToDate.length === 1 ? 'profile is' : 'profiles are'} up to date.`}
          {failed.length > 0 && ` Couldn’t check ${failed.map((p) => p.name).join(', ')}.`}
        </p>
      )}
    </Modal>
  );
}
