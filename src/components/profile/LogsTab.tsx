import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, FileText, FolderOpen, LoaderCircle, Search, UploadCloud } from 'lucide-react';
import Modal from '../Modal';
import { api, errorMessage } from '../../api';
import { parseLog, type LogLine, type Severity } from '../../logParse';

const MAX_LINES = 2000;

type Filter = 'all' | Exclude<Severity, 'info'>;

interface Props {
  profileId: string;
  running: boolean;
  onError: (message: string) => void;
}

const plainText = (lines: LogLine[]) => lines.map((l) => (l.time ? `[${l.time}] [${l.level}] ${l.text}` : l.text)).join('\n');

/** Wraps each match of the search in a <mark>. */
function highlight(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: (string | JSX.Element)[] = [];
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return parts;
}

export default function LogsTab({ profileId, running, onError }: Props) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [uploading, setUploading] = useState(false);
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
  const counts = useMemo(
    () => ({
      warn: lines.filter((l) => l.severity === 'warn').length,
      error: lines.filter((l) => l.severity === 'error').length,
    }),
    [lines],
  );
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      lines.filter((l) => (filter === 'all' || l.severity === filter) && (!needle || l.text.toLowerCase().includes(needle))),
    [lines, filter, needle],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && followTail.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const copy = () => navigator.clipboard.writeText(plainText(lines)).catch((err) => onError(errorMessage(err)));

  if (text === undefined) return null;

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'warn', label: 'Warnings', count: counts.warn },
    { key: 'error', label: 'Errors', count: counts.error },
  ];

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">{running ? 'Live output' : 'Last launch'}</span>
        <div className="toolbar-actions">
          <button className="btn btn-ghost" onClick={copy} disabled={lines.length === 0}>
            <Copy size={15} /> Copy
          </button>
          <button className="btn btn-ghost" onClick={() => setUploading(true)} disabled={lines.length === 0}>
            <UploadCloud size={15} /> Upload
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
        <>
          <div className="log-filters">
            <label className="search-field">
              <Search size={16} />
              <input
                className="input"
                type="search"
                placeholder="Search the log"
                value={query}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="chips" role="group" aria-label="Level">
              {filters.map((f) => (
                <button key={f.key} className={`chip chip-${f.key}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                  {f.count !== undefined && <span className="chip-count">{f.count}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="log-view" ref={scroller} onScroll={onScroll}>
            {shown.length === 0 ? (
              <p className="log-none">No lines match.</p>
            ) : (
              shown.map((l, i) => (
                <div key={i} className={`log-line log-${l.severity}${l.level === 'RAW' ? ' log-raw' : ''}`}>
                  {l.time && <span className="log-time">{l.time}</span>}
                  {l.level !== 'RAW' && <span className="log-level">{l.level}</span>}
                  <span className="log-text">{highlight(l.text, needle)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {uploading && <UploadModal text={plainText(lines)} onClose={() => setUploading(false)} />}
    </>
  );
}

function UploadModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [state, setState] = useState<'confirm' | 'busy' | { url: string }>('confirm');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const upload = async () => {
    setState('busy');
    setError(null);
    try {
      setState({ url: await api.logs.upload(text) });
    } catch (err) {
      setError(errorMessage(err));
      setState('confirm');
    }
  };

  const copy = (url: string) =>
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });

  const done = typeof state === 'object' ? state : null;

  return (
    <Modal
      title={done ? 'Log uploaded' : 'Upload log'}
      onClose={state === 'busy' ? () => {} : onClose}
      footer={
        done ? (
          <>
            <button className="btn btn-secondary" onClick={() => api.logs.open(done.url)}>
              <ExternalLink size={16} /> Open
            </button>
            <button className="btn btn-primary" onClick={() => copy(done.url)}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onClose} disabled={state === 'busy'}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={upload} disabled={state === 'busy'}>
              {state === 'busy' ? <LoaderCircle size={16} className="spin" /> : <UploadCloud size={16} />} Upload
            </button>
          </>
        )
      }
    >
      {done ? (
        <>
          <p className="modal-text">Send this link to whoever is helping you. It works for anyone who has it.</p>
          <input className="input log-link" readOnly value={done.url} onFocus={(e) => e.currentTarget.select()} />
        </>
      ) : (
        <p className="modal-text">
          The log goes to mclo.gs, a free log-sharing site, and you get a link to send to whoever is helping you. Anyone with the link can
          read it. Your access token is already hidden, but the log can include your username and folder paths.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
