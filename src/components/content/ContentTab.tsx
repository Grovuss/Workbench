import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpCircle,
  ChevronDown,
  ChevronsUpDown,
  Compass,
  FolderOpen,
  Gauge,
  Info,
  Layers,
  LoaderCircle,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import ContentBrowser, { type BrowseKind } from './ContentBrowser';
import ContentIcon from './ContentIcon';
import ProblemList, { applyFix } from './ProblemList';
import VersionModal from './VersionModal';
import PerformanceModal from './PerformanceModal';
import ModSetsModal from './ModSetsModal';
import Dropdown from '../Dropdown';
import Pagination, { PAGE_SIZES, type PageSize } from '../Pagination';
import Markdown from '../Markdown';
import Modal from '../Modal';
import Toggle from '../Toggle';
import { api, errorMessage } from '../../api';
import { CONTENT, IRIS_PROJECT_ID } from '../../content';
import { timeAgo } from '../../time';
import type { Changelog, ContentKind, InstalledContent, Problem, ProblemFix, Profile } from '../../types';

type Item = InstalledContent & { kind: ContentKind };
type InstalledSort = 'name' | 'name-desc' | 'added' | 'updates';
type CheckState = 'checking' | 'done' | 'failed';

const SORTS: { id: InstalledSort; label: string }[] = [
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'name-desc', label: 'Name (Z–A)' },
  { id: 'added', label: 'Recently added' },
  { id: 'updates', label: 'Updates first' },
];

const HINTS: Partial<Record<ContentKind, string>> = {
  resourcepack: 'Turn resource packs on in game under Options → Resource Packs.',
  shader: 'Pick a shader in game under Options → Video Settings → Shader Packs.',
  datapack: 'Data packs load when the world opens, so reopen the world after changing them.',
};

const SORT_KEY = 'workbench.contentSort';
const readSort = (): InstalledSort => {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return SORTS.some((s) => s.id === saved) ? (saved as InstalledSort) : 'name';
  } catch {
    return 'name';
  }
};

const PAGE_SIZE_KEY = 'workbench.contentPageSize';
const readPageSize = (): PageSize => {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(saved as PageSize) && localStorage.getItem(PAGE_SIZE_KEY) !== null ? (saved as PageSize) : 50;
  } catch {
    return 50;
  }
};

interface Props {
  profile: Profile;
  /** Kinds managed here: the profile's usable kinds, or ['datapack'] for a world. */
  kinds: ContentKind[];
  /** World folder, for data packs. */
  world?: string;
  running: boolean;
  /** Opens the profile's settings, for problems fixed there (memory, loader version). */
  onOpenSettings?: () => void;
  /** Switches the type filter, e.g. after clicking the profile's mod count. A new object applies it again. */
  filterRequest?: { kind: ContentKind | 'all' };
  /** After anything is installed, removed or turned on or off. */
  onChanged?: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

/** Everything installed in a profile (or a world's data packs) in one list, plus Modrinth browsing. */
export default function ContentTab({
  profile,
  kinds,
  world,
  running,
  onOpenSettings,
  filterRequest,
  onChanged,
  onError,
  onSuccess,
}: Props) {
  const [lists, setLists] = useState<Partial<Record<ContentKind, InstalledContent[]>>>({});
  const [checks, setChecks] = useState<Partial<Record<ContentKind, CheckState>>>({});
  const [view, setView] = useState<'installed' | 'browse'>('installed');
  const [browseKind, setBrowseKind] = useState<BrowseKind>(kinds.length > 1 ? 'all' : kinds[0]);
  const [typeFilter, setTypeFilter] = useState<ContentKind | 'all'>(filterRequest?.kind ?? 'all');
  useEffect(() => {
    if (filterRequest) setTypeFilter(filterRequest.kind);
  }, [filterRequest]);
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<InstalledSort>(readSort);
  const [pageSize, setPageSizeState] = useState<PageSize>(readPageSize);
  const [page, setPage] = useState(0);
  const listTop = useRef<HTMLDivElement>(null);
  // "<kind>/<fileName>" being updated, or 'all'.
  const [updating, setUpdating] = useState<Set<string> | 'all'>(new Set());
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemsOpen, setProblemsOpen] = useState<boolean | null>(null);
  const [changelogFor, setChangelogFor] = useState<Item | null>(null);
  const [versionFor, setVersionFor] = useState<Item | null>(null);
  const [tool, setTool] = useState<'performance' | 'sets' | null>(null);
  const dragDepth = useRef(0);
  const kindsKey = kinds.join(',');
  const singleKind = kinds.length === 1 ? kinds[0] : null;
  const target = useCallback((kind: ContentKind) => ({ profileId: profile.id, kind, world }), [profile.id, world]);

