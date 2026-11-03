import { useEffect, useState } from 'react';
import { Image as ImageIcon, LoaderCircle } from 'lucide-react';
import Modal from './Modal';
import { api, errorMessage } from '../api';
import type { Profile, Screenshot } from '../types';

interface Props {
  title: string;
  onPick: (profileId: string, fileName: string) => Promise<void> | void;
  onClose: () => void;
  onError: (message: string) => void;
}

const thumb = (profileId: string, shot: Screenshot) =>
  `workbench://screenshot/${profileId}/${encodeURIComponent(shot.fileName)}?v=${encodeURIComponent(shot.takenAt)}&thumb=1`;

/** Every profile's screenshots in one place, newest first, to pick one from. */
export default function ScreenshotPickerModal({ title, onPick, onClose, onError }: Props) {
  const [groups, setGroups] = useState<{ profile: Profile; shots: Screenshot[] }[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const profiles = await api.profiles.list();
        const all = await Promise.all(profiles.map(async (profile) => ({ profile, shots: await api.screenshots.list(profile.id).catch(() => []) })));
        if (canceled) return;
        // Profiles with the newest screenshots first.
        setGroups(all.filter((g) => g.shots.length > 0).sort((a, b) => b.shots[0].takenAt.localeCompare(a.shots[0].takenAt)));
      } catch (err) {
        if (!canceled) onError(errorMessage(err));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [onError]);

  const pick = async (profileId: string, fileName: string) => {
    setPicking(`${profileId}/${fileName}`);
    try {
      await onPick(profileId, fileName);
      onClose();
    } catch (err) {
      onError(errorMessage(err));
      setPicking(null);
    }
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      {!groups ? (
        <div className="shot-picker-loading">
          <LoaderCircle size={22} className="spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="empty empty-compact">
          <ImageIcon className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No screenshots yet</h2>
          <p>Press F2 in game to take one. Screenshots from all your profiles show up here.</p>
        </div>
      ) : (
        <div className="shot-picker">
          {groups.map(({ profile, shots }) => (
            <section key={profile.id} className="shot-picker-group">
              <h3>{profile.name}</h3>
              <div className="shot-picker-grid">
                {shots.map((shot) => {
                  const key = `${profile.id}/${shot.fileName}`;
                  return (
                    <button
                      key={shot.fileName}
                      className="shot-picker-item"
                      disabled={picking !== null}
                      onClick={() => pick(profile.id, shot.fileName)}
                      title={shot.fileName}
                    >
                      <img src={thumb(profile.id, shot)} alt={shot.fileName} loading="lazy" />
                      {picking === key && (
                        <span className="shot-picker-busy">
                          <LoaderCircle size={20} className="spin" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
