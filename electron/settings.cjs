const os = require('node:os');
const path = require('node:path');
const paths = require('./paths.cjs');
const { readJson, writeJson, createLock } = require('./store.cjs');

const file = () => path.join(paths.root(), 'settings.json');
const withLock = createLock();

const totalMemoryMb = () => Math.floor(os.totalmem() / 1024 / 1024);

function defaults() {
  // A quarter of system RAM, between 1 GB and 4 GB, in 512 MB steps.
  const quarter = Math.floor(totalMemoryMb() / 4 / 512) * 512;
  return { memoryMb: Math.min(4096, Math.max(1024, quarter)) };
}

async function get() {
  return { ...defaults(), ...(await readJson(file(), {})) };
}

function set(patch) {
  return withLock(async () => {
    const next = await get();
    if (patch.memoryMb !== undefined) {
      const mb = Math.round(Number(patch.memoryMb));
      if (!Number.isFinite(mb) || mb < 512 || mb > totalMemoryMb()) throw new Error('Invalid memory amount.');
      next.memoryMb = mb;
    }
    await writeJson(file(), next);
    return next;
  });
}

module.exports = { get, set, totalMemoryMb };
