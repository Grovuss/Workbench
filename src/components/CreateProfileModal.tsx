import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { FileDown, Package, Upload } from 'lucide-react';
import logo from '../assets/logo.svg';
import Modal from './Modal';
import ProgressBar from './ProgressBar';
import VersionPicker, { isCompleteSelection } from './VersionPicker';
import { api, errorMessage } from '../api';
import { LOADER_LABELS } from '../loaders';
import type { ImportProgress, PackKind, Profile, VersionSelection } from '../types';

const INITIAL_SELECTION: VersionSelection = { mcVersion: '', loader: 'vanilla', loaderVersion: null };

type Mode = 'new' | 'import';

interface Props {
  onClose: () => void;
  onCreated: (profile: Profile) => void;
}

export default function CreateProfileModal({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('new');
  const [name, setName] = useState('');
  const [selection, setSelection] = useState(INITIAL_SELECTION);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const ready = isCompleteSelection(selection);

  useEffect(
    () =>
      api.game.onEvent((event) => {
        if (event.type === 'import-progress') setProgress({ label: event.label, done: event.done, total: event.total });
      }),
    [],
  );

  const finish = (profile: Profile) => {
    onCreated(profile);
    onClose();
  };

  const run = async (pending: () => Promise<Profile | null>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const profile = await pending();
      if (profile) return finish(profile);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
    setProgress(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) run(() => api.profiles.create({ name, ...selection }));
  };

  const pick = (kind: PackKind) => run(() => api.packs.import(kind));

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = api.pathForFile(file);
    if (!/\.(workbench|mrpack)$/i.test(path)) {
      setError('Drop a .workbench or .mrpack file.');
      return;
    }
    run(() => api.packs.importFile(path));
  };

  const placeholder = selection.mcVersion
    ? `${selection.loader === 'vanilla' ? 'Minecraft' : LOADER_LABELS[selection.loader]} ${selection.mcVersion}`
    : 'My profile';

  const footer =
    mode === 'new' ? (
      <>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" form="create-profile" className="btn btn-primary" disabled={!ready || busy}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </>
    ) : (
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
        Cancel
      </button>
    );

  return (
    <Modal title="Create profile" onClose={busy ? () => {} : onClose} footer={footer}>
      <div className="segmented segmented-full" role="group" aria-label="Create profile mode">
        <button aria-pressed={mode === 'new'} disabled={busy} onClick={() => setMode('new')}>
          New profile
        </button>
        <button aria-pressed={mode === 'import'} disabled={busy} onClick={() => setMode('import')}>
          <FileDown size={14} /> Import pack
        </button>
      </div>

      {mode === 'new' ? (
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
      ) : busy ? (
        <div className="import-status">
          <ProgressBar
            value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : null}
            label="Importing pack"
          />
          <span>
            {progress
              ? `${progress.label}${progress.total > 1 ? ` · ${progress.done} / ${progress.total}` : ''}`
              : 'Reading pack…'}
          </span>
        </div>
      ) : (
        <div className="form">
          <div className="import-options">
            <button className="import-option import-option-primary" onClick={() => pick('workbench')}>
              <img src={logo} alt="" className="import-option-icon" />
              <span>
                <strong>Workbench pack</strong> <code>.workbench</code>
                <small>Profiles exported from Workbench, with mods, config and settings.</small>
              </span>
            </button>
            <button className="import-option" onClick={() => pick('mrpack')}>
              <span className="import-option-icon import-option-modrinth">
                <Package size={18} />
              </span>
              <span>
                <strong>Modrinth pack</strong> <code>.mrpack</code>
                <small>Mods download straight from Modrinth.</small>
              </span>
            </button>
            <button className="import-option" disabled>
              <span className="import-option-icon import-option-curseforge">
                <Package size={18} />
              </span>
              <span>
                <strong>CurseForge pack</strong> <code>.zip</code>
                <small>Needs a CurseForge API key, coming later.</small>
              </span>
              <span className="soon-pill soon-pill-inline">Soon</span>
            </button>
          </div>

          <div
            className="drop-zone"
            data-active={dragging || undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <Upload size={18} />
            Or drop a pack file here
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
