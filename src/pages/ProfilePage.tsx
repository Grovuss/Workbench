import { useState } from 'react';
import { FolderOpen, Share } from 'lucide-react';
import logo from '../assets/logo.svg';
import LoaderBadge from '../components/LoaderBadge';
import Modal from '../components/Modal';
import { LOADER_LABELS, loaderVersionLabel } from '../loaders';
import PlayButton from '../components/PlayButton';
import ProgressBar, { progressPercent } from '../components/ProgressBar';
import WorldsTab from '../components/profile/WorldsTab';
import LogsTab from '../components/profile/LogsTab';
import ProfileSettingsTab from '../components/profile/ProfileSettingsTab';
import ModsTab from '../components/profile/ModsTab';
import ExportModal from '../components/profile/ExportModal';
import { api, errorMessage } from '../api';
import { timeAgo } from '../time';
import type { LaunchStatus, Profile } from '../types';

type Tab = 'worlds' | 'mods' | 'logs' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'worlds', label: 'Worlds' },
  { id: 'mods', label: 'Mods' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

interface Props {
  profile: Profile;
  launch?: LaunchStatus;
  onPlay: () => void;
  onStop: () => void;
  onUpdated: (profile: Profile) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export default function ProfilePage({ profile, launch, onPlay, onStop, onUpdated, onDeleted, onError, onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>('worlds');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const running = launch?.state === 'running';

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.profiles.delete(profile.id);
      onDeleted();
    } catch (err) {
      onError(errorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <>
      <section className="profile-hero">
        <div className="profile-hero-icon">
          <img src={logo} alt="" />
        </div>
        <div className="profile-hero-info">
          <h1 className="page-title">{profile.name}</h1>
          <div className="profile-hero-meta">
            <LoaderBadge loader={profile.loader} />
            <span>Minecraft {profile.mcVersion}</span>
            {profile.loaderVersion && (
              <>
                <span className="dot">·</span>
                <span>
                  {LOADER_LABELS[profile.loader]}{' '}
                  {loaderVersionLabel(profile.loader, profile.mcVersion, profile.loaderVersion)}
                </span>
              </>
            )}
            <span className="dot">·</span>
            <span>{profile.lastPlayedAt ? `Played ${timeAgo(profile.lastPlayedAt)}` : 'Never played'}</span>
          </div>
        </div>
        <div className="profile-hero-actions">
          <button
            className="btn btn-secondary"
            onClick={() => api.profiles.openFolder(profile.id).catch((err) => onError(errorMessage(err)))}
          >
            <FolderOpen size={16} /> Folder
          </button>
          <button className="btn btn-secondary" onClick={() => setExporting(true)}>
            <Share size={16} /> Export
          </button>
          <PlayButton launch={launch} onPlay={onPlay} onStop={onStop} large />
        </div>
        {launch?.state === 'installing' && (
          <div className="profile-hero-progress">
            <ProgressBar value={progressPercent(launch.progress)} label={`Installing ${profile.name}`} />
            <span>
              {launch.progress
                ? `${launch.progress.label} · ${launch.progress.done.toLocaleString()} / ${launch.progress.total.toLocaleString()}`
                : 'Preparing…'}
            </span>
          </div>
        )}
      </section>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            className="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'worlds' && <WorldsTab profileId={profile.id} running={running} onError={onError} />}
        {tab === 'mods' && <ModsTab profile={profile} onOpenSettings={() => setTab('settings')} onError={onError} />}
        {tab === 'logs' && <LogsTab profileId={profile.id} running={running} onError={onError} />}
        {tab === 'settings' && (
          <ProfileSettingsTab
            profile={profile}
            busy={Boolean(launch)}
            onUpdated={onUpdated}
            onDelete={() => setConfirmingDelete(true)}
            onError={onError}
          />
        )}
      </div>

      {exporting && (
        <ExportModal profile={profile} onClose={() => setExporting(false)} onExported={onSuccess} onError={onError} />
      )}

      {confirmingDelete && (
        <Modal
          title={`Delete “${profile.name}”?`}
          onClose={() => setConfirmingDelete(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirmingDelete(false)}>
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
