import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Layers, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import Modal from '../Modal';
import ContentIcon from './ContentIcon';
import { api, errorMessage } from '../../api';
import { CONTENT } from '../../content';
import type { ContentKind, InstalledContent, ModSet, ModSetEntry, Profile } from '../../types';

type SetKind = ModSetEntry['kind'];
const SET_KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader'];

interface Props {
  profile: Profile;
  /** Kinds this profile can use. */
  kinds: ContentKind[];
  /** Everything installed, for saving a new set. */
  installed: (InstalledContent & { kind: ContentKind })[];
  onInstalled: (kind: ContentKind, items: InstalledContent[]) => void;
  onSuccess: (message: string) => void;
  onClose: () => void;
}

/** Saved groups of mods (and packs) that can be added to any profile. */
export default function ModSetsModal({ profile, kinds, installed, onInstalled, onSuccess, onClose }: Props) {
  const [sets, setSets] = useState<ModSet[] | null>(null);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.modSets
      .list()
      .then((list) => {
        setSets(list);
        if (!list.length) setView('create');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const installedIds = useMemo(() => new Set(installed.map((m) => m.projectId).filter(Boolean)), [installed]);

  const addToProfile = (set: ModSet) =>
    run(set.id, async () => {
      const usable = set.entries.filter((e) => kinds.includes(e.kind));
      const fresh = usable.filter((e) => !installedIds.has(e.projectId));
      const skipped: string[] = set.entries.filter((e) => !kinds.includes(e.kind)).map((e) => e.title);
      let added = 0;
      for (const kind of SET_KINDS) {
        const ids = fresh.filter((e) => e.kind === kind).map((e) => e.projectId);
        if (!ids.length) continue;
        const result = await api.content.installMany({ profileId: profile.id, kind }, ids);
        onInstalled(kind, result.items);
        added += result.installed.length;
        skipped.push(...result.skipped.map((s) => set.entries.find((e) => e.projectId === s.projectId)?.title ?? s.projectId));
      }
      const already = usable.length - fresh.length;
      const parts = [`Added ${added} from ${set.name}.`];
      if (already) parts.push(`${already} ${already === 1 ? 'was' : 'were'} already installed.`);
      if (skipped.length) parts.push(`Not available for ${profile.mcVersion} here: ${skipped.join(', ')}.`);
      onSuccess(parts.join(' '));
      onClose();
    });

  return (
    <Modal
      title={view === 'create' ? 'New mod set' : 'Mod sets'}
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        view === 'list' ? (
          <>
            <button className="btn btn-secondary" onClick={() => setView('create')} disabled={Boolean(busy)}>
              <Plus size={16} /> New set from this profile
            </button>
            <button className="btn btn-primary" onClick={onClose} disabled={Boolean(busy)}>
              Done
            </button>
          </>
        ) : undefined
      }
    >
      {!sets ? (
        !error && (
          <div className="mod-loading">
            <LoaderCircle size={22} className="spin" />
          </div>
        )
      ) : view === 'create' ? (
        <CreateSet
          installed={installed}
          canGoBack={sets.length > 0}
          onBack={() => setView('list')}
          onCancel={onClose}
          onCreate={(name, entries) =>
            run('create', async () => {
              setSets(await api.modSets.create(name, entries));
              setView('list');
              onSuccess(`Saved ${name}. Add it to any profile from here.`);
            })
          }
          busy={busy === 'create'}
        />
      ) : (
        <>
          <p className="modal-text">
            Sets remember which mods you like to use together. Adding one gets the right version of each mod for this
            profile.
          </p>
          <div className="set-list">
            {sets.map((set) => (
              <SetRow
                key={set.id}
                set={set}
                installedIds={installedIds}
                busy={busy}
                onAdd={() => addToProfile(set)}
                onRename={(name) => run(`rename:${set.id}`, async () => setSets(await api.modSets.update(set.id, { name })))}
                onRemoveEntry={(projectId) =>
                  run(`entry:${set.id}`, async () =>
                    setSets(await api.modSets.update(set.id, { entries: set.entries.filter((e) => e.projectId !== projectId) })),
                  )
                }
                onDelete={() => run(`delete:${set.id}`, async () => setSets(await api.modSets.remove(set.id)))}
              />
            ))}
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

function SetRow({
  set,
  installedIds,
  busy,
  onAdd,
  onRename,
  onRemoveEntry,
  onDelete,
}: {
  set: ModSet;
  installedIds: Set<string | null>;
  busy: string | null;
  onAdd: () => void;
  onRename: (name: string) => void;
  onRemoveEntry: (projectId: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const missing = set.entries.filter((e) => !installedIds.has(e.projectId)).length;
  const adding = busy === set.id;

  const saveName = () => {
    if (renaming?.trim() && renaming.trim() !== set.name) onRename(renaming);
    setRenaming(null);
  };

  return (
    <div className="set-row">
      <div className="set-head">
        <button className="set-toggle" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Show what’s in ${set.name}`}>
          <ChevronDown size={16} />
        </button>
        <div className="set-icons" aria-hidden>
          {set.entries.slice(0, 4).map((e) => (
            <ContentIcon key={e.projectId} url={e.iconUrl} size={28} />
          ))}
        </div>
        <div className="set-info">
          {renaming !== null ? (
            <input
              className="input set-name-input"
              value={renaming}
              maxLength={48}
              autoFocus
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <strong>{set.name}</strong>
          )}
          <span>
            {set.entries.length} {set.entries.length === 1 ? 'item' : 'items'}
            {missing === 0 ? ' · all in this profile' : missing < set.entries.length ? ` · ${missing} not in this profile` : ''}
          </span>
        </div>
        <button className="icon-btn" aria-label={`Rename ${set.name}`} title="Rename" onClick={() => setRenaming(set.name)} disabled={Boolean(busy)}>
          <Pencil size={15} />
        </button>
        {confirmDelete ? (
          <button className="btn btn-ghost btn-danger btn-sm" onClick={onDelete} onBlur={() => setConfirmDelete(false)} autoFocus>
            Delete set?
          </button>
        ) : (
          <button className="icon-btn icon-btn-danger" aria-label={`Delete ${set.name}`} title="Delete" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)}>
            <Trash2 size={15} />
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={onAdd} disabled={Boolean(busy) || missing === 0}>
          {adding ? <LoaderCircle size={15} className="spin" /> : missing === 0 ? <Check size={15} /> : <Plus size={15} />}
          {adding ? 'Adding…' : missing === 0 ? 'Added' : 'Add to profile'}
        </button>
      </div>
      {open && (
        <ul className="set-entries">
          {set.entries.map((e) => (
            <li key={e.projectId}>
              <ContentIcon url={e.iconUrl} size={24} />
              <span className="set-entry-title">{e.title}</span>
              {e.kind !== 'mod' && <span className="kind-tag">{CONTENT[e.kind].noun}</span>}
              {installedIds.has(e.projectId) && <span className="kind-tag version-current">Installed</span>}
              {set.entries.length > 1 && (
                <button className="icon-btn" aria-label={`Remove ${e.title} from the set`} title="Remove from set" onClick={() => onRemoveEntry(e.projectId)} disabled={Boolean(busy)}>
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateSet({
  installed,
  canGoBack,
  busy,
  onBack,
  onCancel,
  onCreate,
}: {
  installed: (InstalledContent & { kind: ContentKind })[];
  canGoBack: boolean;
  busy: boolean;
  onBack: () => void;
  onCancel: () => void;
  onCreate: (name: string, entries: ModSetEntry[]) => void;
}) {
  // Only Modrinth projects can go in a set; local files have nothing to download from.
  // A project can be installed twice under different file names, so keep one of each.
  const candidates = useMemo(
    () =>
      [
        ...new Map(
          installed
            .filter((m): m is typeof m & { projectId: string; kind: SetKind } => Boolean(m.projectId) && SET_KINDS.includes(m.kind))
            .map((m) => [m.projectId, m]),
        ).values(),
      ].sort((a, b) => SET_KINDS.indexOf(a.kind) - SET_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title)),
    [installed],
  );
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((m) => m.projectId)));
  const allPicked = picked.size === candidates.length;

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const create = () =>
    onCreate(
      name,
      candidates
        .filter((m) => picked.has(m.projectId))
        .map((m) => ({ projectId: m.projectId, kind: m.kind, title: m.title, iconUrl: m.iconUrl })),
    );

  return (
    <>
      {canGoBack && (
        <button className="btn btn-ghost set-back" onClick={onBack} disabled={busy}>
          <ArrowLeft size={16} /> All sets
        </button>
      )}
      {candidates.length === 0 ? (
        <div className="empty empty-compact">
          <Layers className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>Nothing to save yet</h2>
          <p>Install some mods from Modrinth in this profile, then save them as a set to reuse in other profiles.</p>
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={name}
              maxLength={48}
              placeholder="My usual mods"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="pick-list-head">
            <span>
              {picked.size} of {candidates.length} picked
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(allPicked ? new Set() : new Set(candidates.map((m) => m.projectId)))}>
              {allPicked ? 'Pick none' : 'Pick all'}
            </button>
          </div>
          <div className="pick-list pick-list-scroll">
            {candidates.map((m) => (
              <label key={m.projectId} className="pick-row pick-row-compact">
                <input type="checkbox" checked={picked.has(m.projectId)} disabled={busy} onChange={(e) => toggle(m.projectId, e.target.checked)} />
                <ContentIcon url={m.iconUrl} size={28} />
                <span className="pick-row-text">
                  <strong>
                    {m.title}
                    {m.kind !== 'mod' && <span className="kind-tag">{CONTENT[m.kind].noun}</span>}
                  </strong>
                </span>
              </label>
            ))}
          </div>
          <p className="content-hint">Local files can’t go in a set, since there’s nowhere to download them from.</p>
        </>
      )}
      <div className="modal-inline-footer">
        <button className="btn btn-secondary" onClick={canGoBack ? onBack : onCancel} disabled={busy}>
          {canGoBack ? 'Back' : 'Cancel'}
        </button>
        {candidates.length > 0 && (
          <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim() || picked.size === 0}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Layers size={16} />} Save set
          </button>
        )}
      </div>
    </>
  );
}
