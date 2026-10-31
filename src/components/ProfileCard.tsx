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
  const iconUrl = `workbench://profile-icon/${profile.id}?v=${encodeURIComponent(profile.icon ?? '')}`;
  const coverUrl = profile.cover && `workbench://screenshot/${profile.id}/${encodeURIComponent(profile.cover)}?thumb=1`;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpen();
    }
  };
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className="profile-card" role="link" tabIndex={0} onClick={onOpen} onKeyDown={onKeyDown}>
      <div className="profile-card-cover" data-shot={coverUrl ? true : undefined}>
        {coverUrl ? (
          <img className="profile-card-shot" src={coverUrl} alt="" />
        ) : (
          profile.icon && <img className="profile-card-backdrop" src={iconUrl} alt="" />
        )}
        <ProfileIcon profile={profile} className="profile-card-icon" />
        {state === 'running' && <span className="profile-card-running">Running</span>}
      </div>
      <div className="profile-card-body">
        <div className="profile-card-name">{profile.name}</div>
        <div className="profile-meta">
          <LoaderBadge loader={profile.loader} />
          {profile.mcVersion}
        </div>
        {state === 'installing' ? (
          <div className="profile-card-progress">
            <ProgressBar value={progressPercent(launch?.progress)} size="sm" label={`Installing ${profile.name}`} />
          </div>
        ) : (
          <div className="profile-card-footer">
            <span className="profile-card-played">
              {profile.lastPlayedAt ? timeAgo(profile.lastPlayedAt) : 'Never played'}
              {playtime && ` · ${playtime}`}
            </span>
            <div onClick={stop}>
              <PlayButton launch={launch} onPlay={onPlay} onStop={onStop} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
