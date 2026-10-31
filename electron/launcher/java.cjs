const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('../paths.cjs');
const { exists } = require('../store.cjs');
const { fetchJson, download, runPool } = require('./http.cjs');

// Mojang's own Java runtimes, the same ones the official launcher uses.
const RUNTIME_INDEX_URL =
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

let runtimeIndex = null;

function platformKey() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExecutable(dir) {
  // javaw has no console window on Windows.
  if (process.platform === 'win32') return path.join(dir, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(dir, 'bin', 'java');
}


/** Ensures the given runtime component (e.g. "java-runtime-delta") is installed; returns the java path. */
async function ensureJava(component, onProgress) {
  const dir = path.join(paths.javaDir(), component);
  const exe = javaExecutable(dir);
  const marker = path.join(dir, '.workbench-version');

  let entry;
  try {
    runtimeIndex ??= await fetchJson(RUNTIME_INDEX_URL);
    entry = runtimeIndex[platformKey()]?.[component]?.[0];
  } catch (err) {
    if (await exists(exe)) return exe; // offline but already installed
    throw err;
  }
  if (!entry) throw new Error(`Java runtime "${component}" isn't available for ${platformKey()}.`);

  const installed = await fsp.readFile(marker, 'utf8').catch(() => null);
  if (installed === entry.manifest.sha1 && (await exists(exe))) return exe;

  const { files } = await fetchJson(entry.manifest.url);
  const entries = Object.entries(files);
  const toDownload = entries.filter(([, f]) => f.type === 'file');

  for (const [rel, f] of entries) {
    if (f.type === 'directory') await fsp.mkdir(path.join(dir, rel), { recursive: true });
  }

  let done = 0;
  onProgress(done, toDownload.length);
  await runPool(toDownload, 16, async ([rel, f]) => {
    const dest = path.join(dir, rel);
    const raw = f.downloads.raw;
    await download(raw.url, dest, { sha1: raw.sha1, size: raw.size });
    if (f.executable && process.platform !== 'win32') await fsp.chmod(dest, 0o755);
    onProgress(++done, toDownload.length);
  });

  if (process.platform !== 'win32') {
    for (const [rel, f] of entries) {
      if (f.type === 'link') await fsp.symlink(f.target, path.join(dir, rel)).catch(() => {});
    }
  }

  await fsp.writeFile(marker, entry.manifest.sha1);
  return exe;
}

module.exports = { ensureJava };
