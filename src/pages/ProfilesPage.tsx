import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ChevronDown, FolderMinus, LayoutGrid, Layers, List, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ProfileRow from '../components/ProfileRow';
import ProfileCard from '../components/ProfileCard';
import ComingSoon from '../components/ComingSoon';
import CreateProfileModal from '../components/CreateProfileModal';
import Dropdown from '../components/Dropdown';
import GroupModal from '../components/GroupModal';
import { api, errorMessage } from '../api';
import type { LaunchStatus, Profile } from '../types';
import { useStoredChoice, useStoredSet } from '../stored';

interface Props {
  profiles: Profile[] | null;
  launches: Record<string, LaunchStatus>;
  onCreated: (profile: Profile) => void;
  onOpen: (id: string) => void;
  onPlay: (profile: Profile) => void;
  onStop: (id: string) => void;
  onProfilesChanged: (profiles: Profile[]) => void;
  onError: (message: string) => void;
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


export default function ProfilesPage({ profiles, launches, onCreated, onOpen, onPlay, onStop, onProfilesChanged, onError }: Props) {
  const [creating, setCreating] = useState(false);
  const [view, setView] = useStoredChoice<View>('workbench.profilesView', ['list', 'grid'], 'list');
  const [sort, setSort] = useStoredChoice<Sort>('workbench.profilesSort', SORTS.map((s) => s.id), 'recent');
  const [query, setQuery] = useState('');
  const [collapsed, toggleCollapsed] = useStoredSet('workbench.collapsedGroups');
  const [renaming, setRenaming] = useState<string | null>(null);


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

  // Groups in name order, then everything not in one. Without any groups it's one plain list.
  const groupNames = [...new Set((profiles ?? []).map((p) => p.group).filter((g): g is string => Boolean(g)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const sections = groupNames.length
    ? [
        ...groupNames.map((name) => ({ name, items: shown.filter((p) => p.group === name) })),
        { name: null, items: shown.filter((p) => !p.group) },
      ].filter((s) => s.items.length > 0)
    : [{ name: null, items: shown }];

  const renameGroup = async (from: string, to: string | null) => {
    try {
      onProfilesChanged(await api.profiles.renameGroup(from, to));
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const list = (items: Profile[]) => (
    <div className={view === 'grid' ? 'profile-grid' : 'profile-list'}>
      {items.map((p) => (
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
  );

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
            sections.map(({ name, items }) => {
              if (groupNames.length === 0) return <div key="all">{list(items)}</div>;
              const key = name ?? '';
              const open = !collapsed.has(key);
              return (
                <section key={key} className="profile-group">
                  <div className="profile-group-head">
                    <button className="profile-group-toggle" aria-expanded={open} onClick={() => toggleCollapsed(key)}>
                      <ChevronDown size={16} className="profile-group-chevron" />
                      <span className="profile-group-name">{name ?? 'Other profiles'}</span>
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
                            hint: 'Profiles stay, the group goes',
                            onSelect: () => renameGroup(name, null),
                          },
                        ]}
                      />
                    )}
                  </div>
                  {open && list(items)}
                </section>
              );
            })
          )}
        </>
      )}

      <ComingSoon />

      {creating && <CreateProfileModal onClose={() => setCreating(false)} onCreated={onCreated} />}
      {renaming && (
        <GroupModal
          title="Rename group"
          initial={renaming}
          groups={[]}
          submitLabel="Rename"
          onSubmit={(name) => renameGroup(renaming, name)}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  );
}
