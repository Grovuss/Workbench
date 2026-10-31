export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'DEBUG' | 'TRACE' | 'RAW';

export type Severity = 'info' | 'warn' | 'error';

export interface LogLine {
  level: LogLevel;
  /** For plain lines too, read from the text or the line before it. */
  severity: Severity;
  time: string | null;
  text: string;
}

// Mojang's log config makes the game print log4j XML events to stdout.
const EVENT_RE =
  /<log4j:Event\b[^>]*?timestamp="(\d+)"[^>]*?level="(\w+)"[^>]*>\s*<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>(?:\s*<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>)?\s*<\/log4j:Event>/g;

// "[12:00:00] [Render thread/WARN]: ..." and similar from loaders that print plain text.
const RAW_LEVEL_RE = /\[(?:[^\]]*\/)?(WARN|WARNING|ERROR|FATAL|SEVERE)\]/;
// Stack trace lines carry on from the line above.
const CONTINUATION_RE = /^(\s+at |\s*Caused by:|\s*\.\.\. \d+ more|\s*Suppressed:)/;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function severityOf(level: string): Severity {
  if (level === 'WARN' || level === 'WARNING') return 'warn';
  if (level === 'ERROR' || level === 'FATAL' || level === 'SEVERE') return 'error';
  return 'info';
}

function rawLines(chunk: string, out: LogLine[]) {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = RAW_LEVEL_RE.exec(line);
    const severity = m
      ? severityOf(m[1])
      : CONTINUATION_RE.test(line) && out.length
        ? out[out.length - 1].severity
        : 'info';
    out.push({ level: 'RAW', severity, time: null, text: line });
  }
}

export function parseLog(text: string): LogLine[] {
  const out: LogLine[] = [];
  let last = 0;
  for (const m of text.matchAll(EVENT_RE)) {
    rawLines(text.slice(last, m.index), out);
    const [, timestamp, level, message, throwable] = m;
    const body = throwable ? `${message}\n${throwable.trimEnd()}` : message;
    out.push({ level: level as LogLevel, severity: severityOf(level), time: timeFmt.format(Number(timestamp)), text: body });
    last = m.index + m[0].length;
  }
  rawLines(text.slice(last), out);
  return out;
}
