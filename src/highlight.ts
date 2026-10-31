// Just enough syntax colouring for mod config files: keys, strings, numbers, booleans and comments.

export type TokenKind = 'key' | 'string' | 'number' | 'bool' | 'comment' | 'section';
export type Token = { kind: TokenKind | null; text: string };

type Language = 'json' | 'toml' | 'yaml' | 'properties';

export function languageOf(path: string): Language {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'json' || ext === 'json5' || ext === 'jsonc' || ext === 'mcmeta') return 'json';
  if (ext === 'toml') return 'toml';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  // .properties, .cfg, .ini, .txt (options.txt is key:value)
  return 'properties';
}

const JSON_RULES: [TokenKind | null, RegExp][] = [
  ['comment', /\/\/.*|\/\*.*?(\*\/|$)/y],
  ['key', /"(?:[^"\\]|\\.)*"(?=\s*:)|[A-Za-z_$][\w$]*(?=\s*:)/y],
  ['string', /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/y],
  ['number', /-?(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y],
  ['bool', /\b(?:true|false|null)\b/y],
];

const VALUE_RULES: [TokenKind | null, RegExp][] = [
  ['string', /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/y],
  ['number', /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
  ['bool', /\b(?:true|false|null)\b/y],
];

function scan(text: string, rules: [TokenKind | null, RegExp][], out: Token[]) {
  let plain = '';
  let i = 0;
  outer: while (i < text.length) {
    // Only start a token at a word boundary, so "abc123" isn't half number.
    const boundary = i === 0 || !/\w/.test(text[i - 1]);
    for (const [kind, re] of rules) {
      if (!boundary && (kind === 'number' || kind === 'bool')) continue;
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0]) {
        if (plain) out.push({ kind: null, text: plain });
        plain = '';
        out.push({ kind, text: m[0] });
        i += m[0].length;
        continue outer;
      }
    }
    plain += text[i++];
  }
  if (plain) out.push({ kind: null, text: plain });
}

/** A value, with a trailing "# comment" split off where the format allows one. */
function value(text: string, hashComments: boolean, out: Token[]) {
  if (hashComments) {
    // Outside quotes only.
    let quote: string | null = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
        scan(text.slice(0, i), VALUE_RULES, out);
        out.push({ kind: 'comment', text: text.slice(i) });
        return;
      }
    }
  }
  scan(text, VALUE_RULES, out);
}

function keyValueLine(line: string, lang: Exclude<Language, 'json'>, out: Token[]) {
  const trimmed = line.trimStart();
  const indent = line.slice(0, line.length - trimmed.length);
  if (indent) out.push({ kind: null, text: indent });
  if (!trimmed) return;
  if (/^(#|;|\/\/|!)/.test(trimmed) && !(lang === 'yaml' && trimmed.startsWith('!'))) {
    out.push({ kind: 'comment', text: trimmed });
    return;
  }
  if ((lang === 'toml' || lang === 'properties') && /^\[.*\]\s*$/.test(trimmed)) {
    out.push({ kind: 'section', text: trimmed });
    return;
  }

  let sep: number;
  if (lang === 'yaml') {
    const m = /^(- )?([^:#]+?)(:)(\s|$)/.exec(trimmed);
    sep = m ? (m[1]?.length ?? 0) + m[2].length : -1;
    if (m?.[1]) {
      out.push({ kind: null, text: m[1] });
      out.push({ kind: 'key', text: m[2] });
      out.push({ kind: null, text: ':' });
      value(trimmed.slice(sep + 1), true, out);
      return;
    }
  } else {
    // "B:enabled=true" in old Forge configs: the key runs to "=". options.txt uses "key:value".
    const eq = trimmed.indexOf('=');
    sep = eq !== -1 ? eq : lang === 'properties' ? trimmed.indexOf(':') : -1;
  }
  if (sep <= 0) {
    value(trimmed, lang !== 'properties', out);
    return;
  }
  out.push({ kind: 'key', text: trimmed.slice(0, sep) });
  out.push({ kind: null, text: trimmed[sep] });
  value(trimmed.slice(sep + 1), lang !== 'properties', out);
}

/** Tokens for each line of the file. */
export function highlight(text: string, path: string): Token[][] {
  const lang = languageOf(path);
  return text.split('\n').map((line) => {
    const out: Token[] = [];
    if (lang === 'json') scan(line, JSON_RULES, out);
    else keyValueLine(line, lang, out);
    return out;
  });
}
