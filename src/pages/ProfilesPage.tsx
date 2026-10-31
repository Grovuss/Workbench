import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, LayoutGrid, Layers, List, Plus, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ProfileRow from '../components/ProfileRow';
import ProfileCard from '../components/ProfileCard';
import ComingSoon from '../components/ComingSoon';
import CreateProfileModal from '../components/CreateProfileModal';
import type { LaunchStatus, Profile } from '../types';

interface Props {
  profiles: Profile[] | null;
  launches: Record<string, LaunchStatus>;
  onCreated: (profile: Profile) => void;
  onOpen: (id: string) => void;
  onPlay: (profile: Profile) => void;
  onStop: (id: string) => void;
}

type View = 'list' | 'grid';
type Sort = 'recent' | 'name' | 'playtime' | 'created';

const SORTS: { id: Sort; label: string; compare: (a: Profile, b: Profile) => number }[] = [
  // Never-played profiles by creation date.
  { id: 'recent', label: 'Recently played', compare: (a, b) => (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt) },
  { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { id: 'playtime', label: 'Most played', compare: (a, b) => b.playtimeMs - a.playtimeMs },
  { id: 'created', label: 'Newest', compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
];

// Only show the search box once there are enough profiles to need it.
const SEARCH_THRESHOLD = 8;

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export default function ProfilesPage({ profiles, launches, onCreated, onOpen, onPlay, onStop }: Props) {
  const [creating, setCreating] = useState(false);
  const [view, setViewState] = useState<View>(() => stored('workbench.profilesView', ['list', 'grid'], 'list'));
  const [sort, setSortState] = useState<Sort>(() => stored('workbench.profilesSort', SORTS.map((s) => s.id), 'recent'));
  const [query, setQuery] = useState('');

  const setView = (next: View) => {
    setViewState(next);
    store('workbench.profilesView', next);
  };
  const setSort = (next: Sort) => {
    setSortState(next);
    store('workbench.profilesSort', next);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const compare = SORTS.find((s) => s.id === sort)!.compare;
    return (profiles ?? [])
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.mcVersion.includes(q) || p.loader.includes(q))
      .sort(compare);
  }, [profiles, sort, query]);

  const createButton = (
    <button className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={18} strokeWidth={2.5} /> Create Profile
    </button>
  );

  const Item = view === 'grid' ? ProfileCard : ProfileRow;

  return (
    <>
      <PageHeader title="Profiles" subtitle="Your local Minecraft profiles" actions={createButton} />

      {profiles && profiles.length === 0 && (
        <div className="empty">
          <Layers className="empty-icon" size={48} strokeWidth={1.5} />
          <h2>No profiles yet</h2>
          <p>Create a profile or import a modpack to get started.</p>
          {createButton}
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <>
          <div className="filter-row">
            {profiles.length >= SEARCH_THRESHOLD && (
              <label className="search-field content-search profiles-search">
                <Search size={16} />
                <input className="input" value={query} placeholder="Search profiles…" onChange={(e) => setQuery(e.target.value)} />
              </label>
            )}
            <label className="select-pill">
              <ArrowDownWideNarrow size={15} />
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort profiles">
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented view-switch filter-row-end" role="group" aria-label="View">
              <button aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label="List" title="List">
                <List size={15} />
              </button>
              <button aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label="Grid" title="Grid">
                <LayoutGrid size={15} />
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="mod-empty">No profiles match “{query}”.</p>
          ) : (
            <div className={view === 'grid' ? 'profile-grid' : 'profile-list'}>
              {shown.map((p) => (
                <Item
                  key={p.id}
                  profile={p}
                  launch={launches[p.id]}
                  onOpen={() => onOpen(p.id)}
                  onPlay={() => onPlay(p)}
                  onStop={() => onStop(p.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <ComingSoon />

      {creating && <CreateProfileModal onClose={() => setCreating(false)} onCreated={onCreated} />}
    </>
  );
}
