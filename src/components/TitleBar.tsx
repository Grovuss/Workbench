import { Fragment } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Square } from 'lucide-react';
import logo from '../assets/logo.svg';
import ProgressBar, { progressPercent } from './ProgressBar';
import type { LaunchStatus, Profile } from '../types';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

interface Props {
  crumbs: Crumb[];
  canGoBack: boolean;
  onBack: () => void;
  profiles: Profile[];
  launches: Record<string, LaunchStatus>;
  onOpenProfile: (id: string) => void;
  onStop: (id: string) => void;
}

export default function TitleBar({ crumbs, canGoBack, onBack, profiles, launches, onOpenProfile, onStop }: Props) {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img src={logo} alt="" />
        <span className="logo-text">workbench</span>
      </div>

      <div className="titlebar-main">
        <button className="icon-btn" aria-label="Back" disabled={!canGoBack} onClick={onBack}>
          <ChevronLeft size={18} />
        </button>
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight size={14} className="crumb-sep" />}
              {c.onClick ? (
                <button className="crumb" onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <span className="crumb crumb-current" aria-current="page">
                  {c.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>

        <div className="titlebar-spacer" />
        <Processes profiles={profiles} launches={launches} onOpenProfile={onOpenProfile} onStop={onStop} />
      </div>
    </header>
  );
}

function Processes({
  profiles,
  launches,
  onOpenProfile,
  onStop,
}: Pick<Props, 'profiles' | 'launches' | 'onOpenProfile' | 'onStop'>) {
  const active = Object.entries(launches)
    .map(([id, launch]) => ({ profile: profiles.find((p) => p.id === id), launch }))
    .filter((x): x is { profile: Profile; launch: LaunchStatus } => Boolean(x.profile));

  if (active.length === 0) {
    return (
      <div className="process-pill process-idle">
        <span className="process-dot" /> No games running
      </div>
    );
  }

  return (
    <div className="process-list">
      {active.map(({ profile, launch }) => {
        const percent = progressPercent(launch.progress);
        return (
          <div key={profile.id} className="process-pill" data-state={launch.state}>
            <button
              className="process-main"
              title={launch.progress?.label}
              onClick={() => onOpenProfile(profile.id)}
            >
              {launch.state === 'running' ? (
                <span className="process-dot process-dot-running" />
              ) : (
                <LoaderCircle size={14} className="spin" />
              )}
              <span className="process-name">{profile.name}</span>
              {launch.state === 'installing' && (
                <>
                  <ProgressBar value={percent} size="sm" label={`Installing ${profile.name}`} />
                  <span className="process-pct">{percent === null ? '' : `${percent}%`}</span>
                </>
              )}
            </button>
            {launch.state === 'running' && (
              <button className="process-stop" aria-label={`Stop ${profile.name}`} onClick={() => onStop(profile.id)}>
                <Square size={11} fill="currentColor" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
