import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { LOADER_LABELS, LOADER_OPTIONS } from '../loaders';
import type { Loader, LoaderVersion, McVersion, VersionSelection } from '../types';

interface Props {
  initial: VersionSelection;
  onChange: (selection: VersionSelection) => void;
}

/** Loader + Minecraft version + loader version, with each list filtered by the choice before it. */
export default function VersionPicker({ initial, onChange }: Props) {
  const [sel, setSel] = useState<VersionSelection>(initial);
  const [mcVersions, setMcVersions] = useState<McVersion[] | null>(null);
  const [supported, setSupported] = useState<Set<string> | null>(null);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => onChangeRef.current(sel), [sel]);

  useEffect(() => {
    api.versions
      .list()
      .then((vs) => {
        setMcVersions(vs);
        if (vs.find((v) => v.id === initial.mcVersion)?.type === 'snapshot') setShowSnapshots(true);
      })
      .catch((err) => setError(errorMessage(err)));
    // Runs once: `initial` only seeds the picker.
  }, []);

  // Which Minecraft versions the chosen loader supports.
  useEffect(() => {
    if (sel.loader === 'vanilla') {
      setSupported(null);
      return;
    }
    let cancelled = false;
    setSupported(new Set());
    api.loaders
      .games(sel.loader)
      .then((ids) => !cancelled && setSupported(new Set(ids)))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [sel.loader]);

  const visible = useMemo(
    () =>
      (mcVersions ?? []).filter(
        (v) => (showSnapshots || v.type === 'release') && (!supported || supported.has(v.id)),
      ),
    [mcVersions, showSnapshots, supported],
  );

  // Keep the Minecraft version valid as filters change.
  useEffect(() => {
    if (!mcVersions || (supported && supported.size === 0)) return;
    if (!visible.some((v) => v.id === sel.mcVersion)) {
      setSel((s) => ({ ...s, mcVersion: visible[0]?.id ?? '' }));
    }
  }, [visible, mcVersions, supported, sel.mcVersion]);

  // Loader versions for the chosen game version; default to the newest stable.
  useEffect(() => {
    if (sel.loader === 'vanilla' || !sel.mcVersion) {
      setLoaderVersions(null);
      return;
    }
    let cancelled = false;
    setLoaderVersions(null);
    api.loaders
      .versions(sel.loader, sel.mcVersion)
      .then((list) => {
        if (cancelled) return;
        setLoaderVersions(list);
        setSel((s) =>
          list.some((v) => v.version === s.loaderVersion)
            ? s
            : { ...s, loaderVersion: (list.find((v) => v.stable) ?? list[0])?.version ?? null },
        );
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [sel.loader, sel.mcVersion]);

  const setLoader = (loader: Loader) =>
    setSel((s) => ({ ...s, loader, loaderVersion: loader === 'vanilla' ? null : s.loaderVersion }));

  const loadingGames = !mcVersions || (supported !== null && supported.size === 0);

  return (
    <div className="form">
      <div className="field">
        <span className="field-label">Loader</span>
        <div className="segmented" role="group" aria-label="Loader">
          {LOADER_OPTIONS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={sel.loader === l.id}
              disabled={!l.available}
              title={l.available ? undefined : 'Coming soon'}
              onClick={() => l.available && setLoader(l.id as Loader)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">Minecraft version</span>
          <select
            className="input"
            value={sel.mcVersion}
            disabled={loadingGames}
            onChange={(e) => setSel((s) => ({ ...s, mcVersion: e.target.value }))}
          >
            {loadingGames && <option value={sel.mcVersion}>Loading…</option>}
            {!loadingGames &&
              visible.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                  {v.type === 'snapshot' ? ' (snapshot)' : ''}
                </option>
              ))}
          </select>
        </label>

        {sel.loader !== 'vanilla' && (
          <label className="field">
            <span className="field-label">{LOADER_LABELS[sel.loader]} version</span>
            <select
              className="input"
              value={sel.loaderVersion ?? ''}
              disabled={!loaderVersions?.length}
              onChange={(e) => setSel((s) => ({ ...s, loaderVersion: e.target.value }))}
            >
              {!loaderVersions && <option value={sel.loaderVersion ?? ''}>Loading…</option>}
              {loaderVersions?.length === 0 && <option value="">None available</option>}
              {loaderVersions?.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.stable ? '' : ' (beta)'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
        Show snapshots
      </label>

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

export const isCompleteSelection = (s: VersionSelection) =>
  Boolean(s.mcVersion) && (s.loader === 'vanilla' || Boolean(s.loaderVersion));
