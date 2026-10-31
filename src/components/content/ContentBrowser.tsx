import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownWideNarrow, Check, ChevronDown, Download, LoaderCircle, Search } from 'lucide-react';
import ContentIcon from './ContentIcon';
import VersionModal from './VersionModal';
import ProjectDetails from './ProjectDetails';
import InstallClashModal from './InstallClashModal';
import { api, errorMessage } from '../../api';
import { CONTENT, categoryLabel } from '../../content';
import { formatCount } from '../../format';
import { timeAgo } from '../../time';
import type {
  ContentCategory,
  ContentKind,
  ContentSearchHit,
  ContentSort,
  InstallClash,
  InstalledContent,
  Profile,
} from '../../types';

const SORTS: { id: ContentSort; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'follows', label: 'Followers' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently updated' },
];

const HEADER_LABELS: Record<string, string> = {
  categories: 'Categories',
  features: 'Features',
  resolutions: 'Resolution',
  'performance impact': 'Performance impact',
};

export type BrowseKind = ContentKind | 'all';

interface Props {
  profile: Profile;
  kind: BrowseKind;
  /** Type chips to show; omit to hide them. */
  kindOptions?: BrowseKind[];
  onKindChange?: (kind: BrowseKind) => void;
  /** Data packs only. */
  world?: string;
  /** Modrinth project ids already installed (any kind). */
  installedIds: Set<string>;
  onInstalled: (kind: ContentKind, items: InstalledContent[]) => void;
  onError: (message: string) => void;
}

