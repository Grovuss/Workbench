import { useState, type FormEvent, type ReactNode } from 'react';
import {
  FileArchive,
  FileCog,
  FolderOpen,
  Globe,
  Image,
  ImagePlus,
  Info,
  MoreHorizontal,
  Package,
  QrCode,
  Server,
  Settings,
  SquareTerminal,
} from 'lucide-react';
import LoaderBadge from '../components/LoaderBadge';
import ProfileIcon from '../components/ProfileIcon';
import Modal from '../components/Modal';
import { LOADER_LABELS, loaderVersionLabel } from '../loaders';
import PlayButton from '../components/PlayButton';
import ProgressBar, { progressPercent } from '../components/ProgressBar';
import WorldsTab from '../components/profile/WorldsTab';
import LogsTab from '../components/profile/LogsTab';
import ProfileSettingsTab from '../components/profile/ProfileSettingsTab';
import ContentTab from '../components/content/ContentTab';
import ExportModal from '../components/profile/ExportModal';
import ScreenshotsTab from '../components/profile/ScreenshotsTab';
import ConfigsTab from '../components/profile/ConfigsTab';
import { ModpackUpdateBanner, ServerPackModal, ShareCodeModal } from '../components/profile/ShareTools';
import Dropdown from '../components/Dropdown';
import { api, errorMessage } from '../api';
import { contentBlockedReason } from '../content';
import { formatPlaytime, timeAgo } from '../time';
import type { ContentKind, LaunchStatus, Profile, QuickPlay } from '../types';

export type ProfileTab = 'content' | 'worlds' | 'screenshots' | 'configs' | 'logs' | 'settings';

