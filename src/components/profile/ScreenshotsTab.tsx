import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, FolderOpen, Image, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { timeAgo } from '../../time';
import type { Screenshot } from '../../types';

interface Props {
  profileId: string;
  running: boolean;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const src = (profileId: string, shot: Screenshot, thumb: boolean) =>
  `workbench://screenshot/${profileId}/${encodeURIComponent(shot.fileName)}?v=${encodeURIComponent(shot.takenAt)}${thumb ? '&thumb=1' : ''}`;

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function ScreenshotsTab({ profileId, running, onError, onSuccess }: Props) {
  const [shots, setShots] = useState<Screenshot[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // Reload when the game stops, since that's when new screenshots appear.
  useEffect(() => {
    api.screenshots
      .list(profileId)
      .then(setShots)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, running, onError]);

  const close = useCallback(() => setOpen(null), []);

  if (!shots) return null;
  const current = open !== null ? shots[open] : null;

  const remove = async (shot: Screenshot) => {
    try {
      const next = await api.screenshots.remove(profileId, shot.fileName);
      setShots(next);
      if (!next.length) setOpen(null);
      else if (open !== null) setOpen(Math.min(open, next.length - 1));
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">
          {shots.length} {shots.length === 1 ? 'screenshot' : 'screenshots'}
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => api.profiles.openFolder(profileId, 'screenshots').catch((err) => onError(errorMessage(err)))}
        >
          <FolderOpen size={15} /> Open folder
        </button>
      </div>

      {shots.length === 0 ? (
        <div className="empty empty-compact">
          <Image className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No screenshots yet</h2>
          <p>Press F2 in game to take one. They show up here.</p>
        </div>
      ) : (
        <div className="shot-grid">
          {shots.map((shot, i) => (
            <button key={shot.fileName} className="shot" onClick={() => setOpen(i)} aria-label={`Open screenshot from ${dateFmt.format(new Date(shot.takenAt))}`}>
              <img src={src(profileId, shot, true)} alt="" loading="lazy" />
              <span className="shot-date">{timeAgo(shot.takenAt)}</span>
            </button>
          ))}
        </div>
      )}

      {current && open !== null && (
        <Lightbox
          image={src(profileId, current, false)}
          caption={dateFmt.format(new Date(current.takenAt))}
          hasPrev={open > 0}
          hasNext={open < shots.length - 1}
          onPrev={() => setOpen(open - 1)}
          onNext={() => setOpen(open + 1)}
          onClose={close}
          onCopy={() =>
            api.screenshots
              .copy(profileId, current.fileName)
              .then(() => onSuccess('Screenshot copied.'))
              .catch((err) => onError(errorMessage(err)))
          }
          onReveal={() => api.screenshots.reveal(profileId, current.fileName).catch((err) => onError(errorMessage(err)))}
          onDelete={() => remove(current)}
        />
      )}
    </>
  );
}

function Lightbox({
  image,
  caption,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onCopy,
  onReveal,
  onDelete,
}: {
  image: string;
  caption: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onCopy: () => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      else if (e.key === 'ArrowRight' && hasNext) onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasPrev, hasNext, onPrev, onNext, onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-bar">
        <span>{caption}</span>
        <div className="lightbox-actions">
          <button className="btn btn-ghost" onClick={onCopy}>
            <Copy size={15} /> Copy
          </button>
          <button className="btn btn-ghost" onClick={onReveal}>
            <FolderOpen size={15} /> Show in folder
          </button>
          <button className="btn btn-ghost btn-danger" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
      <img className="lightbox-image" src={image} alt="" />
      {hasPrev && (
        <button className="lightbox-nav lightbox-prev" aria-label="Previous" onClick={onPrev}>
          <ChevronLeft size={26} />
        </button>
      )}
      {hasNext && (
        <button className="lightbox-nav lightbox-next" aria-label="Next" onClick={onNext}>
          <ChevronRight size={26} />
        </button>
      )}
    </div>
  );
}
