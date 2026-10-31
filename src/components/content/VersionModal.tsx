import { useEffect, useState } from 'react';
import { ArrowDownWideNarrow, Download, LoaderCircle } from 'lucide-react';
import Modal from '../Modal';
import Markdown from '../Markdown';
import ContentIcon from './ContentIcon';
import { api, errorMessage } from '../../api';
import { timeAgo } from '../../time';
import type { ContentTarget, ContentVersion, InstalledContent } from '../../types';
import { formatCount } from '../../format';
import { VERSION_SORTS, sortVersions, useVersionSort, type VersionSort } from './versionSort';

interface Props {
  title: string;
  iconUrl: string | null;
  target: ContentTarget;
  projectId: string;
  /** The installed version, when switching. */
  currentVersionId?: string | null;
  onInstalled: (items: InstalledContent[]) => void;
  onClose: () => void;
}

/** Lists a project's versions that work on the profile; installs (or switches to) the chosen one. */
export default function VersionModal({ title, iconUrl, target, projectId, currentVersionId, onInstalled, onClose }: Props) {
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useVersionSort();
  const sorted = versions && sortVersions(versions, sort);

  useEffect(() => {
    api.content
      .versions(target, projectId)
      .then((list) => {
        setVersions(list);
        setSelected((list.find((v) => v.id === currentVersionId) ?? list.find((v) => v.type === 'release') ?? list[0])?.id ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
    // Loaded once per opened project.
  }, []);

  const chosen = versions?.find((v) => v.id === selected) ?? null;
  const isCurrent = Boolean(chosen && chosen.id === currentVersionId);

  const install = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      onInstalled(await api.content.install(target, projectId, chosen.id));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={currentVersionId ? 'Change version' : 'Choose a version'}
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={install} disabled={!chosen || isCurrent || busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
            {busy ? 'Installing…' : isCurrent ? 'Installed' : chosen ? `Install ${chosen.versionNumber}` : 'Install'}
          </button>
        </>
      }
    >
      <div className="modpack-head">
        <ContentIcon url={iconUrl} size={44} />
        <div>
          <strong>{title}</strong>
          <p>{versions ? `${versions.length} ${versions.length === 1 ? 'version works' : 'versions work'} on this profile` : 'Loading versions…'}</p>
        </div>
        {versions && versions.length > 1 && (
          <label className="select-pill modpack-head-end">
            <ArrowDownWideNarrow size={15} />
            <select value={sort} onChange={(e) => setSort(e.target.value as VersionSort)} aria-label="Sort versions">
              {VERSION_SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!versions ? (
        !error && (
          <div className="mod-loading">
            <LoaderCircle size={22} className="spin" />
          </div>
        )
      ) : versions.length === 0 ? (
        <p className="mod-empty">No versions of {title} work on this profile.</p>
      ) : (
        <div className="version-picker">
          <div className="version-list" role="radiogroup" aria-label="Versions">
            {sorted!.map((v) => (
              <button
                key={v.id}
                role="radio"
                aria-checked={v.id === selected}
                className="version-option"
                onClick={() => setSelected(v.id)}
              >
                <span className="version-number">{v.versionNumber}</span>
                {v.type !== 'release' && <span className={`kind-tag version-${v.type}`}>{v.type}</span>}
                {v.id === currentVersionId && <span className="kind-tag version-current">Installed</span>}
                <span className="version-when">
                  {timeAgo(v.date)} · {formatCount(v.downloads)}
                </span>
              </button>
            ))}
          </div>
          {chosen && (
            <div className="version-changelog">
              <div className="version-changelog-head">
                <strong>{chosen.name || chosen.versionNumber}</strong>
                <span>Minecraft {chosen.gameVersions.join(', ')}</span>
              </div>
              {chosen.changelog.trim() ? <Markdown text={chosen.changelog} /> : <p className="changelog-none">No changelog for this version.</p>}
            </div>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
