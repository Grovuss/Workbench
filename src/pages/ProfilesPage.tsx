import { useMemo, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ProfileRow from '../components/ProfileRow';
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

// Most recently played first; never-played profiles by creation date.
const recency = (p: Profile) => p.lastPlayedAt ?? p.createdAt;

export default function ProfilesPage({ profiles, launches, onCreated, onOpen, onPlay, onStop }: Props) {
  const [creating, setCreating] = useState(false);

  const sorted = useMemo(
    () => [...(profiles ?? [])].sort((a, b) => recency(b).localeCompare(recency(a))),
    [profiles],
  );

  const createButton = (
    <button className="btn btn-primary" onClick={() => setCreating(true)}>
      <Plus size={18} strokeWidth={2.5} /> Create Profile
    </button>
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

      {sorted.length > 0 && (
        <div className="profile-list">
          {sorted.map((p) => (
            <ProfileRow
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

      <ComingSoon />

      {creating && <CreateProfileModal onClose={() => setCreating(false)} onCreated={onCreated} />}
    </>
  );
}