/** Modrinth search filtered to what works on the profile, with type, category and sort filters. */
export default function ContentBrowser({ profile, kind, kindOptions, onKindChange, world, installedIds, onInstalled, onError }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ContentSort | null>(null);
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [hits, setHits] = useState<ContentSearchHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState<ContentSearchHit | null>(null);
  const [viewing, setViewing] = useState<ContentSearchHit | null>(null);
  // Mods that would clash with what's installed, by Modrinth slug.
  const [clashes, setClashes] = useState<Map<string, InstallClash>>(new Map());
  const [guard, setGuard] = useState<{ hit: ContentSearchHit; clash: InstallClash; run: () => void } | null>(null);
  const requestId = useRef(0);
  // Until a sort is picked: best matches while searching, most downloaded otherwise.
  const effectiveSort: ContentSort = sort ?? (query.trim() ? 'relevance' : 'downloads');

  useEffect(() => {
    setCategory('');
    setCategories([]);
    if (kind === 'all') return;
    api.content
      .categories(kind)
      .then(setCategories)
      .catch(() => {});
  }, [kind]);

  const refreshClashes = useCallback(() => {
    if (profile.loader === 'vanilla') return setClashes(new Map());
    api.diagnose
      .installClashes(profile.id)
      .then((list) => setClashes(new Map(list.map((c) => [c.slug, c]))))
      .catch(() => {});
  }, [profile.id, profile.loader]);

  useEffect(refreshClashes, [refreshClashes]);

  const installed = (kind: ContentKind, items: InstalledContent[]) => {
    onInstalled(kind, items);
    if (kind === 'mod') refreshClashes();
  };

  const clashFor = (hit: ContentSearchHit) => (hit.kind === 'mod' ? clashes.get(hit.slug) : undefined);

  /** Runs an install straight away, or asks first when the mod clashes with one already installed. */
  const guarded = (hit: ContentSearchHit, run: () => void) => {
    const clash = clashFor(hit);
    if (clash) setGuard({ hit, clash, run });
    else run();
  };

  const fetchPage = (offset: number) => {
    const options = { query: query.trim(), offset, sort: effectiveSort, category: category || undefined };
    return kind === 'all'
      ? api.content.searchAll(profile.id, options)
      : api.content.search({ profileId: profile.id, kind, world }, options);
  };

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
  }, [profile.id, profile.loader, profile.mcVersion, kind, world, query, effectiveSort, category, onError]);

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

  const install = async (hit: ContentSearchHit) => {
    setInstalling((s) => new Set(s).add(hit.projectId));
    try {
      installed(hit.kind, await api.content.install({ profileId: profile.id, kind: hit.kind, world }, hit.projectId));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setInstalling((s) => {
        const next = new Set(s);
        next.delete(hit.projectId);
        return next;
      });
    }
  };

  const installAction = (hit: ContentSearchHit) => {
    if (installedIds.has(hit.projectId)) {
      return (
        <span className="mod-installed">
          <Check size={15} /> Installed
        </span>
      );
    }
    const busy = installing.has(hit.projectId);
    return (
      <div className="split-btn">
        <button className="btn btn-primary btn-play" onClick={() => guarded(hit, () => install(hit))} disabled={busy}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
          {busy ? 'Installing' : 'Install'}
        </button>
        <button
          className="btn btn-primary split-btn-more"
          onClick={() => guarded(hit, () => setChoosing(hit))}
          disabled={busy}
          aria-label={`Choose a version of ${hit.title}`}
          title="Choose a version"
        >
          <ChevronDown size={15} />
        </button>
      </div>
    );
  };

  const noun = kind === 'all' ? 'content' : CONTENT[kind].nounPlural;
  const groups = [...new Set(categories.map((c) => c.header))];

  return (
    <div className="mod-browser">
      <label className="search-field">
        <Search size={16} />
        <input
          className="input"
          value={query}
          placeholder={`Search Modrinth for ${profile.mcVersion} ${noun}…`}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
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
        {kindOptions && kindOptions.length > 1 && (
          <div className="chips" role="group" aria-label="Type">
            {kindOptions.map((k) => (
              <button key={k} className="chip" aria-pressed={kind === k} onClick={() => onKindChange?.(k)}>
                {k === 'all' ? 'All' : CONTENT[k].title}
              </button>
            ))}
          </div>
        )}
        {categories.length > 0 && (
          <label className="select-pill">
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">Any category</option>
              {groups.map((header) => (
                <optgroup key={header} label={HEADER_LABELS[header] ?? categoryLabel(header)}>
                  {categories
                    .filter((c) => c.header === header)
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {categoryLabel(c.name)}
                      </option>
                    ))}
                </optgroup>
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
        <p className="mod-empty">
          No {noun} found for {profile.mcVersion}
          {category ? ` in ${categoryLabel(category)}` : ''}.
        </p>
      ) : (
        <>
          <div className="mod-list">
            {hits.map((hit) => {
              const clash = installedIds.has(hit.projectId) ? undefined : clashFor(hit);
              return (
              <div key={hit.projectId} className="mod-row">
                {/* The icon and text open the project's details. */}
                <button className="mod-open" onClick={() => setViewing(hit)} title={`More about ${hit.title}`}>
                  <ContentIcon url={hit.iconUrl} />
                  <div className="mod-info">
                    <div className="mod-title">
                      <span className="mod-title-text">{hit.title}</span> <span className="mod-author">by {hit.author}</span>
                    </div>
                    <p className="mod-description">{hit.description}</p>
                    <span className="mod-meta">
                      {kind === 'all' && <span className="kind-tag">{CONTENT[hit.kind].noun}</span>}
                      <Download size={12} /> {formatCount(hit.downloads)}
                      <span className="dot">·</span>
                      Updated {timeAgo(hit.updatedAt)}
                      {clash && (
                        <span className="kind-tag clash-tag" title={clash.message.replace('{title}', hit.title)}>
                          <AlertTriangle size={11} /> Clashes with {clash.with}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
                {installAction(hit)}
              </div>
              );
            })}
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
          actions={installAction(viewing)}
          target={{ profileId: profile.id, kind: viewing.kind, world }}
          onInstalled={(items) => installed(viewing.kind, items)}
          onClose={() => setViewing(null)}
        />
      )}

      {choosing && (
        <VersionModal
          title={choosing.title}
          iconUrl={choosing.iconUrl}
          target={{ profileId: profile.id, kind: choosing.kind, world }}
          projectId={choosing.projectId}
          onInstalled={(items) => installed(choosing.kind, items)}
          onClose={() => setChoosing(null)}
        />
      )}

      {guard && (
        <InstallClashModal
          title={guard.hit.title}
          clash={guard.clash}
          onInstallAnyway={() => {
            setGuard(null);
            guard.run();
          }}
          onReplace={async () => {
            try {
              const items = await api.content.setEnabled({ profileId: profile.id, kind: 'mod' }, guard.clash.file, false);
              onInstalled('mod', items);
              guard.run();
            } catch (err) {
              onError(errorMessage(err));
            }
          }}
          onClose={() => setGuard(null)}
        />
      )}
    </div>
  );
}
