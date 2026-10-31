import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import VersionPicker, { isCompleteSelection } from './VersionPicker';
import { api, errorMessage } from '../api';
import { LOADER_LABELS } from '../loaders';
import type { Profile, VersionSelection } from '../types';

const INITIAL_SELECTION: VersionSelection = { mcVersion: '', loader: 'vanilla', loaderVersion: null };

interface Props {
  onClose: () => void;
  onCreated: (profile: Profile) => void;
}

export default function CreateProfileModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [selection, setSelection] = useState(INITIAL_SELECTION);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const ready = isCompleteSelection(selection);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || creating) return;
    setCreating(true);
    setError(null);
    try {
      onCreated(await api.profiles.create({ name, ...selection }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  };

  const placeholder = selection.mcVersion
    ? `${selection.loader === 'vanilla' ? 'Minecraft' : LOADER_LABELS[selection.loader]} ${selection.mcVersion}`
    : 'My profile';

  return (
    <Modal
      title="Create profile"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="create-profile" className="btn btn-primary" disabled={!ready || creating}>
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
            placeholder={placeholder}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <VersionPicker initial={INITIAL_SELECTION} onChange={setSelection} />

        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}