  const setSort = (next: InstalledSort) => {
    setSortState(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {}
  };

  const setPageSize = (next: PageSize) => {
    setPageSizeState(next);
    setPage(0);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(next));
    } catch {}
  };

  const goToPage = (next: number) => {
    setPage(next);
    listTop.current?.scrollIntoView({ block: 'nearest' });
  };

  const setList = useCallback((kind: ContentKind, items: InstalledContent[]) => setLists((l) => ({ ...l, [kind]: items })), []);
  useEffect(() => onChanged?.(), [lists, onChanged]);

  const checkUpdates = useCallback(
    (kind: ContentKind) => {
      setChecks((c) => ({ ...c, [kind]: 'checking' }));
      api.content
        .checkUpdates(target(kind))
        .then((items) => {
          setList(kind, items);
          setChecks((c) => ({ ...c, [kind]: 'done' }));
        })
        .catch(() => setChecks((c) => ({ ...c, [kind]: 'failed' })));
    },
    [target, setList],
  );

  // Show lists straight away, then check Modrinth for updates in the background.
  const refresh = useCallback(() => {
    for (const kind of kindsKey.split(',') as ContentKind[]) {
      api.content
        .list(target(kind))
        .then((items) => {
          setList(kind, items);
          checkUpdates(kind);
        })
        .catch((err) => onError(errorMessage(err)));
    }
  }, [kindsKey, target, setList, checkUpdates, onError]);

  useEffect(refresh, [refresh]);

  // Re-check mods for conflicts whenever the mod list changes.
  const modList = lists.mod;
  const managesMods = kindsKey.split(',').includes('mod');
  useEffect(() => {
    if (!modList || !managesMods) return;
    let current = true;
    api.diagnose
      .scan(profile.id)
      .then((found) => current && setProblems(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [modList, managesMods, profile.id]);

  const problemFiles = useMemo(() => new Set(problems.flatMap((p) => p.files)), [problems]);
  const fixProblem = (fix: ProblemFix) =>
    applyFix(profile.id, fix, { onModsChanged: (mods) => setList('mod', mods), onOpenSettings: () => onOpenSettings?.() });
  const showProblems = problemsOpen ?? problems.length <= 3;

  const loaded = kinds.every((k) => lists[k]);
  const all: Item[] = useMemo(() => kinds.flatMap((kind) => (lists[kind] ?? []).map((m) => ({ ...m, kind }))), [kinds, lists]);
  const installedIds = useMemo(() => new Set(all.map((m) => m.projectId).filter((id): id is string => Boolean(id))), [all]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter(
      (m) =>
        (typeFilter === 'all' || m.kind === typeFilter) &&
        (!q || m.title.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q)),
    );
    const byName = (a: Item, b: Item) => a.title.localeCompare(b.title);
    const compare: Record<InstalledSort, (a: Item, b: Item) => number> = {
      name: byName,
      'name-desc': (a, b) => byName(b, a),
      added: (a, b) => b.addedAt.localeCompare(a.addedAt),
      updates: (a, b) => Number(Boolean(b.updateVersion)) - Number(Boolean(a.updateVersion)) || byName(a, b),
    };
    return filtered.sort(compare[sort]);
  }, [all, typeFilter, query, sort]);

  // A new search, filter or sort starts from the first page.
  useEffect(() => setPage(0), [typeFilter, query, sort]);
  const pageCount = pageSize ? Math.max(1, Math.ceil(shown.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const paged = pageSize ? shown.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : shown;

  const withUpdates = all.filter((m) => m.updateVersion && (typeFilter === 'all' || m.kind === typeFilter));
  const checking = kinds.some((k) => checks[k] === 'checking');
  const checkFailed = kinds.some((k) => checks[k] === 'failed');
  const enabledCount = shown.filter((m) => m.enabled).length;

  const key = (m: Item) => `${m.kind}/${m.fileName}`;
  const isUpdating = (m: Item) => updating === 'all' || updating.has(key(m));

  const runUpdate = async (items: Item[], everything: boolean) => {
    const keys = items.map(key);
    setUpdating(everything ? 'all' : (s) => (s === 'all' ? s : new Set([...s, ...keys])));
    try {
      for (const kind of new Set(items.map((m) => m.kind))) {
        const files = items.filter((m) => m.kind === kind).map((m) => m.fileName);
        setList(kind, await api.content.update(target(kind), files));
      }
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setUpdating((s) => (s === 'all' || everything ? new Set() : new Set([...s].filter((k) => !keys.includes(k)))));
    }
  };

  const apply = (kind: ContentKind, pending: Promise<InstalledContent[]>) =>
    pending.then((items) => setList(kind, items)).catch((err) => onError(errorMessage(err)));

  const reportAdded = (counts: Partial<Record<ContentKind, number>> | null) => {
    if (!counts) return;
    const parts = (Object.entries(counts) as [ContentKind, number][]).map(
      ([kind, n]) => `${n} ${n === 1 ? CONTENT[kind].noun : CONTENT[kind].nounPlural}`,
    );
    onSuccess(`Added ${parts.join(' and ')}.`);
    setView('installed');
    refresh();
  };

  const addFiles = async (pending: () => Promise<Partial<Record<ContentKind, number>> | null>) => {
    setAdding(true);
    try {
      reportAdded(await pending());
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  // Browse starts on the type being looked at.
  const openBrowse = () => {
    setBrowseKind(typeFilter !== 'all' ? typeFilter : kinds.length > 1 ? 'all' : kinds[0]);
    setView('browse');
  };

  const upload = () => addFiles(() => api.content.pickFiles(profile.id, singleKind ? target(singleKind) : undefined));

  // dragenter/dragleave fire for every child element, so count depth rather than toggling.
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (hasFiles(e) && --dragDepth.current <= 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
    if (!paths.length) return;
    addFiles(async () => {
      if (!singleKind) return api.content.addAny(profile.id, paths);
      await api.content.addFiles(target(singleKind), paths);
      return { [singleKind]: paths.length };
    });
  };

  const openFolder = () => {
    const pending =
      typeFilter !== 'all' || singleKind
        ? api.content.openFolder(target(typeFilter === 'all' ? singleKind! : typeFilter))
        : api.profiles.openFolder(profile.id);
    pending.catch((err) => onError(errorMessage(err)));
  };

  const dropLabel = singleKind ? `${CONTENT[singleKind].ext} files` : 'mods, resource packs or shaders';
  const hasIris = lists.mod?.some((m) => m.projectId === IRIS_PROJECT_ID && m.enabled) ?? false;
  const shadersRelevant = kinds.includes('shader') && (typeFilter === 'shader' || (lists.shader?.length ?? 0) > 0 || (view === 'browse' && browseKind === 'shader'));
  const hint = HINTS[typeFilter === 'all' ? (singleKind ?? 'mod') : typeFilter];

  return (
    <div
      className="mods-drop"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {(dragging || adding) && (
        <div className="mods-drop-overlay" aria-live="polite">
          {adding ? <LoaderCircle size={26} className="spin" /> : <Upload size={26} />}
          <strong>{adding ? 'Adding files…' : `Drop ${dropLabel} to add them`}</strong>
          {!adding && !singleKind && <span>Workbench sorts each file into the right folder.</span>}
        </div>
      )}

      {shadersRelevant && loaded && (
        <ShaderNotice profile={profile} hasIris={hasIris} onInstalled={(items) => setList('mod', items)} onError={onError} onSuccess={onSuccess} />
      )}

      {view === 'installed' && problems.length > 0 && (
        <div className="problems">
          <button className="problems-head" aria-expanded={showProblems} onClick={() => setProblemsOpen(!showProblems)}>
            <AlertTriangle size={18} />
            <span className="problems-title">
              <strong>
                {problems.length === 1 ? '1 problem' : `${problems.length} problems`} with your mods
              </strong>
              <span>Minecraft will probably crash until {problems.length === 1 ? 'it’s' : 'they’re'} fixed.</span>
            </span>
            <ChevronDown size={16} className="problems-chevron" />
          </button>
          {showProblems && <ProblemList key={problems.map((p) => p.id).join()} problems={problems} onFix={fixProblem} onError={onError} />}
        </div>
      )}

      {view === 'browse' ? (
        <>
          <div className="content-bar">
            <button className="btn btn-ghost" onClick={() => setView('installed')}>
              <ArrowLeft size={16} /> Installed
            </button>
          </div>
          <ContentBrowser
            profile={profile}
            kind={browseKind}
            kindOptions={kinds.length > 1 ? ['all', ...kinds] : undefined}
            onKindChange={setBrowseKind}
            world={world}
            installedIds={installedIds}
            onInstalled={setList}
            onError={onError}
          />
        </>
      ) : (
        <>
          <div className="content-bar">
            <label className="search-field content-search">
              <Search size={16} />
              <input
                className="input"
                value={query}
                placeholder={loaded ? `Search ${all.length} ${all.length === 1 ? 'item' : 'items'}…` : 'Search…'}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {world ? (
              <button className="btn btn-secondary" onClick={upload} disabled={running || adding}>
                <Upload size={16} /> Upload files
              </button>
            ) : (
              <Dropdown
                label={
                  <>
                    <Plus size={16} /> Add
                  </>
                }
                items={[
                  ...(kinds.includes('mod')
                    ? [{ icon: <Gauge size={16} />, label: 'Performance mods', hint: 'More FPS, less memory', onSelect: () => setTool('performance') }]
                    : []),
                  { icon: <Layers size={16} />, label: 'Mod sets', hint: 'Your saved groups of mods', onSelect: () => setTool('sets') },
                  { icon: <Upload size={16} />, label: 'Upload files', hint: 'Jars and zips from your PC', onSelect: upload, disabled: running || adding },
                ]}
              />
            )}
            <button className="btn btn-primary" onClick={openBrowse}>
              <Compass size={16} /> Browse {singleKind ? CONTENT[singleKind].nounPlural : 'content'}
            </button>
          </div>

          <div className="filter-row">
            <label className="select-pill">
              <ArrowDownWideNarrow size={15} />
              <select value={sort} onChange={(e) => setSort(e.target.value as InstalledSort)} aria-label="Sort installed">
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {kinds.length > 1 && (
              <div className="chips" role="group" aria-label="Type">
                {(['all', ...kinds] as const).map((k) => {
                  const count = k === 'all' ? all.length : (lists[k]?.length ?? 0);
                  return (
                    <button key={k} className="chip" aria-pressed={typeFilter === k} onClick={() => setTypeFilter(k)}>
                      {k === 'all' ? 'All' : CONTENT[k].title}
                      {loaded && <span className="chip-count">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="filter-row-end">
              {checking ? (
                <span className="mods-update-status">
                  <LoaderCircle size={14} className="spin" /> Checking for updates
                </span>
              ) : withUpdates.length > 0 ? (
                <button
                  className="btn btn-ghost btn-update-all"
                  onClick={() => runUpdate(withUpdates, true)}
                  disabled={running || updating === 'all'}
                  title={running ? 'Close the game to update' : undefined}
                >
                  {updating === 'all' ? <LoaderCircle size={15} className="spin" /> : <ArrowUpCircle size={15} />}
                  {updating === 'all' ? 'Updating…' : `Update all (${withUpdates.length})`}
                </button>
              ) : (
                loaded && (
                  <span className="mods-update-status">{checkFailed ? 'Couldn’t check for updates' : 'Up to date'}</span>
                )
              )}
              <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={refresh}>
                <RefreshCw size={15} />
              </button>
              <button className="icon-btn" aria-label="Open folder" title="Open folder" onClick={openFolder}>
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          {loaded && all.length === 0 && (
            <div className="empty empty-compact">
              <Puzzle className="empty-icon" size={40} strokeWidth={1.5} />
              <h2>Nothing installed yet</h2>
              <p>Browse Modrinth, upload files, or drop {dropLabel} anywhere here.</p>
              <button className="btn btn-primary" onClick={openBrowse}>
                <Plus size={16} /> Browse {singleKind ? CONTENT[singleKind].nounPlural : 'content'}
              </button>
            </div>
          )}

          {loaded && all.length > 0 && shown.length === 0 && <p className="mod-empty">Nothing matches.</p>}

          {shown.length > 0 && (
            <>
              <div className="mod-list" ref={listTop}>
                {paged.map((m) => (
                  <div key={key(m)} className="mod-row" data-disabled={!m.enabled || undefined}>
                    <ContentIcon url={m.iconUrl} size={40} />
                    <div className="mod-info">
                      <div className="mod-title">{m.title}</div>
                      <span className="mod-meta">
                        {m.kind === 'mod' && problemFiles.has(m.fileName) && (
                          <AlertTriangle size={13} className="mod-problem" aria-label="Has a problem" />
                        )}
                        {typeFilter === 'all' && kinds.length > 1 && <span className="kind-tag">{CONTENT[m.kind].noun}</span>}
                        {m.projectId ? (
                          <button className="mod-version-btn" onClick={() => setVersionFor(m)} title="Choose a different version">
                            <span>{m.versionNumber ?? 'Version'}</span>
                            <ChevronsUpDown size={12} />
                          </button>
                        ) : (
                          'Local file'
                        )}
                        {m.updateVersion && <span className="mod-update-to">→ {m.updateVersion}</span>}
                        <span className="dot">·</span>
                        <span className="mod-file">{m.fileName}</span>
                      </span>
                    </div>
                    {m.updateVersion && (
                      <button
                        className="icon-btn icon-btn-update"
                        onClick={() => setChangelogFor(m)}
                        disabled={isUpdating(m)}
                        aria-label={`Update ${m.title} to ${m.updateVersion}`}
                        title={`See what’s new in ${m.updateVersion}`}
                      >
                        {isUpdating(m) ? <LoaderCircle size={16} className="spin" /> : <ArrowUpCircle size={16} />}
                      </button>
                    )}
                    <Toggle
                      label={`${m.enabled ? 'Disable' : 'Enable'} ${m.title}`}
                      checked={m.enabled}
                      onChange={(on) => apply(m.kind, api.content.setEnabled(target(m.kind), m.fileName, on))}
                    />
                    <button
                      className="icon-btn icon-btn-danger"
                      aria-label={`Remove ${m.title}`}
                      title="Remove"
                      onClick={() => apply(m.kind, api.content.remove(target(m.kind), m.fileName))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {shown.length > PAGE_SIZES[0] && (
                <Pagination page={currentPage} pageSize={pageSize} total={shown.length} onPage={goToPage} onPageSize={setPageSize} />
              )}
              <p className="content-hint">
                {enabledCount} of {shown.length} enabled{hint ? ` · ${hint}` : ''}
              </p>
            </>
          )}
        </>
      )}

      {tool === 'performance' && (
        <PerformanceModal
          profile={profile}
          onInstalled={(items) => {
            setList('mod', items);
            checkUpdates('mod');
          }}
          onSuccess={onSuccess}
          onClose={() => setTool(null)}
        />
      )}

      {tool === 'sets' && (
        <ModSetsModal
          profile={profile}
          kinds={kinds}
          installed={all}
          onInstalled={(kind, items) => {
            setList(kind, items);
            checkUpdates(kind);
          }}
          onSuccess={onSuccess}
          onClose={() => setTool(null)}
        />
      )}

      {versionFor && (
        <VersionModal
          title={versionFor.title}
          iconUrl={versionFor.iconUrl}
          target={target(versionFor.kind)}
          projectId={versionFor.projectId!}
          currentVersionId={versionFor.versionId}
          onInstalled={(items) => {
            setList(versionFor.kind, items);
            checkUpdates(versionFor.kind);
          }}
          onClose={() => setVersionFor(null)}
        />
      )}

      {changelogFor && (
        <UpdateModal
          item={changelogFor}
          target={target(changelogFor.kind)}
          running={running}
          onClose={() => setChangelogFor(null)}
          onUpdate={() => runUpdate([changelogFor], false)}
        />
      )}
    </div>
  );
}

/** What changed in an update, with a button to apply it. */
function UpdateModal({
  item,
  target,
  running,
  onClose,
  onUpdate,
}: {
  item: Item;
  target: { profileId: string; kind: ContentKind; world?: string };
  running: boolean;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [log, setLog] = useState<Changelog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.content
      .changelog(target, item.fileName)
      .then(setLog)
      .catch(() => setFailed(true));
    // Loaded once per opened item.
  }, []);

  return (
    <Modal
      title={`Update ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={running}
            title={running ? 'Close the game to update' : undefined}
            onClick={() => {
              onUpdate();
              onClose();
            }}
          >
            <ArrowUpCircle size={16} /> Update to {item.updateVersion}
          </button>
        </>
      }
    >
      <p className="modal-text">
        {item.versionNumber ?? 'Your version'} → <strong>{item.updateVersion}</strong>
      </p>
      {failed ? (
        <p className="mod-empty">Couldn’t load the changelog.</p>
      ) : !log ? (
        <div className="mod-loading">
          <LoaderCircle size={22} className="spin" />
        </div>
      ) : (
        <div className="changelog">
          {log.entries.map((entry) => (
            <section key={entry.versionNumber} className="changelog-entry">
              <header>
                <strong>{entry.versionNumber}</strong>
                {entry.type !== 'release' && <span className="kind-tag">{entry.type}</span>}
                <span className="changelog-date">{timeAgo(entry.date)}</span>
              </header>
              {entry.changelog.trim() ? <Markdown text={entry.changelog} /> : <p className="changelog-none">No changelog for this version.</p>}
            </section>
          ))}
          {log.more > 0 && <p className="changelog-none">…and {log.more} older {log.more === 1 ? 'version' : 'versions'}.</p>}
        </div>
      )}
    </Modal>
  );
}

/** Shaders only run with Iris (or OptiFine/Oculus on Forge); offer to install Iris when it's missing. */
function ShaderNotice({
  profile,
  hasIris,
  onInstalled,
  onError,
  onSuccess,
}: {
  profile: Profile;
  hasIris: boolean;
  onInstalled: (mods: InstalledContent[]) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [installing, setInstalling] = useState(false);

  if (profile.loader === 'forge') {
    return (
      <div className="content-notice">
        <Info size={18} />
        <p>Forge can’t run Iris. Shaders need OptiFine or Oculus: download one and drop the jar here.</p>
      </div>
    );
  }
  if (hasIris) return null;

  const installIris = async () => {
    setInstalling(true);
    try {
      onInstalled(await api.content.install({ profileId: profile.id, kind: 'mod' }, IRIS_PROJECT_ID));
      onSuccess('Installed Iris. Shaders are ready to use.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="content-notice">
      <Sparkles size={18} />
      <p>Shaders need the Iris mod, which isn’t installed in this profile.</p>
      <button className="btn btn-primary btn-play" onClick={installIris} disabled={installing}>
        {installing ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
        {installing ? 'Installing…' : 'Install Iris'}
      </button>
    </div>
  );
}
