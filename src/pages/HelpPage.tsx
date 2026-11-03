import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bug, ChevronDown, Lightbulb, Lock, MessageCircleQuestion, Paperclip, Plus, Send, Trash2, type LucideIcon } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Markdown from '../components/Markdown';
import Toggle from '../components/Toggle';
import { api, errorMessage } from '../api';
import type { Profile, SupportAttachments, SupportMessage, SupportTicket, SupportType } from '../types';

const TYPES: { id: SupportType; label: string; icon: LucideIcon; title: string; text: string }[] = [
  {
    id: 'bug',
    label: 'Bug',
    icon: Bug,
    title: 'e.g. Fabric profiles crash on start',
    text: 'What happened, and what did you expect? Steps to make it happen again help a lot.',
  },
  {
    id: 'suggestion',
    label: 'Suggestion',
    icon: Lightbulb,
    title: 'e.g. Sort screenshots by world',
    text: 'What would you like Workbench to do, and how would it help you?',
  },
  {
    id: 'help',
    label: 'Question',
    icon: MessageCircleQuestion,
    title: 'e.g. How do I move my worlds over?',
    text: 'What are you trying to do?',
  },
];
const TYPE = Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<SupportType, (typeof TYPES)[number]>;

// While a conversation is open, replies are checked for this often.
const OPEN_CHECK_MS = 20_000;

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const formatWhen = (iso: string) => dateTime.format(new Date(iso));

interface Props {
  profiles: Profile[] | null;
  /** Starts a bug report about this profile (from the crash dialog). */
  reportProfileId?: string;
  onTicketsChange: (tickets: SupportTicket[]) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

export default function HelpPage({ profiles, reportProfileId, onTicketsChange, onError, onSuccess }: Props) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  // null: writing a new report.
  const [openId, setOpenId] = useState<string | null>(null);

  const apply = useCallback(
    (next: SupportTicket[]) => {
      setTickets(next);
      onTicketsChange(next);
    },
    [onTicketsChange],
  );
  const replace = useCallback(
    (ticket: SupportTicket) => {
      setTickets((ts) => {
        const next = [ticket, ...(ts ?? []).filter((t) => t.id !== ticket.id)];
        onTicketsChange(next);
        return next;
      });
    },
    [onTicketsChange],
  );

  useEffect(() => {
    api.support
      .list()
      .then((list) => {
        apply(list);
        if (!reportProfileId && list.length) setOpenId(list[0].id);
        // Then look for replies that came in while Workbench was closed.
        return api.support.refresh().then(apply);
      })
      .catch((err) => onError(errorMessage(err)));
  }, [apply, onError, reportProfileId]);

  // Replies found by the background check.
  useEffect(
    () =>
      api.game.onEvent((event) => {
        if (event.type === 'support-changed') api.support.list().then(apply).catch(() => {});
      }),
    [apply],
  );

  const open = tickets?.find((t) => t.id === openId) ?? null;

  return (
    <>
      <PageHeader title="Help" subtitle="Report a bug, suggest something, or ask a question. Replies show up here." />
      <div className="help-layout">
        <aside className="help-list" aria-label="Your reports">
          <button className="btn btn-primary help-new" aria-pressed={openId === null} onClick={() => setOpenId(null)}>
            <Plus size={16} /> New report
          </button>
          {tickets?.map((t) => {
            const Icon = TYPE[t.type].icon;
            const last = t.messages.at(-1);
            return (
              <button key={t.id} className="help-item" aria-current={t.id === openId ? 'true' : undefined} onClick={() => setOpenId(t.id)}>
                <span className="help-item-icon" data-type={t.type}>
                  <Icon size={15} />
                </span>
                <span className="help-item-text">
                  <span className="help-item-title">{t.title}</span>
                  <span className="help-item-sub">
                    {t.closed ? 'Closed' : last?.from === 'staff' ? 'Workbench replied' : 'Waiting for a reply'} · {formatWhen(last?.at ?? t.createdAt)}
                  </span>
                </span>
                {t.unread > 0 && <span className="help-unread" aria-label={`${t.unread} new`} />}
              </button>
            );
          })}
        </aside>
        <section className="help-main">
          {open ? (
            <Conversation
              key={open.id}
              ticket={open}
              onChange={replace}
              onRemoved={() => {
                apply((tickets ?? []).filter((t) => t.id !== open.id));
                setOpenId(null);
              }}
              onError={onError}
            />
          ) : (
            <NewReport
              profiles={profiles ?? []}
              initialProfileId={reportProfileId}
              onSent={(ticket) => {
                replace(ticket);
                setOpenId(ticket.id);
                onSuccess('Sent. Replies will show up here.');
              }}
            />
          )}
        </section>
      </div>
    </>
  );
}

// ── Writing a report ─────────────────────────────────────────────────────────

