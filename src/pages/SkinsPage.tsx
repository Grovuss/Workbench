import { Suspense, lazy, useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Ban,
  ChevronDown,
  FolderInput,
  FolderMinus,
  LoaderCircle,
  LogIn,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Shirt,
  Trash2,
  Upload,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SkinView, { CapeView } from '../components/SkinView';
import Dropdown from '../components/Dropdown';
import GroupModal from '../components/GroupModal';
import { api, errorMessage } from '../api';
import { useStoredSet } from '../stored';
import type { AccountsState, LibrarySkin, SkinState, SkinVariant } from '../types';

// three.js is big, so the 3D view loads with this page rather than with the app.
const Skin3D = lazy(() => import('../components/Skin3D'));

interface Props {
  accounts: AccountsState;
  onLogin: () => void;
  /** The account's skin changed: refresh the sidebar head. */
  onSkinChanged: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const VARIANTS: { id: SkinVariant; label: string }[] = [
  { id: 'classic', label: 'Wide' },
  { id: 'slim', label: 'Slim' },
];

export default function SkinsPage({ accounts, onLogin, onSkinChanged, onError, onSuccess }: Props) {
  const active = accounts.accounts.find((a) => a.id === accounts.activeId);
  const [state, setState] = useState<SkinState | null>(null);
  const [library, setLibrary] = useState<LibrarySkin[] | null>(null);
  // What's being changed: a library skin id, a cape id, 'reset', 'save' or 'no-cape'.
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [collapsed, toggleCollapsed] = useStoredSet('workbench.collapsedSkinGroups');
  // A skin being moved to a group, or a group being renamed.
  const [grouping, setGrouping] = useState<LibrarySkin | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const signedIn = Boolean(active && !active.offline);

  useEffect(() => {
    api.skins
      .library()
      .then(setLibrary)
      .catch((err) => onError(errorMessage(err)));
  }, [onError]);

  useEffect(() => {
    setState(null);
    if (!signedIn) return;
    api.skins
      .state()
      .then(setState)
      .catch((err) => onError(errorMessage(err)));
  }, [signedIn, active?.id, onError]);

  const run = useCallback(
    async (key: string, action: () => Promise<SkinState>, message: string) => {
      setBusy(key);
      try {
        setState(await action());
        onSkinChanged();
        onSuccess(message);
      } catch (err) {
        onError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [onSkinChanged, onError, onSuccess],
  );

  const updateLibrary = async (pending: Promise<LibrarySkin[] | null>) => {
    try {
      const next = await pending;
      if (next) setLibrary(next);
      return next;
    } catch (err) {
      onError(errorMessage(err));
      return null;
    }
  };

  const saveCurrent = async () => {
    setBusy('save');
    const before = library?.length ?? 0;
    const next = await updateLibrary(api.skins.saveCurrent());
    setBusy(null);
    if (next) onSuccess(next.length > before ? 'Saved to your library.' : 'Already in your library: updated its arm style and cape.');
  };

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter((p) => /\.png$/i.test(p));
    if (paths.length) updateLibrary(api.skins.addFiles(paths));
    else onError('Drop PNG skin files.');
  };

  if (!signedIn) {
    return (
      <>
        <PageHeader title="Skins" subtitle="Your skin and cape" />
        <div className="empty">
          <Shirt className="empty-icon" size={48} strokeWidth={1.5} />
          <h2>{active?.offline ? 'Skins need a Microsoft account' : 'Sign in to change your skin'}</h2>
          <p>Skins and capes belong to your Minecraft account, so they follow you to every launcher and server.</p>
          <button className="btn btn-primary" onClick={onLogin}>
            <LogIn size={16} /> Sign in
          </button>
        </div>
      </>
    );
  }

  const activeCape = state?.capes.find((c) => c.active) ?? null;
  const groupNames = [...new Set((library ?? []).map((s) => s.group).filter((g): g is string => Boolean(g)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const sections = groupNames.length
    ? [
        ...groupNames.map((name) => ({ name, items: library!.filter((s) => s.group === name) })),
        { name: null, items: (library ?? []).filter((s) => !s.group) },
      ].filter((s) => s.items.length > 0)
    : [{ name: null, items: library ?? [] }];

  const addButton = (
    <button className="btn btn-primary" onClick={() => updateLibrary(api.skins.pick())}>
      <Upload size={16} /> Add skin
    </button>
  );

  const card = (skin: LibrarySkin) => {
    const cape = skin.capeId ? state?.capes.find((c) => c.id === skin.capeId) : null;
    return (
      <div key={skin.id} className="skin-card">
        <button
          className="skin-card-wear"
          disabled={busy !== null}
          onClick={() => run(skin.id, () => api.skins.wear(skin.id), `Now wearing ${skin.name}.`)}
          title={`Wear ${skin.name}`}
        >
          <span className="skin-card-preview">
            {busy === skin.id ? (
              <LoaderCircle size={22} className="spin" />
            ) : (
              <SkinView url={`workbench://skin/${skin.id}`} variant={skin.variant} scale={5} label={skin.name} />
            )}
          </span>
          <span className="skin-card-name">{skin.name}</span>
          {cape && <span className="skin-card-cape">with {cape.alias} cape</span>}
        </button>
        <div className="skin-card-actions">
          <div className="segmented skin-variant" role="group" aria-label="Arm style">
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                aria-pressed={skin.variant === v.id}
                onClick={() => updateLibrary(api.skins.update(skin.id, { variant: v.id }))}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Dropdown
            label={<MoreHorizontal size={16} />}
            className="icon-btn"
            chevron={false}
            ariaLabel={`${skin.name} options`}
            items={[
              {
                icon: <FolderInput size={16} />,
                label: skin.group ? 'Change group' : 'Add to a group',
                onSelect: () => setGrouping(skin),
              },
              {
                icon: <Trash2 size={16} />,
                label: 'Delete',
                danger: true,
                onSelect: () => updateLibrary(api.skins.remove(skin.id)),
              },
            ]}
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className="mods-drop"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (hasFiles(e) && --dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="mods-drop-overlay" aria-live="polite">
          <Upload size={26} />
          <strong>Drop skins to add them to your library</strong>
        </div>
      )}

      <PageHeader title="Skins" subtitle={`Playing as ${active!.name}`} actions={addButton} />

      <div className="skins-layout">
        <section className="skin-current">
          <div className="skin-stage">
            {!state ? (
              <LoaderCircle size={24} className="spin" />
            ) : state.skin ? (
              <Suspense fallback={<LoaderCircle size={24} className="spin" />}>
                <Skin3D url={state.skin.url} variant={state.skin.variant} capeUrl={activeCape?.url} label={`${state.account.name}’s skin`} />
              </Suspense>
            ) : (
              <div className="skin-default">
                <Shirt size={36} strokeWidth={1.5} />
                <span>Default skin</span>
              </div>
            )}
          </div>
          <div className="skin-current-actions">
            <button className="btn btn-secondary btn-sm" onClick={saveCurrent} disabled={!state?.skin || busy !== null}>
              {busy === 'save' ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Save to library
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => run('reset', api.skins.reset, 'Back to the default skin.')}
              disabled={!state?.skin || busy !== null}
            >
              {busy === 'reset' ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />} Reset
            </button>
          </div>

          {state && state.capes.length > 0 && (
            <>
              <h2 className="section-label">Cape</h2>
              <div className="capes">
                <button
                  className="cape-option"
                  aria-pressed={!activeCape}
                  disabled={busy !== null}
                  onClick={() => run('no-cape', () => api.skins.setCape(null), 'Cape hidden.')}
                >
                  <span className="cape-none">
                    <Ban size={20} />
                  </span>
                  <span>None</span>
                </button>
                {state.capes.map((cape) => (
                  <button
                    key={cape.id}
                    className="cape-option"
                    aria-pressed={cape.active}
                    disabled={busy !== null}
                    onClick={() => run(cape.id, () => api.skins.setCape(cape.id), `Wearing the ${cape.alias} cape.`)}
                  >
                    {busy === cape.id ? <LoaderCircle size={20} className="spin" /> : <CapeView url={cape.url} label={cape.alias} />}
                    <span>{cape.alias}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="skin-library">
          <h2 className="section-label section-label-first">Library</h2>
          {library && library.length === 0 ? (
            <div className="empty empty-compact">
              <Shirt className="empty-icon" size={40} strokeWidth={1.5} />
              <h2>No saved skins</h2>
              <p>Add skin PNGs (or drop them here) to switch between them in one click.</p>
              {addButton}
            </div>
          ) : (
            sections.map(({ name, items }) => {
              if (groupNames.length === 0) {
                return (
                  <div key="all" className="skin-grid">
                    {items.map(card)}
                  </div>
                );
              }
              const key = name ?? '';
              const open = !collapsed.has(key);
              return (
                <section key={key} className="profile-group">
                  <div className="profile-group-head">
                    <button className="profile-group-toggle" aria-expanded={open} onClick={() => toggleCollapsed(key)}>
                      <ChevronDown size={16} className="profile-group-chevron" />
                      <span className="profile-group-name">{name ?? 'Other skins'}</span>
                      <span className="chip-count">{items.length}</span>
                    </button>
                    {name && (
                      <Dropdown
                        label={<MoreHorizontal size={16} />}
                        className="icon-btn"
                        chevron={false}
                        ariaLabel={`${name} options`}
                        items={[
                          { icon: <Pencil size={16} />, label: 'Rename group', onSelect: () => setRenaming(name) },
                          {
                            icon: <FolderMinus size={16} />,
                            label: 'Ungroup',
                            hint: 'Skins stay, the group goes',
                            onSelect: () => updateLibrary(api.skins.renameGroup(name, null)),
                          },
                        ]}
                      />
                    )}
                  </div>
                  {open && <div className="skin-grid">{items.map(card)}</div>}
                </section>
              );
            })
          )}
        </section>
      </div>

      {grouping && (
        <GroupModal
          title={grouping.group ? 'Change group' : 'Add to a group'}
          initial={grouping.group}
          groups={groupNames}
          submitLabel="Move"
          removeLabel="Remove from group"
          placeholder="Group name, like “PvP” or “Halloween”"
          onSubmit={async (group) => {
            await updateLibrary(api.skins.update(grouping.id, { group }));
          }}
          onClose={() => setGrouping(null)}
        />
      )}
      {renaming && (
        <GroupModal
          title="Rename group"
          initial={renaming}
          groups={[]}
          submitLabel="Rename"
          onSubmit={async (name) => {
            await updateLibrary(api.skins.renameGroup(renaming, name));
          }}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
