import type { ReactNode } from 'react';

// Just enough Markdown for changelogs: headings, lists, paragraphs, **bold**, *italic*,
// `code` and links (shown as text). Built from React elements, never injected HTML.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\([^)]*\)|\*(\S(?:.*?\S)?)\*|_(\S(?:.*?\S)?)_/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[1] ?? m[2]) out.push(<strong key={key}>{m[1] ?? m[2]}</strong>);
    else if (m[3]) out.push(<code key={key}>{m[3]}</code>);
    else if (m[4]) out.push(<span key={key} className="md-link">{m[4]}</span>);
    else out.push(<em key={key}>{m[5] ?? m[6]}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  // HTML tags some authors use are dropped; their text stays.
  const lines = text.replace(/<[^>]+>/g, '').split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const key = blocks.length;
    if (list.length) {
      blocks.push(
        <ul key={key}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (paragraph.length) {
      blocks.push(<p key={`${key}p`}>{inline(paragraph.join(' '), `${key}p`)}</p>);
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (!line || /^(-{3,}|\*{3,})$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      blocks.push(<h4 key={blocks.length}>{inline(heading[1], `h${blocks.length}`)}</h4>);
    } else if (item) {
      if (paragraph.length) flush();
      list.push(item[1]);
    } else if (list.length && /^\s{2,}/.test(raw)) {
      // Continuation of the previous list item.
      list[list.length - 1] += ` ${line}`;
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}
