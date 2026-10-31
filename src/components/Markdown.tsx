import type { MouseEvent, ReactNode } from 'react';
import { api } from '../api';

// Enough Markdown for changelogs and Modrinth project pages: headings, lists, paragraphs,
// code blocks, **bold**, *italic*, `code`, links and images. Common HTML (img, a, br, headings)
// is turned into Markdown first and other tags are dropped. Built from React elements, never
// injected HTML. Links open in the browser; only https links and images are used.

const isWeb = (url: string) => /^https:\/\//i.test(url);

function openLink(e: MouseEvent, url: string) {
  e.preventDefault();
  api.system.openLink(url).catch(() => {});
}

function Image({ src, alt }: { src: string; alt: string }) {
  return isWeb(src) ? <img className="md-image" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" /> : null;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  if (!isWeb(href)) return <span className="md-link">{children}</span>;
  return (
    <a className="md-link" href={href} title={href} onClick={(e) => openLink(e, href)}>
      {children}
    </a>
  );
}

const URL_PART = String.raw`\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)`;
const INLINE = new RegExp(
  [
    String.raw`\[!\[([^\]]*)\]${URL_PART}\]${URL_PART}`, // linked image: 1 alt, 2 src, 3 href
    String.raw`!\[([^\]]*)\]${URL_PART}`, // image: 4 alt, 5 src
    String.raw`\[([^\]]+)\]${URL_PART}`, // link: 6 text, 7 href
    String.raw`\*\*(.+?)\*\*|__(.+?)__`, // bold: 8, 9
    '`([^`]+)`', // code: 10
    String.raw`\*(\S(?:.*?\S)?)\*|(?<![\w])_(\S(?:.*?\S)?)_(?![\w])`, // italic: 11, 12
  ].join('|'),
  'g',
);

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[2]) {
      out.push(
        <Link key={key} href={m[3]}>
          <Image src={m[2]} alt={m[1]} />
        </Link>,
      );
    } else if (m[5]) out.push(<Image key={key} src={m[5]} alt={m[4]} />);
    else if (m[7]) {
      out.push(
        <Link key={key} href={m[7]}>
          {inline(m[6], key)}
        </Link>,
      );
    } else if (m[8] ?? m[9]) out.push(<strong key={key}>{inline(m[8] ?? m[9], key)}</strong>);
    else if (m[10]) out.push(<code key={key}>{m[10]}</code>);
    else out.push(<em key={key}>{m[11] ?? m[12]}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The HTML authors mix into Markdown, as Markdown; anything else is dropped (its text stays). */
function fromHtml(text: string) {
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? '';
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, inner: string) => {
      const href = attr(tag, 'href');
      return href ? `[${inner.replace(/\s+/g, ' ').trim()}](${href})` : inner;
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attr(tag, 'src');
      return src ? `![${attr(tag, 'alt')}](${src})` : '';
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]>|<br\s*\/?>|<\/p>|<\/div>|<p\b[^>]*>|<div\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:strong|b)>/gi, '**')
    .replace(/<\/?(?:em|i)>/gi, '*')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export default function Markdown({ text }: { text: string }) {
  const lines = fromHtml(text).split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;

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
    if (code) {
      if (line.startsWith('```')) {
        blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>);
        code = null;
      } else code.push(raw);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (line.startsWith('```')) {
      flush();
      code = [];
    } else if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      // Project pages use h1–h3 as section titles; changelogs mostly use deeper ones.
      const Tag = heading[1].length <= 2 ? 'h3' : 'h4';
      blocks.push(<Tag key={blocks.length}>{inline(heading[2], `h${blocks.length}`)}</Tag>);
    } else if (item) {
      if (paragraph.length) flush();
      list.push(item[1]);
    } else if (list.length && /^\s{2,}/.test(raw)) {
      // Continuation of the previous list item.
      list[list.length - 1] += ` ${line}`;
    } else if (line.startsWith('>')) {
      flush();
      blocks.push(<blockquote key={blocks.length}>{inline(line.replace(/^>\s?/, ''), `q${blocks.length}`)}</blockquote>);
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  if (code) blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>);
  flush();
  return <div className="markdown">{blocks}</div>;
}
