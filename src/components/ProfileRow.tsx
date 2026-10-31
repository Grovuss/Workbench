import type { KeyboardEvent, MouseEvent } from 'react';
import LoaderBadge from './LoaderBadge';
import ProfileIcon from './ProfileIcon';
import PlayButton from './PlayButton';
import ProgressBar, { progressPercent } from './ProgressBar';
import { formatPlaytime, timeAgo } from '../time';
import type { LaunchStatus, Profile } from '../types';

interface Props {
  profile: Profile;
  launch?: LaunchStatus;
  onOpen: () => void;
  onPlay: () => void;
  onStop: () => void;
}

export default function ProfileRow({ profile, launch, onOpen, onPlay, onStop }: Props) {
  const state = launch?.state ?? 'idle';
  const progress = launch?.progress;
  const playtime = formatPlaytime(profile.playtimeMs);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpen();
    }
  };
  // Keep clicks on the play button from also opening the profile.
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className="profile-row" role="link" tabIndex={0} onClick={onOpen} onKeyDown={onKeyDown}>
      <ProfileIcon profile={profile} className="profile-icon" />

      <div className="profile-info">
        <div className="profile-name">
          <span className="profile-name-text">{profile.name}</span>
          {state === 'running' && (
            <span className="badge badge-running">
              <span className="running-dot" /> Running
            </span>
          )}
        </div>

        {state === 'installing' ? (
          <div className="profile-row-progress">
            <span className="profile-meta">{progress?.label ?? 'Preparing…'}</span>
            <ProgressBar value={progressPercent(progress)} size="sm" label={`Installing ${profile.name}`} />
          </div>
        ) : (
          <div className="profile-meta">
            <LoaderBadge loader={profile.loader} />
            {profile.mcVersion}
            <span className="dot">·</span>
            {profile.lastPlayedAt ? `Played ${timeAgo(profile.lastPlayedAt)}` : 'Never played'}
            {playtime && (
              <>
                <span className="dot">·</span>
                {playtime}
              </>
            )}
          </div>
        )}
      </div>

      <div className="profile-actions" onClick={stop}>
        <PlayButton launch={launch} onPlay={onPlay} onStop={onStop} />
      </div>
    </div>
  );
}
