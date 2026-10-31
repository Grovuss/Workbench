import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CrashReport, LaunchStatus } from './types';

/** Tracks install/run state per profile from main-process game events. */
export function useLaunches(
  onError: (message: string) => void,
  onProfilesChanged: () => void,
  onCrash: (profileId: string, report: CrashReport) => void,
) {
  const [launches, setLaunches] = useState<Record<string, LaunchStatus>>({});
  const handlers = useRef({ onError, onProfilesChanged, onCrash });
  handlers.current = { onError, onProfilesChanged, onCrash };

  useEffect(() => {
    api.game
      .status()
      .then((s) => setLaunches(Object.fromEntries(Object.entries(s).map(([id, state]) => [id, { state }]))))
      .catch(() => {});

    return api.game.onEvent((event) => {
      switch (event.type) {
        case 'state':
          setLaunches((prev) => {
            const next = { ...prev };
            if (event.state === 'idle') delete next[event.profileId];
            else next[event.profileId] = { state: event.state };
            return next;
          });
          break;
        case 'progress': {
          const { stage, label, done, total } = event;
          setLaunches((prev) => ({
            ...prev,
            [event.profileId]: { state: 'installing', progress: { stage, label, done, total } },
          }));
          break;
        }
        case 'error':
          handlers.current.onError(event.message);
          break;
        case 'profiles-changed':
          handlers.current.onProfilesChanged();
          break;
        case 'crash':
          handlers.current.onCrash(event.profileId, event.report);
          break;
      }
    });
  }, []);

  return launches;
}
