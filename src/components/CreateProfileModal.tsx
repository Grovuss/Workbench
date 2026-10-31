import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ExternalLink, FileDown, Package, QrCode, Upload } from 'lucide-react';
import logo from '../assets/logo.svg';
import Modal from './Modal';
import ProgressBar from './ProgressBar';
import VersionPicker, { isCompleteSelection } from './VersionPicker';
import { api, errorMessage } from '../api';
import { LOADER_LABELS } from '../loaders';
import type { ImportProgress, ImportResult, MissingPackFile, PackKind, Profile, SharePreview, VersionSelection } from '../types';

const INITIAL_SELECTION: VersionSelection = { mcVersion: '', loader: 'vanilla', loaderVersion: null };

export type Mode = 'new' | 'import';

interface Props {
  onClose: () => void;
  onCreated: (profile: Profile) => void;
  /** Opens on Import and imports this pack straight away, e.g. one double-clicked in Explorer. */
  initialFile?: string;
  /** Opens on the Import tab. */
  initialMode?: Mode;
}

export default function CreateProfileModal({ onClose, onCreated, initialFile, initialMode }: Props) {
  const [mode, setMode] = useState<Mode>(initialFile ? 'import' : (initialMode ?? 'new'));
  const startedFile = useRef(false);
  const [name, setName] = useState('');
  const [selection, setSelection] = useState(INITIAL_SELECTION);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [curseforge, setCurseforge] = useState(false);
  // An import that finished with files the player has to download themselves.
  const [partial, setPartial] = useState<ImportResult | null>(null);
  // Pasting a share code instead of picking a file.
  const [code, setCode] = useState<string | null>(null);
  const [codePreview, setCodePreview] = useState<SharePreview | null>(null);
  const ready = isCompleteSelection(selection);

  useEffect(
    () =>
      api.game.onEvent((event) => {
        if (event.type === 'import-progress') setProgress({ label: event.label, done: event.done, total: event.total });
      }),
    [],
  );

  useEffect(() => {
    api.system
      .info()
      .then((info) => setCurseforge(info.curseforge))
      .catch(() => {});
  }, []);

  const finish = (profile: Profile) => {
    onCreated(profile);
    onClose();
  };

  const run = async (pending: () => Promise<ImportResult | null>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const result = await pending();
      if (result?.missing.length) return setPartial(result);
      if (result) return finish(result.profile);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
    setProgress(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) run(async () => ({ profile: await api.profiles.create({ name, ...selection }), missing: [] }));
  };

  const pick = (kind: PackKind) => run(() => api.packs.import(kind));

  // Once, even though React runs effects twice in development.
  useEffect(() => {
    if (!initialFile || startedFile.current) return;
    startedFile.current = true;
    run(() => api.packs.importFile(initialFile));
  }, [initialFile]);

  const changeCode = (text: string) => {
    setCode(text);
    setCodePreview(null);
    setError(null);
    if (!text.trim()) return;
    api.share
      .preview(text)
      .then(setCodePreview)
      .catch((err) => setError(errorMessage(err)));
  };

  const importCode = () =>
    run(async () => {
      const { profile } = await api.share.import(code ?? '');
      return { profile, missing: [] };
    });

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = api.pathForFile(file);
    const pattern = curseforge ? /\.(workbench|mrpack|zip)$/i : /\.(workbench|mrpack)$/i;
    if (!pattern.test(path)) {
      setError(curseforge ? 'Drop a .workbench, .mrpack or CurseForge .zip file.' : 'Drop a .workbench or .mrpack file.');
      return;
    }
    run(() => api.packs.importFile(path));
  };

  if (partial) {
    return (
      <MissingFilesModal
        result={partial}
        onDone={() => finish(partial.profile)}
        onError={(message) => setError(message)}
      />
    );
  }

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
    ) : code !== null && !busy ? (
      <>
        <button type="button" className="btn btn-secondary" onClick={() => setCode(null)}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={importCode} disabled={!codePreview}>
          Import
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
      ) : code !== null ? (
        <div className="form">
          <label className="field">
            <span className="field-label">Share code</span>
            <textarea
              className="input share-code"
              rows={4}
              value={code}
              placeholder="WB1.…"
              spellCheck={false}
              autoFocus
              onChange={(e) => changeCode(e.target.value)}
            />
          </label>
          {codePreview && (
            <div className="share-preview">
              <strong>{codePreview.name || 'Shared profile'}</strong>
              <span>
                {codePreview.loader === 'vanilla' ? 'Minecraft' : LOADER_LABELS[codePreview.loader]} {codePreview.mcVersion} ·{' '}
                {[
                  codePreview.counts.mod && `${codePreview.counts.mod} ${codePreview.counts.mod === 1 ? 'mod' : 'mods'}`,
                  codePreview.counts.resourcepack && `${codePreview.counts.resourcepack} resource ${codePreview.counts.resourcepack === 1 ? 'pack' : 'packs'}`,
                  codePreview.counts.shader && `${codePreview.counts.shader} ${codePreview.counts.shader === 1 ? 'shader' : 'shaders'}`,
                ]
                  .filter(Boolean)
                  .join(', ') || 'no mods'}
              </span>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
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
            <button className="import-option" disabled={!curseforge} onClick={() => pick('curseforge')}>
              <span className="import-option-icon import-option-curseforge">
                <Package size={18} />
              </span>
              <span>
                <strong>CurseForge pack</strong> <code>.zip</code>
                <small>
                  {curseforge
                    ? 'Some authors don’t allow launcher downloads; you’ll get links for those.'
                    : 'Waiting on a CurseForge API key.'}
                </small>
              </span>
              {!curseforge && <span className="soon-pill soon-pill-inline">Soon</span>}
            </button>
            <button className="import-option" onClick={() => setCode('')}>
              <span className="import-option-icon">
                <QrCode size={18} />
              </span>
              <span>
                <strong>Share code</strong>
                <small>Paste a code a friend sent you from their Workbench.</small>
              </span>
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

/** After a CurseForge import: files the player needs to fetch from CurseForge themselves. */
function MissingFilesModal({
  result,
  onDone,
  onError,
}: {
  result: ImportResult;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const open = (url: string) => api.system.openCurseForge(url).catch((err) => onError(errorMessage(err)));
  const byAuthor = result.missing.filter((m) => m.reason === 'author');
  const unsupported = result.missing.filter((m) => m.reason === 'unsupported');

  return (
    <Modal
      title={`“${result.profile.name}” is almost ready`}
      onClose={onDone}
      footer={
        <button className="btn btn-primary" onClick={onDone}>
          Go to profile
        </button>
      }
    >
      {byAuthor.length > 0 && (
        <>
          <p className="modal-text">
            {byAuthor.length === 1 ? 'One file’s author doesn’t' : `${byAuthor.length} files’ authors don’t`} allow
            launchers to download them. Download each from CurseForge, then drag the files into the profile’s Mods tab.
          </p>
          <MissingList files={byAuthor} onOpen={open} />
        </>
      )}
      {unsupported.length > 0 && (
        <>
          <p className="modal-text">
            Workbench skipped {unsupported.length === 1 ? 'this file' : 'these files'}, since {unsupported.length === 1 ? 'it isn’t' : 'they aren’t'} a
            mod, resource pack or shader:
          </p>
          <MissingList files={unsupported} onOpen={open} />
        </>
      )}
    </Modal>
  );
}

function MissingList({ files, onOpen }: { files: MissingPackFile[]; onOpen: (url: string) => void }) {
  return (
    <ul className="missing-list">
      {files.map((f) => (
        <li key={f.fileName}>
          <span>
            <strong>{f.name}</strong>
            <code>{f.fileName}</code>
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => onOpen(f.url)}>
            <ExternalLink size={14} /> CurseForge
          </button>
        </li>
      ))}
    </ul>
  );
}
