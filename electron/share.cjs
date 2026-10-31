const zlib = require('node:zlib');
const content = require('./content.cjs');
const profiles = require('./profiles.cjs');

// Share codes: a profile's Minecraft version, loader and exact Modrinth versions of its mods,
// resource packs and shaders, packed into text that can be pasted anywhere. No server involved,
// so files that aren't on Modrinth (and config) can't come along; .workbench files carry those.
//
//   WB1.<base64url of deflated JSON>
//   { n: name, v: minecraft, l: loader, lv: loader version, c: [[kind, versionId, enabled], …] }

const PREFIX = 'WB1.';
const KINDS = ['mod', 'resourcepack', 'shader'];
const MAX_CODE_LENGTH = 100_000;
const MAX_ENTRIES = 2000;

/** { code, included, skipped }: skipped are titles of files that aren't on Modrinth. */
async function create(profileId) {
  const profile = await profiles.get(profileId);
  const entries = [];
  const skipped = [];
  for (const [k, kind] of KINDS.entries()) {
    const items = await content.list({ profileId, kind }).catch(() => []);
    for (const item of items) {
      if (item.versionId) entries.push([k, item.versionId, item.enabled ? 1 : 0]);
      else skipped.push(item.title);
    }
  }
  const payload = { n: profile.name, v: profile.mcVersion, l: profile.loader, lv: profile.loaderVersion, c: entries };
  const code = PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload)), { level: 9 }).toString('base64url');
  return { code, included: entries.length, skipped };
}

function parse(code) {
  const text = String(code ?? '').replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) throw new Error('That isn’t a Workbench share code.');
  if (text.length > MAX_CODE_LENGTH) throw new Error('That share code is too long.');
  let payload;
  try {
    payload = JSON.parse(zlib.inflateRawSync(Buffer.from(text.slice(PREFIX.length), 'base64url'), { maxOutputLength: 1_000_000 }).toString('utf8'));
  } catch {
    throw new Error('That share code is incomplete or damaged. Try copying it again.');
  }
  const entries = Array.isArray(payload?.c) ? payload.c : [];
  if (typeof payload?.v !== 'string' || typeof payload?.l !== 'string' || entries.length > MAX_ENTRIES) {
    throw new Error('That share code is damaged.');
  }
  const content = entries
    .filter((e) => Array.isArray(e) && KINDS[e[0]] && typeof e[1] === 'string' && /^[A-Za-z0-9]{1,32}$/.test(e[1]))
    .map(([k, versionId, enabled]) => ({ kind: KINDS[k], versionId, enabled: enabled !== 0 }));
  return {
    name: String(payload.n ?? '').slice(0, 48),
    mcVersion: payload.v,
    loader: payload.l,
    loaderVersion: typeof payload.lv === 'string' ? payload.lv : null,
    content,
  };
}

/** What a code contains, to show before importing. */
function preview(code) {
  const { name, mcVersion, loader, loaderVersion, content: items } = parse(code);
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, items.filter((i) => i.kind === kind).length]));
  return { name, mcVersion, loader, loaderVersion, counts };
}

/** Makes a profile from a code. Resolves to { profile, failed }: how many files couldn't be downloaded. */
async function importCode(code, onProgress) {
  const { name, mcVersion, loader, loaderVersion, content: items } = parse(code);
  const profile = await profiles.create({ name, mcVersion, loader, loaderVersion });
  try {
    let failed = 0;
    let done = 0;
    for (const kind of KINDS) {
      const entries = items.filter((i) => i.kind === kind);
      if (!entries.length) continue;
      onProgress({ label: `Downloading ${kind === 'mod' ? 'mods' : kind === 'shader' ? 'shaders' : 'resource packs'}`, done, total: items.length });
      const result = await content.installVersions({ profileId: profile.id, kind }, entries);
      failed += result.failed.length;
      done += entries.length;
      onProgress({ label: 'Downloading', done, total: items.length });
    }
    return { profile: await profiles.get(profile.id), failed };
  } catch (err) {
    await profiles.remove(profile.id).catch(() => {});
    throw err;
  }
}

module.exports = { create, preview, importCode };
