const path = require('node:path');
const { randomUUID } = require('node:crypto');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');

// Saved groups of Modrinth projects that can be added to any profile. Sets store projects, not
// versions, so each profile gets the newest version that works on it.

const file = () => path.join(paths.root(), 'modsets.json');
const withLock = createLock();

const KINDS = new Set(['mod', 'resourcepack', 'shader']);
const MAX_ENTRIES = 500;

const load = () => readJson(file(), []);

function cleanName(name) {
  const clean = String(name ?? '').trim().slice(0, 48);
  if (!clean) throw new Error('Give the set a name.');
  return clean;
}

/** Keeps well-formed entries: [{ projectId, kind, title, iconUrl }], one per project. */
function cleanEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Invalid mod set.');
  const seen = new Set();
  const clean = [];
  for (const e of entries) {
    const projectId = String(e?.projectId ?? '');
    if (!/^[A-Za-z0-9]{1,32}$/.test(projectId) || seen.has(projectId) || !KINDS.has(e?.kind)) continue;
    seen.add(projectId);
    const iconUrl = typeof e.iconUrl === 'string' && e.iconUrl.startsWith('https://') ? e.iconUrl : null;
    clean.push({ projectId, kind: e.kind, title: String(e.title ?? projectId).slice(0, 100), iconUrl });
    if (clean.length === MAX_ENTRIES) break;
  }
  if (!clean.length) throw new Error('Pick at least one mod for the set.');
  return clean;
}

function create(name, entries) {
  const set = { id: randomUUID(), name: cleanName(name), entries: cleanEntries(entries), createdAt: new Date().toISOString() };
  return withLock(async () => {
    const all = await load();
    all.push(set);
    await writeJson(file(), all);
    return all;
  });
}

/** Changes a set's name and/or entries. */
function update(id, patch) {
  return withLock(async () => {
    const all = await load();
    const set = all.find((s) => s.id === id);
    if (!set) throw new Error('That mod set no longer exists.');
    if ('name' in patch) set.name = cleanName(patch.name);
    if ('entries' in patch) set.entries = cleanEntries(patch.entries);
    await writeJson(file(), all);
    return all;
  });
}

function remove(id) {
  return withLock(async () => {
    const all = (await load()).filter((s) => s.id !== id);
    await writeJson(file(), all);
    return all;
  });
}

module.exports = { list: load, create, update, remove };
