import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileText, FolderOpen } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { parseLog } from '../../logParse';

const MAX_LINES = 2000;

interface Props {
  profileId: string;
  running: boolean;
  onError: (message: string) => void;
}

export default function LogsTab({ profileId, running, onError }: Props) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);

  const load = useCallback(() => {
    api.profiles
      .readLog(profileId)
      .then(setText)
      .catch((err) => onError(errorMessage(err)));
  }, [profileId, onError]);

  // Poll while the game is running; load once more after it stops.
  useEffect(() => {
    load();
    if (!running) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [load, running]);

  const lines = useMemo(() => (text ? parseLog(text).slice(-MAX_LINES) : []), [text]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && followTail.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const copy = () => {
    const plain = lines.map((l) => (l.time ? `[${l.time}] [${l.level}] ${l.text}` : l.text)).join('\n');
    navigator.clipboard.writeText(plain).catch((err) => onError(errorMessage(err)));
  };

  if (text === undefined) return null;

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">{running ? 'Live output' : 'Last launch'}</span>
        <div className="toolbar-actions">
          <button className="btn btn-ghost" onClick={copy} disabled={lines.length === 0}>
            <Copy size={15} /> Copy
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => api.profiles.openFolder(profileId, 'logs').catch((err) => onError(errorMessage(err)))}
          >
            <FolderOpen size={15} /> Open logs folder
          </button>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="empty empty-compact">
          <FileText className="empty-icon" size={40} strokeWidth={1.5} />
          <h2>No logs yet</h2>
          <p>Game output appears here once you launch this profile.</p>
        </div>
      ) : (
        <div className="log-view" ref={scroller} onScroll={onScroll}>
          {lines.map((l, i) => (
            <div key={i} className={`log-line log-${l.level.toLowerCase()}`}>
              {l.time && <span className="log-time">{l.time}</span>}
              {l.level !== 'RAW' && <span className="log-level">{l.level}</span>}
              <span className="log-text">{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