const TABS: { id: ProfileTab; label: string; icon: ReactNode }[] = [
  { id: 'content', label: 'Content', icon: <Package size={16} /> },
  { id: 'worlds', label: 'Worlds', icon: <Globe size={16} /> },
  { id: 'screenshots', label: 'Screenshots', icon: <Image size={16} /> },
  { id: 'configs', label: 'Configs', icon: <FileCog size={16} /> },
  { id: 'logs', label: 'Logs', icon: <SquareTerminal size={16} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
];

// Sits apart from the others, at the far end of the tab bar.
const SETTINGS_TAB: ProfileTab = 'settings';

// Data packs belong to worlds, so they live in the Worlds tab.
const PROFILE_KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader'];

interface Props {
  profile: Profile;
  launch?: LaunchStatus;
  /** Tab to open on, e.g. settings after a crash caused by too little memory. */
  initialTab?: ProfileTab;
  /** Starts the game, optionally straight into a server or world. */
  onPlay: (quickPlay?: QuickPlay) => void;
  onStop: () => void;
  onUpdated: (profile: Profile) => void;
  onDeleted: () => void;
  onDuplicated: (profile: Profile) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export default function ProfilePage({
  profile,
  launch,
  initialTab = 'content',
  onPlay,
  onStop,
  onUpdated,
  onDeleted,
  onDuplicated,
  onError,
  onSuccess,
}: Props) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [duplicating, setDuplicating] = useState(false);
  const contentKinds = PROFILE_KINDS.filter((kind) => !contentBlockedReason(kind, profile.loader));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState<'workbench' | 'code' | 'server' | null>(null);
  const running = launch?.state === 'running';
  const playtime = formatPlaytime(profile.playtimeMs);
  const changeIcon = () =>
    api.profiles
      .setIcon(profile.id)
      .then((p) => p && onUpdated(p))
      .catch((err) => onError(errorMessage(err)));

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
      <div className="profile-layout">
        <aside className="profile-side">
          <section className="profile-panel">
            <div className="profile-panel-head">
              <button className="profile-hero-icon-btn" onClick={changeIcon} aria-label="Change profile icon">
                <ProfileIcon profile={profile} className="profile-hero-icon" />
                <span className="profile-hero-icon-overlay">
                  <ImagePlus size={22} />
                </span>
              </button>
              <div className="profile-panel-info">
                <h1 className="profile-name">{profile.name}</h1>
                <div className="profile-panel-played">
                  {profile.lastPlayedAt ? `Played ${timeAgo(profile.lastPlayedAt)}` : 'Never played'}
                </div>
              </div>
            </div>
            <div className="profile-panel-actions">
              <PlayButton launch={launch} onPlay={() => onPlay()} onStop={onStop} large />
              <Dropdown
                label={<MoreHorizontal size={20} />}
                className="btn btn-secondary hero-more"
                chevron={false}
                ariaLabel="More options"
                items={[
                  {
                    icon: <FolderOpen size={16} />,
                    label: 'Open folder',
                    onSelect: () => api.profiles.openFolder(profile.id).catch((err) => onError(errorMessage(err))),
                  },
                  {
                    icon: <ImagePlus size={16} />,
                    label: 'Change icon',
                    onSelect: changeIcon,
                  },
                  {
                    section: 'Share',
                    icon: <FileArchive size={16} />,
                    label: 'Export .workbench file',
                    hint: 'Everything, including config',
                    onSelect: () => setSharing('workbench'),
                  },
                  {
                    icon: <QrCode size={16} />,
                    label: 'Share code',
                    hint: 'Text to paste to a friend',
                    onSelect: () => setSharing('code'),
                  },
                  ...(profile.loader !== 'vanilla'
                    ? [
                        {
                          icon: <Server size={16} />,
                          label: 'Server pack',
                          hint: 'Run this profile as a server',
                          onSelect: () => setSharing('server'),
                        },
                      ]
                    : []),
                ]}
              />
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

          <ModpackUpdateBanner profile={profile} busy={Boolean(launch)} onUpdated={onUpdated} onSuccess={onSuccess} />
          <section className="profile-info" aria-labelledby="profile-info-title">
            <header>
              <h2 id="profile-info-title">
                <Info size={16} /> Profile info
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setTab('settings')}>
                Change
              </button>
            </header>
            <dl>
              <dt>Loader</dt>
              <dd>
                <LoaderBadge loader={profile.loader} />
              </dd>
              <dt>Minecraft</dt>
              <dd>{profile.mcVersion}</dd>
              {profile.loaderVersion && (
                <>
                  <dt>{LOADER_LABELS[profile.loader]} version</dt>
                  <dd>{loaderVersionLabel(profile.loader, profile.mcVersion, profile.loaderVersion)}</dd>
                </>
              )}
              {profile.pack && (
                <>
                  <dt>Modpack</dt>
                  <dd>
                    {profile.pack.title} {profile.pack.versionNumber}
                  </dd>
                </>
              )}
              <dt>Playtime</dt>
              <dd>{playtime ?? 'None yet'}</dd>
              <dt>Last played</dt>
              <dd>{profile.lastPlayedAt ? timeAgo(profile.lastPlayedAt) : 'Never'}</dd>
              <dt>Created</dt>
              <dd>{new Date(profile.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd>
            </dl>
          </section>
        </aside>

        <div className="profile-main">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                className={t.id === SETTINGS_TAB ? 'tab tab-end' : 'tab'}
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === 'content' && (
              <>
                {profile.loader === 'vanilla' && (
                  <div className="content-notice">
                    <Info size={18} />
                    <p>Vanilla profiles can use resource packs. Mods and shaders need a mod loader.</p>
                    <button className="btn btn-secondary btn-sm" onClick={() => setTab('settings')}>
                      Change loader
                    </button>
                  </div>
                )}
                <ContentTab
                  key={contentKinds.join(',')}
                  profile={profile}
                  kinds={contentKinds}
                  running={running}
                  onOpenSettings={() => setTab('settings')}
                  onError={onError}
                  onSuccess={onSuccess}
                />
              </>
            )}
            {tab === 'worlds' && (
              <WorldsTab
                profile={profile}
                running={running}
                launching={Boolean(launch)}
                onPlay={onPlay}
                onError={onError}
                onSuccess={onSuccess}
              />
            )}
            {tab === 'screenshots' && (
              <ScreenshotsTab profile={profile} running={running} onUpdated={onUpdated} onError={onError} onSuccess={onSuccess} />
            )}
            {tab === 'configs' && <ConfigsTab profileId={profile.id} running={running} onError={onError} onSuccess={onSuccess} />}
            {tab === 'logs' && <LogsTab profileId={profile.id} running={running} onError={onError} />}
            {tab === 'settings' && (
              <ProfileSettingsTab
                profile={profile}
                busy={Boolean(launch)}
                onUpdated={onUpdated}
                onDelete={() => setConfirmingDelete(true)}
                onDuplicate={() => setDuplicating(true)}
                onError={onError}
              />
            )}
          </div>
        </div>
      </div>

      {duplicating && (
        <DuplicateModal profile={profile} onClose={() => setDuplicating(false)} onDuplicated={onDuplicated} onError={onError} />
      )}

      {sharing === 'workbench' && (
        <ExportModal profile={profile} onClose={() => setSharing(null)} onExported={onSuccess} onError={onError} />
      )}
      {sharing === 'code' && <ShareCodeModal profile={profile} onClose={() => setSharing(null)} />}
      {sharing === 'server' && <ServerPackModal profile={profile} onClose={() => setSharing(null)} onSuccess={onSuccess} />}

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
          <p className="modal-text">This permanently deletes the profile’s folder, including its worlds, screenshots and settings.</p>
        </Modal>
      )}
    </>
  );
}

function DuplicateModal({
  profile,
  onClose,
  onDuplicated,
  onError,
}: {
  profile: Profile;
  onClose: () => void;
  onDuplicated: (profile: Profile) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(`${profile.name} (copy)`.slice(0, 48));
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onDuplicated(await api.profiles.duplicate(profile.id, name));
    } catch (err) {
      onError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Duplicate profile"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="duplicate-profile" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Copying…' : 'Duplicate'}
          </button>
        </>
      }
    >
      <form id="duplicate-profile" className="form" onSubmit={submit}>
        <p className="modal-text">Copies everything: mods, worlds, config and settings. Playtime starts from zero.</p>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
      </form>
    </Modal>
  );
}
