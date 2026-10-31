import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, FileCog, FolderOpen, Info, LoaderCircle, RotateCcw, Save, Search } from 'lucide-react';
import Modal from '../Modal';
import { api, errorMessage } from '../../api';
import { highlight } from '../../highlight';
import { timeAgo } from '../../time';
import type { ConfigFile } from '../../types';

interface Props {
  profileId: string;
  running: boolean;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

interface OpenFile {
  path: string;
  /** Text as last loaded or saved. */
  saved: string;
  text: string;
  modifiedAt: number;
}

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** JSON files must parse; JSON5 and the rest aren't checked. */
function invalidReason(file: OpenFile): string | null {
  if (!/\.json$/i.test(file.path)) return null;
  try {
    JSON.parse(file.text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid JSON';
  }
}

/** Mod config files and options.txt, with a plain text editor. */
export default function ConfigsTab({ profileId, running, onError, onSuccess }: Props) {
  const [files, setFiles] = useState<ConfigFile[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A file the user clicked while the open one had unsaved changes.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = Boolean(open && open.text !== open.saved);

  const loadList = useCallback(() => {
    api.configs
      .list(profileId)
      .then(setFiles)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, onError]);

  // Mods write their configs on first launch, so reload when the game stops.
  useEffect(loadList, [loadList, running]);

  const load = async (path: string) => {
    setLoading(path);
    setPendingSwitch(null);
    try {
      const { text, modifiedAt } = await api.configs.read(profileId, path);
      setOpen({ path, saved: text, text, modifiedAt });
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  const select = (path: string) => {
    if (path === open?.path) return;
    if (dirty) setPendingSwitch(path);
    else load(path);
  };

  /** Resolves to whether the file was saved. */
  const save = async (force = false): Promise<boolean> => {
    if (!open || saving) return false;
    if (!force) {
      const reason = invalidReason(open);
      if (reason) {
        setInvalid(reason);
        return false;
      }
    }
    setInvalid(null);
    setSaving(true);
    try {
      const result = await api.configs.write(profileId, open.path, open.text, open.modifiedAt, force);
      if (result.conflict) {
        setConflict(true);
        return false;
      }
      setConflict(false);
      setOpen((o) => o && { ...o, saved: o.text, modifiedAt: result.modifiedAt ?? o.modifiedAt });
      onSuccess(`Saved ${fileName(open.path)}.`);
      loadList();
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files ?? []).filter((f) => !q || f.path.toLowerCase().includes(q));
  }, [files, query]);

  if (!files) return null;

  if (files.length === 0) {
    return (
      <div className="empty empty-compact">
        <FileCog className="empty-icon" size={40} strokeWidth={1.5} />
        <h2>No config files yet</h2>
        <p>Mods create their config files the first time you play. Launch the game once, then come back.</p>
      </div>
    );
  }

  return (
    <>
      {running && (
        <div className="content-notice">
          <Info size={18} />
          <p>Minecraft is running. Most mods only read their config at startup, and some save over it when the game closes.</p>
        </div>
      )}
      <div className="configs">
        <div className="configs-files">
          <label className="search-field">
            <Search size={15} />
            <input className="input" value={query} placeholder={`Search ${files.length} files…`} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="configs-list" role="listbox" aria-label="Config files">
            {shown.map((f) => (
              <button
                key={f.path}
                role="option"
                aria-selected={f.path === open?.path}
                className="config-file"
                onClick={() => select(f.path)}
                title={f.path}
              >
                <span className="config-file-name">
                  {f.path === open?.path && dirty && <span className="config-dirty" aria-label="Unsaved changes" />}
                  {fileName(f.path)}
                </span>
                {folderOf(f.path) !== 'config' && <span className="config-file-folder">{folderOf(f.path) || 'Game folder'}</span>}
                {loading === f.path && <LoaderCircle size={13} className="spin config-file-spin" />}
              </button>
            ))}
            {shown.length === 0 && <p className="mod-empty">Nothing matches.</p>}
          </div>
        </div>

        <div className="configs-editor">
          {open ? (
            <>
              <div className="config-bar">
                <div className="config-bar-title">
                  <strong>{fileName(open.path)}</strong>
                  <span>
                    {open.path} · changed {timeAgo(new Date(open.modifiedAt).toISOString())}
                  </span>
                </div>
                <button className="icon-btn" aria-label="Show in folder" title="Show in folder" onClick={() => api.configs.reveal(profileId, open.path).catch((err) => onError(errorMessage(err)))}>
                  <FolderOpen size={15} />
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen({ ...open, text: open.saved })} disabled={!dirty || saving}>
                  <RotateCcw size={14} /> Undo changes
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => save()} disabled={!dirty || saving} title="Save (Ctrl+S)">
                  {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Save
                </button>
              </div>
              {invalid && (
                <div className="config-warning">
                  <AlertTriangle size={16} />
                  <span>
                    This isn’t valid JSON, so the mod may ignore it or reset it. <code>{invalid}</code>
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => save(true)}>
                    Save anyway
                  </button>
                </div>
              )}
              <CodeEditor
                key={open.path}
                path={open.path}
                value={open.text}
                onChange={(text) => setOpen({ ...open, text })}
                onSave={() => save()}
              />
            </>
          ) : (
            <div className="configs-placeholder">
              <FileCog size={32} strokeWidth={1.5} />
              <p>Pick a file to edit it.</p>
            </div>
          )}
        </div>
      </div>

      {pendingSwitch && open && (
        <Modal
          title="Unsaved changes"
          onClose={() => setPendingSwitch(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => load(pendingSwitch)}>
                Discard
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const next = pendingSwitch;
                  setPendingSwitch(null);
                  if (await save()) load(next);
                }}
              >
                Save first
              </button>
            </>
          }
        >
          <p className="modal-text">You changed {fileName(open.path)} but haven’t saved it.</p>
        </Modal>
      )}

      {conflict && open && (
        <Modal
          title="The file changed"
          onClose={() => setConflict(false)}
          footer={
            <>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setConflict(false);
                  load(open.path);
                }}
              >
                Load the new version
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConflict(false);
                  save(true);
                }}
              >
                Keep my changes
              </button>
            </>
          }
        >
          <p className="modal-text">
            Something else changed {fileName(open.path)} since you opened it, probably the mod itself. Loading the new
            version throws away your edits.
          </p>
        </Modal>
      )}
    </>
  );
}

/**
 * A textarea with line numbers; Tab indents and Ctrl+S saves. The text is see-through and
 * a coloured copy sits behind it, so typing, selection and undo stay the browser's own.
 */
function CodeEditor({
  path,
  value,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const colored = useRef<HTMLPreElement>(null);
  const tokens = useMemo(() => highlight(value, path), [value, path]);
  const lines = tokens.length;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
    }
  };

  return (
    <div className="code-editor">
      <div className="code-gutter" ref={gutter} aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="code-area">
        <pre className="code-colored" ref={colored} aria-hidden>
          {tokens.map((line, i) => (
            <div key={i}>
              {line.map((t, j) =>
                t.kind ? (
                  <span key={j} className={`tok-${t.kind}`}>
                    {t.text}
                  </span>
                ) : (
                  t.text
                ),
              )}
            </div>
          ))}
        </pre>
        <textarea
          className="code-text"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          aria-label="File contents"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            const { scrollTop, scrollLeft } = e.currentTarget;
            if (gutter.current) gutter.current.scrollTop = scrollTop;
            if (colored.current) colored.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
          }}
        />
      </div>
    </div>
  );
}
