const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { version } = require('../../package.json');

const USER_AGENT = `Workbench/${version}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      // Client errors (other than rate limits) won't fix themselves.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500 * 2 ** i);
  }
  throw lastErr;
}

async function fetchJson(url) {
  return (await fetchWithRetry(url)).json();
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function isPresent(dest, { sha1: expected, size, verify }) {
  let stat;
  try {
    stat = await fsp.stat(dest);
  } catch {
    return false;
  }
  if (size != null && stat.size !== size) return false;
  // Hashing every file on every launch is slow; only do it when asked (small metadata files).
  if (verify && expected) return sha1(await fsp.readFile(dest)) === expected;
  return true;
}

/** Downloads url to dest unless it's already there. Returns true if a download happened. */
async function download(url, dest, opts = {}) {
  if (await isPresent(dest, opts)) return false;
  let lastErr;
  for (let i = 0; i < 2; i++) {
    const buf = Buffer.from(await (await fetchWithRetry(url)).arrayBuffer());
    if (opts.sha1 && sha1(buf) !== opts.sha1) {
      lastErr = new Error(`Checksum mismatch for ${path.basename(dest)}`);
      continue;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, dest);
    return true;
  }
  throw lastErr;
}

/** Runs worker over items with at most `limit` in flight; stops picking new work after a failure. */
async function runPool(items, limit, worker) {
  let next = 0;
  let failed = false;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(lanes);
}

module.exports = { fetchJson, download, runPool };
