import { useEffect, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { api, errorMessage } from '../api';
import type { McVersion, Profile } from '../types';

const LOADERS = [
  { id: 'vanilla', label: 'Vanilla', available: true },
  { id: 'fabric', label: 'Fabric', available: false },
  { id: 'forge', label: 'Forge', available: false },
  { id: 'neoforge', label: 'NeoForge', available: false },
];

interface Props {
  onClose: () => void;
  onCreated: (profile: Profile) => void;
}

export default function CreateProfileModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [versions, setVersions] = useState<McVersion[] | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [version, setVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.versions
      .list()
      .then((vs) => {
        setVersions(vs);
        setVersion(vs.find((v) => v.type === 'release')?.id ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const visible = versions?.filter((v) => showSnapshots || v.type === 'release') ?? [];

  const toggleSnapshots = (on: boolean) => {
    setShowSnapshots(on);
    if (!on && versions?.find((v) => v.id === version)?.type === 'snapshot') {
      setVersion(versions.find((v) => v.type === 'release')?.id ?? '');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!version || creating) return;
    setCreating(true);
    setError(null);
    try {
      onCreated(await api.profiles.create({ name, mcVersion: version }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  };

  return (
    <Modal
      title="Create profile"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="create-profile" className="btn btn-primary" disabled={!version || creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <form id="create-profile" className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            maxLength={48}
            placeholder={version ? `Minecraft ${version}` : 'My profile'}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="field">
          <span className="field-label">Loader</span>
          <div className="segmented" role="group" aria-label="Loader">
            {LOADERS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={l.id === 'vanilla'}
                disabled={!l.available}
                title={l.available ? undefined : 'Coming soon'}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Minecraft version</span>
          <select
            className="input"
            value={version}
            disabled={!versions}
            onChange={(e) => setVersion(e.target.value)}
          >
            {!versions && <option>Loading versions…</option>}
            {visible.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
                {v.type === 'snapshot' ? ' (snapshot)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={showSnapshots} onChange={(e) => toggleSnapshots(e.target.checked)} />
          Show snapshots
        </label>

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}
