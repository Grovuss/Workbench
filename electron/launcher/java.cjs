const fsp = require('node:fs/promises');
const path = require('node:path');
const paths = require('../paths.cjs');
const { exists } = require('../store.cjs');
const { fetchJson, download, runPool } = require('./http.cjs');

// Mojang's own Java runtimes, the same ones the official launcher uses.
const RUNTIME_INDEX_URL =
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

let runtimeIndex = null;

/** Mojang's name for this computer. `intel` asks for the Intel build on an Apple Silicon Mac (it runs under Rosetta). */
function platformKey(intel = false) {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' && !intel ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

/** Rosetta lets an Apple Silicon Mac run Intel programs; it's installed on first need, or by hand. */
async function checkRosetta() {
  if (await exists('/Library/Apple/usr/share/rosetta/rosetta')) return;
  throw new Error(
    'This version of Minecraft needs Rosetta on Apple Silicon Macs. Install it by running "softwareupdate --install-rosetta" in Terminal, then try again.',
  );
}

function javaExecutable(dir) {
  // javaw has no console window on Windows.
  if (process.platform === 'win32') return path.join(dir, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(dir, 'bin', 'java');
}


/**
 * Ensures the given runtime component (e.g. "java-runtime-delta") is installed; returns the java path.
 * `intel`: on an Apple Silicon Mac, use the Intel build, for versions whose libraries have no Apple Silicon support.
 */
async function ensureJava(component, onProgress, { intel = false } = {}) {
  let useIntel = appleSilicon && intel;
  let entry;
  try {
    runtimeIndex ??= await fetchJson(RUNTIME_INDEX_URL);
    entry = runtimeIndex[platformKey(useIntel)]?.[component]?.[0];
    // Older runtimes only come as Intel builds for Mac.
    if (!entry && appleSilicon && !useIntel) {
      entry = runtimeIndex[platformKey(true)]?.[component]?.[0];
      useIntel = Boolean(entry);
    }
  } catch (err) {
    const exe = javaExecutable(path.join(paths.javaDir(), useIntel ? `${component}-intel` : component));
    if (await exists(exe)) return exe; // offline but already installed
    throw err;
  }
  if (!entry) throw new Error(`Java runtime "${component}" isn't available for ${platformKey(useIntel)}.`);
  if (useIntel) await checkRosetta();

  // Intel and Apple Silicon builds of the same runtime live side by side.
  const dir = path.join(paths.javaDir(), useIntel ? `${component}-intel` : component);
  const exe = javaExecutable(dir);
  const marker = path.join(dir, '.workbench-version');

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
