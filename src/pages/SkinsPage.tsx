import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Ban, Check, LoaderCircle, LogIn, RotateCcw, Save, Shirt, Trash2, Upload } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SkinView, { CapeView } from '../components/SkinView';
import { api, errorMessage } from '../api';
import type { AccountsState, LibrarySkin, SkinState, SkinVariant } from '../types';

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
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const saveCurrent = async () => {
    setBusy('save');
    await updateLibrary(api.skins.saveCurrent());
    setBusy(null);
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

  const addButton = (
    <button className="btn btn-primary" onClick={() => updateLibrary(api.skins.pick())}>
      <Upload size={16} /> Add skin
    </button>
  );

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
              <SkinView url={state.skin.url} variant={state.skin.variant} scale={9} label={`${state.account.name}’s skin`} />
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
                  aria-pressed={!state.capes.some((c) => c.active)}
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
            <div className="skin-grid">
              {library?.map((skin) => (
                <div key={skin.id} className="skin-card">
                  <div className="skin-card-preview">
                    <SkinView url={`workbench://skin/${skin.id}`} variant={skin.variant} scale={5} label={skin.name} />
                  </div>
                  <div className="skin-card-name" title={skin.name}>
                    {skin.name}
                  </div>
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
                  <div className="skin-card-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy !== null}
                      onClick={() => run(skin.id, () => api.skins.wear(skin.id), `Now wearing ${skin.name}.`)}
                    >
                      {busy === skin.id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Wear
                    </button>
                    <button
                      className="icon-btn icon-btn-danger"
                      aria-label={`Delete ${skin.name}`}
                      title="Delete"
                      onClick={() => updateLibrary(api.skins.remove(skin.id))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
