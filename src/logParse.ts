export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'DEBUG' | 'TRACE' | 'RAW';

export interface LogLine {
  level: LogLevel;
  time: string | null;
  text: string;
}

// Mojang's log config makes the game print log4j XML events to stdout.
const EVENT_RE =
  /<log4j:Event\b[^>]*?timestamp="(\d+)"[^>]*?level="(\w+)"[^>]*>\s*<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>(?:\s*<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>)?\s*<\/log4j:Event>/g;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function rawLines(chunk: string, out: LogLine[]) {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim()) out.push({ level: 'RAW', time: null, text: line });
  }
}

export function parseLog(text: string): LogLine[] {
  const out: LogLine[] = [];
  let last = 0;
  for (const m of text.matchAll(EVENT_RE)) {
    rawLines(text.slice(last, m.index), out);
    const [, timestamp, level, message, throwable] = m;
    const body = throwable ? `${message}\n${throwable.trimEnd()}` : message;
    out.push({ level: level as LogLevel, time: timeFmt.format(Number(timestamp)), text: body });
    last = m.index + m[0].length;
  }
  rawLines(text.slice(last), out);
  return out;
}