function NewReport({ profiles, initialProfileId, onSent }: { profiles: Profile[]; initialProfileId?: string; onSent: (t: SupportTicket) => void }) {
  const [type, setType] = useState<SupportType>('bug');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [profileId, setProfileId] = useState(initialProfileId ?? '');
  const [includeLog, setIncludeLog] = useState(Boolean(initialProfileId));
  const [preview, setPreview] = useState<SupportAttachments | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aboutProfile = type !== 'suggestion';
  const sendProfile = aboutProfile && profileId ? profileId : undefined;
  const sendLog = Boolean(sendProfile) && includeLog;

  // What will be sent along, shown before it goes.
  useEffect(() => {
    let current = true;
    api.support
      .attachments({ profileId: sendProfile, includeLog: sendLog })
      .then((a) => current && setPreview(a))
      .catch(() => current && setPreview(null));
    return () => {
      current = false;
    };
  }, [sendProfile, sendLog]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSent(await api.support.create({ type, title, text, contact, profileId: sendProfile, includeLog: sendLog }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const t = TYPE[type];
  const sortedProfiles = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <form className="form help-form" onSubmit={submit}>
      <div className="segmented segmented-full help-types" role="group" aria-label="Kind of report">
        {TYPES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={type === id} onClick={() => setType(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field-label">Title</span>
        <input className="input" value={title} maxLength={90} placeholder={t.title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Details</span>
        <textarea className="input help-textarea" value={text} maxLength={1500} rows={6} placeholder={t.text} onChange={(e) => setText(e.target.value)} />
      </label>

      <div className="field-row">
        {aboutProfile && (
          <label className="field">
            <span className="field-label">Profile it’s about</span>
            <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">None</option>
              {sortedProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Contact (optional)</span>
          <input className="input" value={contact} maxLength={100} placeholder="Discord name or email" onChange={(e) => setContact(e.target.value)} />
        </label>
      </div>

      {sendProfile && (
        <div className="help-log-row">
          <div>
            <strong>Attach the profile’s last game log</strong>
            <p>Your sign-in, home folder and server addresses are taken out first.</p>
          </div>
          <Toggle checked={includeLog} onChange={setIncludeLog} label="Attach the last game log" />
        </div>
      )}

      {preview && (
        <details className="help-preview">
          <summary>
            <Paperclip size={14} /> Also sent: version and system{sendProfile ? ', profile' : ''}
            {preview.log ? ', game log' : ''}
            <ChevronDown size={14} className="help-preview-chevron" />
          </summary>
          <pre className="help-pre">{preview.details}</pre>
          {preview.log && <pre className="help-pre help-pre-log">{preview.log.text}</pre>}
          {sendLog && !preview.log && <p className="help-note">This profile hasn’t been played yet, so there’s no log to send.</p>}
        </details>
      )}

      {error && <p className="form-error">{error}</p>}
      <div className="help-actions">
        <p className="help-note">It’s posted privately for the Workbench developer. Replies show up here.</p>
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || !text.trim()}>
          <Send size={15} /> {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

// ── A conversation ───────────────────────────────────────────────────────────

function Conversation({
  ticket,
  onChange,
  onRemoved,
  onError,
}: {
  ticket: SupportTicket;
  onChange: (t: SupportTicket) => void;
  onRemoved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const t = TYPE[ticket.type];

  // Looks for replies while this is open, and marks them read.
  useEffect(() => {
    const check = () =>
      api.support
        .refresh(ticket.id)
        .then((list) => {
          const fresh = list.find((x) => x.id === ticket.id);
          if (fresh) onChange(fresh);
        })
        .catch(() => {});
    const timer = window.setInterval(check, OPEN_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [ticket.id, onChange]);
  useEffect(() => {
    if (ticket.unread > 0) api.support.markRead(ticket.id).then(onChange).catch(() => {});
  }, [ticket.id, ticket.unread, onChange]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [ticket.messages.length]);

  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      onChange(await api.support.send(ticket.id, draft));
      setDraft('');
    } catch (err) {
      onError(errorMessage(err));
      api.support.list().then((list) => {
        const fresh = list.find((x) => x.id === ticket.id);
        if (fresh) onChange(fresh);
      }).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const first: SupportMessage = { id: ticket.id, from: 'you', name: null, text: ticket.text, at: ticket.createdAt, attachments: [] };
  return (
    <div className="help-thread">
      <header className="help-thread-header">
        <span className="help-item-icon" data-type={ticket.type}>
          <t.icon size={16} />
        </span>
        <div className="help-thread-title">
          <h2>{ticket.title}</h2>
          <p>
            {t.label} · sent {formatWhen(ticket.createdAt)}
            {ticket.closed && ' · Closed'}
          </p>
        </div>
        {confirmRemove ? (
          <div className="help-confirm">
            <span>Remove from this list?</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() =>
                api.support
                  .remove(ticket.id)
                  .then(onRemoved)
                  .catch((err) => onError(errorMessage(err)))
              }
            >
              Remove
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(true)} title="Removes it from this list. It stays with the developer.">
            <Trash2 size={14} /> Remove
          </button>
        )}
      </header>

      <div className="help-messages">
        <Message message={first} />
        <p className="help-attached">
          Sent with it: {ticket.details.split('\n').join(' · ')}
          {ticket.logSent && ' · game log'}
        </p>
        {ticket.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        <div ref={end} />
      </div>

      {ticket.closed ? (
        <p className="help-closed">
          <Lock size={14} /> This conversation was closed. Start a new report if you still need help.
        </p>
      ) : (
        <div className="help-composer">
          <textarea
            className="input help-textarea"
            rows={2}
            value={draft}
            maxLength={1500}
            placeholder="Write a reply… (Enter sends, Shift+Enter for a new line)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="btn btn-primary" onClick={send} disabled={busy || !draft.trim()} aria-label="Send">
            <Send size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Message({ message }: { message: SupportMessage }) {
  const staff = message.from === 'staff';
  return (
    <div className="help-message" data-from={message.from}>
      <div className="help-bubble">
        {staff ? <Markdown text={message.text} /> : <p className="help-plain">{message.text}</p>}
        {message.attachments.map((a) => (
          <button key={a.url} className="help-file" onClick={() => api.system.openLink(a.url).catch(() => {})}>
            <Paperclip size={13} /> {a.name}
          </button>
        ))}
      </div>
      <span className="help-meta">
        {staff ? `${message.name ?? 'Workbench'} · Workbench developer` : 'You'} · {formatWhen(message.at)}
      </span>
    </div>
  );
}
