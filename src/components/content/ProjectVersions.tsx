import { useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, Check, ChevronDown, Download, LoaderCircle } from 'lucide-react';
import Markdown from '../Markdown';
import { api, errorMessage } from '../../api';
import { categoryLabel } from '../../content';
import { timeAgo } from '../../time';
import { formatCount } from '../../format';
import { VERSION_SORTS, compareGameVersions, sortVersions, useVersionSort, versionRange, type VersionSort } from './versionSort';
import type { ContentTarget, InstalledContent, ProjectVersion } from '../../types';

const PAGE = 30;

interface Props {
  projectId: string;
  target?: ContentTarget;
  installedVersionId?: string | null;
  onInstalled?: (items: InstalledContent[]) => void;
}

/** The Versions tab of a project page: every version, sortable, with changelogs and (for a profile) install buttons. */
export default function ProjectVersions({ projectId, target, installedVersionId, onInstalled }: Props) {
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useVersionSort();
  const [releasesOnly, setReleasesOnly] = useState(false);
  const [onlyFits, setOnlyFits] = useState(Boolean(target));
  const [gameVersion, setGameVersion] = useState('');
  const [loader, setLoader] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(installedVersionId ?? null);

  useEffect(() => {
    api.content
      .allVersions(projectId, target)
      .then(setVersions)
      .catch((err) => setError(errorMessage(err)));
    // Loaded once per opened project.
  }, [projectId]);

  useEffect(() => setShown(PAGE), [sort, releasesOnly, onlyFits, gameVersion, loader]);

  // What the project has been released for, to filter by. Snapshots only show up when there are no releases to list.
  const { gameVersions, loaders } = useMemo(() => {
    const all = [...new Set((versions ?? []).flatMap((v) => v.gameVersions))];
    const releases = all.filter((g) => /^\d+(\.\d+)+$/.test(g));
    return {
      gameVersions: (releases.length ? releases : all).sort((a, b) => compareGameVersions(b, a)),
      loaders: [...new Set((versions ?? []).flatMap((v) => v.loaders))].sort(),
    };
  }, [versions]);

  if (error) return <p className="mod-empty">Couldn’t load the versions. {error}</p>;
  if (!versions) {
    return (
      <div className="mod-loading">
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  }

  const list = sortVersions(
    versions.filter(
      (v) =>
        (!releasesOnly || v.type === 'release') &&
        (!onlyFits || v.fits) &&
        (!gameVersion || v.gameVersions.includes(gameVersion)) &&
        (!loader || v.loaders.includes(loader)),
    ),
    sort,
  );
  const canInstall = Boolean(target && onInstalled);

  const install = async (versionId: string) => {
    if (!target || !onInstalled) return;
    setInstalling(versionId);
    setInstallError(null);
    try {
      onInstalled(await api.content.install(target, projectId, versionId));
      setInstalled(versionId);
    } catch (err) {
      setInstallError(errorMessage(err));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="project-versions">
      <div className="project-versions-bar">
        <span className="project-versions-count">
          {list.length} {list.length === 1 ? 'version' : 'versions'}
        </span>
        {target && (
          <div className="segmented" role="group" aria-label="Which versions">
            <button aria-pressed={onlyFits} onClick={() => setOnlyFits(true)}>
              For this profile
            </button>
            <button aria-pressed={!onlyFits} onClick={() => setOnlyFits(false)}>
              All
            </button>
          </div>
        )}
        {gameVersions.length > 1 && (
          <label className="select-pill">
            <select value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} aria-label="Game version">
              <option value="">Any game version</option>
              {gameVersions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
        {loaders.length > 1 && (
          <label className="select-pill">
            <select value={loader} onChange={(e) => setLoader(e.target.value)} aria-label="Loader">
              <option value="">Any loader</option>
              {loaders.map((l) => (
                <option key={l} value={l}>
                  {categoryLabel(l)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="select-pill">
          <select value={releasesOnly ? 'release' : 'all'} onChange={(e) => setReleasesOnly(e.target.value === 'release')} aria-label="Channel">
            <option value="all">All channels</option>
            <option value="release">Releases only</option>
          </select>
        </label>
        <label className="select-pill">
          <ArrowDownWideNarrow size={15} />
          <select value={sort} onChange={(e) => setSort(e.target.value as VersionSort)} aria-label="Sort versions">
            {VERSION_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {installError && <p className="form-error">{installError}</p>}

      {list.length === 0 ? (
        <p className="mod-empty">
          {onlyFits ? 'No versions work on this profile. Choose All to see the rest.' : 'No versions match.'}
        </p>
      ) : (
        <ul className="project-version-list">
          {list.slice(0, shown).map((v) => {
            const open = expanded === v.id;
            return (
              <li key={v.id} className="project-version">
                <div className="project-version-row">
                  <button className="project-version-main" aria-expanded={open} onClick={() => setExpanded(open ? null : v.id)}>
                    <ChevronDown size={15} className="project-version-chevron" />
                    <span className="project-version-title">
                      <span className="version-number">{v.versionNumber}</span>
                      {v.type !== 'release' && <span className={`kind-tag version-${v.type}`}>{v.type}</span>}
                      {target && v.fits === false && <span className="kind-tag" title="Doesn’t work on this profile’s loader or Minecraft version">Incompatible</span>}
                    </span>
                    <span className="project-version-meta">
                      {[versionRange(v.gameVersions), v.loaders.map(categoryLabel).join(', '), timeAgo(v.date), `${formatCount(v.downloads)} downloads`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                  {canInstall &&
                    v.fits &&
                    (v.id === installed ? (
                      <span className="mod-installed">
                        <Check size={15} /> Installed
                      </span>
                    ) : (
                      <button className="btn btn-secondary btn-compact" onClick={() => install(v.id)} disabled={installing !== null}>
                        {installing === v.id ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
                        {installed ? 'Switch' : 'Install'}
                      </button>
                    ))}
                </div>
                {open && (
                  <div className="project-version-changelog">
                    {v.changelog.trim() ? <Markdown text={v.changelog} /> : <p className="changelog-none">No changelog for this version.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown && (
        <button className="btn btn-secondary mod-more" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      )}
    </div>
  );
}
