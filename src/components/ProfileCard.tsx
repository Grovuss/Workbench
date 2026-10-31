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

/** A profile as a tile, for the grid view of the profiles page. */
export default function ProfileCard({ profile, launch, onOpen, onPlay, onStop }: Props) {
  const state = launch?.state ?? 'idle';
  const playtime = formatPlaytime(profile.playtimeMs);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpen();
    }
  };
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className="profile-card" role="link" tabIndex={0} onClick={onOpen} onKeyDown={onKeyDown}>
      <ProfileIcon profile={profile} className="profile-card-icon" />
      <div className="profile-card-name">
        <span className="profile-name-text">{profile.name}</span>
        {state === 'running' && <span className="running-dot" aria-label="Running" />}
      </div>
      <div className="profile-meta">
        <LoaderBadge loader={profile.loader} />
        {profile.mcVersion}
      </div>
      {state === 'installing' ? (
        <div className="profile-card-progress">
          <ProgressBar value={progressPercent(launch?.progress)} size="sm" label={`Installing ${profile.name}`} />
        </div>
      ) : (
        <div className="profile-card-played">
          {profile.lastPlayedAt ? `Played ${timeAgo(profile.lastPlayedAt)}` : 'Never played'}
          {playtime && ` · ${playtime}`}
        </div>
      )}
      <div className="profile-card-actions" onClick={stop}>
        <PlayButton launch={launch} onPlay={onPlay} onStop={onStop} />
      </div>
    </div>
  );
}
