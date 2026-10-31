import { useEffect, useState } from 'react';
import { Gauge, LoaderCircle } from 'lucide-react';
import Modal from '../Modal';
import ContentIcon from './ContentIcon';
import { api, errorMessage } from '../../api';
import type { InstalledContent, PerformanceMod, Profile } from '../../types';

interface Props {
  profile: Profile;
  onInstalled: (mods: InstalledContent[]) => void;
  onSuccess: (message: string) => void;
  onClose: () => void;
}

/** Picks well-known performance mods for the profile and installs them in one go. */
export default function PerformanceModal({ profile, onInstalled, onSuccess, onClose }: Props) {
  const [mods, setMods] = useState<PerformanceMod[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.content
      .performance(profile.id)
      .then((list) => {
        setMods(list);
        setSelected(new Set(list.filter((m) => !m.installed).map((m) => m.projectId)));
      })
      .catch((err) => setError(errorMessage(err)));
    // Loaded once per opening.
  }, []);

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.content.installMany({ profileId: profile.id, kind: 'mod' }, [...selected]);
      onInstalled(result.items);
      const n = result.installed.length;
      const titles = (ids: string[]) => ids.map((id) => mods?.find((m) => m.projectId === id)?.title ?? id).join(', ');
      const failed = result.skipped.length ? ` Couldn’t install ${titles(result.skipped.map((s) => s.projectId))}.` : '';
      onSuccess(`Installed ${n} performance ${n === 1 ? 'mod' : 'mods'}.${failed}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const allInstalled = mods !== null && mods.every((m) => m.installed);

  return (
    <Modal
      title="Make it run faster"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {allInstalled ? 'Close' : 'Cancel'}
          </button>
          {!allInstalled && (
            <button className="btn btn-primary" onClick={install} disabled={busy || selected.size === 0}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Gauge size={16} />}
              {busy ? 'Installing…' : `Install ${selected.size} ${selected.size === 1 ? 'mod' : 'mods'}`}
            </button>
          )}
        </>
      }
    >
      <p className="modal-text">
        Popular performance mods that work well together. They don’t change how the game looks or plays.
      </p>
      {!mods ? (
        !error && (
          <div className="mod-loading">
            <LoaderCircle size={22} className="spin" />
          </div>
        )
      ) : mods.length === 0 ? (
        <p className="mod-empty">
          None of them are available for {profile.mcVersion} on this loader yet.
        </p>
      ) : (
        <div className="pick-list">
          {allInstalled && <p className="pick-list-note">They’re all installed already.</p>}
          {mods.map((m) => (
            <label key={m.projectId} className="pick-row" data-disabled={m.installed || undefined}>
              <input
                type="checkbox"
                checked={m.installed || selected.has(m.projectId)}
                disabled={m.installed || busy}
                onChange={(e) => toggle(m.projectId, e.target.checked)}
              />
              <ContentIcon url={m.iconUrl} size={36} />
              <span className="pick-row-text">
                <strong>
                  {m.title}
                  {m.installed && <span className="kind-tag version-current">Installed</span>}
                </strong>
                <span>{m.about}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
