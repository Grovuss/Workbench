import { useMemo, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ProfileRow from '../components/ProfileRow';
import ComingSoon from '../components/ComingSoon';
import CreateProfileModal from '../components/CreateProfileModal';
import Modal from '../components/Modal';
import { api, errorMessage } from '../api';
import type { LaunchStatus, Profile } from '../types';

interface Props {
  profiles: Profile[] | null;
  launches: Record<string, LaunchStatus>;
  onCreated: (profile: Profile) => void;
  onDeleted: (id: string) => void;
  onPlay: (profile: Profile) => void;
  onError: (message: string) => void;
}

// Most recently played first; never-played profiles by creation date.
const recency = (p: Profile) => p.lastPlayedAt ?? p.createdAt;

export default function ProfilesPage({ profiles, launches, onCreated, onDeleted, onPlay, onError }: Props) {
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = useMemo(
    () => [...(profiles ?? [])].sort((a, b) => recency(b).localeCompare(recency(a))),
    [profiles],
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.profiles.delete(pendingDelete.id);
      onDeleted(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

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
              onPlay={() => onPlay(p)}
              onStop={() => api.game.stop(p.id).catch((err) => onError(errorMessage(err)))}
              onOpenFolder={() => api.profiles.openFolder(p.id).catch((err) => onError(errorMessage(err)))}
              onDelete={() => setPendingDelete(p)}
            />
          ))}
        </div>
      )}

      <ComingSoon />

      {creating && <CreateProfileModal onClose={() => setCreating(false)} onCreated={onCreated} />}

      {pendingDelete && (
        <Modal
          title={`Delete “${pendingDelete.name}”?`}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button className="btn btn-danger-fill" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete profile'}
              </button>
            </>
          }
        >
          <p className="modal-text">
            This permanently deletes the profile’s folder, including its worlds, screenshots and settings.
          </p>
        </Modal>
      )}
    </>
  );
}
