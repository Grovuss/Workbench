import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Download, LoaderCircle, Search } from 'lucide-react';
import ContentIcon from './ContentIcon';
import ProjectDetails from './ProjectDetails';
import Modal from '../Modal';
import LoaderBadge from '../LoaderBadge';
import JobProgress, { useJobProgress } from '../JobProgress';
import { api, errorMessage } from '../../api';
import { LOADER_LABELS } from '../../loaders';
import { timeAgo } from '../../time';
import type { ContentCategory, ContentSort, ModLoader, ModpackHit, ModpackVersion, Profile } from '../../types';
import { formatCount } from '../../format';

const SORTS: { id: ContentSort; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'follows', label: 'Followers' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently updated' },
];

const LOADERS: ModLoader[] = ['fabric', 'quilt', 'forge', 'neoforge'];

const categoryLabel = (name: string) => name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

interface Props {
  onInstalled: (profile: Profile) => void;
  onError: (message: string) => void;
}

/** Modrinth modpacks; installing one makes a new profile. */
export default function ModpackBrowser({ onInstalled, onError }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ContentSort | null>(null);
  const [loader, setLoader] = useState<ModLoader | ''>('');
  const [gameVersion, setGameVersion] = useState('');
  const [category, setCategory] = useState('');
  const [releases, setReleases] = useState<string[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [hits, setHits] = useState<ModpackHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [installing, setInstalling] = useState<ModpackHit | null>(null);
  const [viewing, setViewing] = useState<ModpackHit | null>(null);
  const requestId = useRef(0);
  const effectiveSort: ContentSort = sort ?? (query.trim() ? 'relevance' : 'downloads');

  useEffect(() => {
    api.versions
      .list()
      .then((versions) => setReleases(versions.filter((v) => v.type === 'release').map((v) => v.id)))
      .catch(() => {});
    api.content
      .categories('modpack')
      .then((c) => setCategories(c.filter((x) => x.header === 'categories')))
      .catch(() => {});
  }, []);

  const fetchPage = (offset: number) =>
    api.modpacks.search({
      query: query.trim(),
      offset,
      sort: effectiveSort,
      category: category || undefined,
      loader: loader || undefined,
      gameVersion: gameVersion || undefined,
    });

  // Debounced search; newer requests win over slower older ones.
  useEffect(() => {
    const id = ++requestId.current;
    setHits(null);
    const timer = window.setTimeout(() => {
      fetchPage(0)
        .then((res) => {
          if (id !== requestId.current) return;
          setHits(res.hits);
          setTotal(res.total);
        })
        .catch((err) => id === requestId.current && onError(errorMessage(err)));
    }, query ? 300 : 0);
    return () => window.clearTimeout(timer);
    // fetchPage reads exactly these values.
  }, [query, effectiveSort, category, loader, gameVersion, onError]);

  const loadMore = async () => {
    if (!hits) return;
    setLoadingMore(true);
    const id = requestId.current;
    try {
      const res = await fetchPage(hits.length);
      if (id === requestId.current) setHits([...hits, ...res.hits]);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mod-browser">
      <label className="search-field">
        <Search size={16} />
        <input className="input" value={query} placeholder="Search Modrinth modpacks…" onChange={(e) => setQuery(e.target.value)} autoFocus />
      </label>

      <div className="filter-row">
        <label className="select-pill">
          <ArrowDownWideNarrow size={15} />
          <select value={effectiveSort} onChange={(e) => setSort(e.target.value as ContentSort)} aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="chips" role="group" aria-label="Loader">
          <button className="chip" aria-pressed={loader === ''} onClick={() => setLoader('')}>
            Any loader
          </button>
          {LOADERS.map((l) => (
            <button key={l} className="chip" aria-pressed={loader === l} onClick={() => setLoader(l)}>
              {LOADER_LABELS[l]}
            </button>
          ))}
        </div>
        <label className="select-pill">
          <select value={gameVersion} onChange={(e) => setGameVersion(e.target.value)} aria-label="Minecraft version">
            <option value="">Any version</option>
            {releases.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {categories.length > 0 && (
          <label className="select-pill">
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {categoryLabel(c.name)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {hits === null ? (
        <div className="mod-loading">
          <LoaderCircle size={22} className="spin" />
        </div>
      ) : hits.length === 0 ? (
        <p className="mod-empty">No modpacks found.</p>
      ) : (
        <>
          <div className="mod-list">
            {hits.map((hit) => (
              <div key={hit.projectId} className="mod-row">
                {/* The icon and text open the pack's details. */}
                <button className="mod-open" onClick={() => setViewing(hit)} title={`More about ${hit.title}`}>
                  <ContentIcon url={hit.iconUrl} size={48} />
                  <div className="mod-info">
                    <div className="mod-title">
                      <span className="mod-title-text">{hit.title}</span> <span className="mod-author">by {hit.author}</span>
                    </div>
                    <p className="mod-description">{hit.description}</p>
                    <span className="mod-meta">
                      {hit.loaders.map((l) => (
                        <LoaderBadge key={l} loader={l} />
                      ))}
                      <Download size={12} /> {formatCount(hit.downloads)}
                      <span className="dot">·</span>
                      Updated {timeAgo(hit.updatedAt)}
                    </span>
                  </div>
                </button>
                <button className="btn btn-primary btn-play" onClick={() => setInstalling(hit)}>
                  <Download size={15} /> Install
                </button>
              </div>
            ))}
          </div>
          {hits.length < total && (
            <button className="btn btn-secondary mod-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      {viewing && (
        <ProjectDetails
          project={viewing}
          actions={
            <button
              className="btn btn-primary btn-play"
              onClick={() => {
                setInstalling(viewing);
                setViewing(null);
              }}
            >
              <Download size={15} /> Install
            </button>
          }
          onClose={() => setViewing(null)}
        />
      )}

      {installing && (
        <ModpackInstallModal
          pack={installing}
          preferLoader={loader || null}
          preferVersion={gameVersion || null}
          onClose={() => setInstalling(null)}
          onInstalled={onInstalled}
        />
      )}
    </div>
  );
}

const versionLabel = (v: ModpackVersion) => {
  const loaders = v.loaders.filter((l): l is ModLoader => (LOADERS as string[]).includes(l)).map((l) => LOADER_LABELS[l]);
  return `${v.versionNumber} · Minecraft ${v.gameVersions.join(', ')}${loaders.length ? ` · ${loaders.join(', ')}` : ''}${v.type !== 'release' ? ` (${v.type})` : ''}`;
};

/** Pick a version of a modpack and install it as a new profile. */
function ModpackInstallModal({
  pack,
  preferLoader,
  preferVersion,
  onClose,
  onInstalled,
}: {
  pack: ModpackHit;
  preferLoader: ModLoader | null;
  preferVersion: string | null;
  onClose: () => void;
  onInstalled: (profile: Profile) => void;
}) {
  const [versions, setVersions] = useState<ModpackVersion[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, resetProgress] = useJobProgress();
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    api.modpacks
      .versions(pack.projectId)
      .then((list) => {
        setVersions(list);
        // Newest release that matches the search filters, if any.
        const fits = (v: ModpackVersion) =>
          (!preferLoader || v.loaders.includes(preferLoader)) && (!preferVersion || v.gameVersions.includes(preferVersion));
        const pick = list.find((v) => fits(v) && v.type === 'release') ?? list.find(fits) ?? list.find((v) => v.type === 'release') ?? list[0];
        setVersionId(pick?.id ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, [pack.projectId, preferLoader, preferVersion]);

  const install = async () => {
    setBusy(true);
    setError(null);
    resetProgress();
    try {
      const { profile } = await api.modpacks.install(pack.projectId, versionId);
      onInstalled(profile);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Install ${pack.title}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={install} disabled={busy || !versionId}>
            {busy ? 'Installing…' : 'Install'}
          </button>
        </>
      }
    >
      <div className="modpack-head">
        <ContentIcon url={pack.iconUrl} size={56} />
        <div>
          <strong>{pack.title}</strong>
          <p>{pack.description}</p>
        </div>
      </div>
      {busy ? (
        <JobProgress progress={progress} label={`Installing ${pack.title}`} />
      ) : (
        <div className="form">
          <label className="field">
            <span className="field-label">Version</span>
            {versions ? (
              <select className="input" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {versionLabel(v)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mod-loading">
                <LoaderCircle size={20} className="spin" />
              </div>
            )}
          </label>
          <p className="modal-text">Installs as a new profile. Big packs can take a few minutes to download.</p>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
