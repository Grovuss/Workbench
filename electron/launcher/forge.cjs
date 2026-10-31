const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const AdmZip = require('adm-zip');
const paths = require('../paths.cjs');
const { readJson, writeJson } = require('../store.cjs');
const { cachedJson, download, runPool, sha1 } = require('./http.cjs');
const { mavenPath } = require('./install.cjs');

// Forge and NeoForge ship an installer jar instead of a ready-made launcher profile.
// Installing means: extract its bundled libraries, download the rest, then run its
// "processors" (small Java tools that deobfuscate and patch the Minecraft jar).

const FORGE_MAVEN = 'https://maven.minecraftforge.net/';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/';
const FORGE_METADATA = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';

const LABELS = { forge: 'Forge', neoforge: 'NeoForge' };

// Forge builds before 1.8 use a library format we don't support.
const OLDEST_FORGE_MINOR = 8;

const exists = (p) => fsp.access(p).then(() => true, () => false);

// ---------- Version lists ----------

/** NeoForge "21.1.77" → "1.21.1", "21.0.5" → "1.21", year-based "26.3.0.100" → "26.3", "26.1.2.5" → "26.1.2". */
function neoForgeGameVersion(version) {
  const parts = version.split('-')[0].split('.');
  const [a, b, c] = parts;
  if (parts.length === 4) return c === '0' ? `${a}.${b}` : `${a}.${b}.${c}`;
  if (parts.length === 3 && a !== '0') return b === '0' ? `1.${a}` : `1.${a}.${b}`;
  return null;
}

async function neoForgeByGame() {
  const { versions } = await cachedJson(NEOFORGE_VERSIONS);
  const byGame = new Map();
  for (const v of versions) {
    const mc = neoForgeGameVersion(v);
    if (!mc) continue;
    if (!byGame.has(mc)) byGame.set(mc, []);
    byGame.get(mc).push(v);
  }
  return byGame;
}

function forgeSupportsGame(mc) {
  if (!mc.startsWith('1.')) return true; // year-based versions ("26.1")
  return Number(mc.split('.')[1]) >= OLDEST_FORGE_MINOR;
}

async function supportedGameVersions(loader) {
  if (loader === 'neoforge') return [...(await neoForgeByGame()).keys()];
  return Object.keys(await cachedJson(FORGE_METADATA)).filter(forgeSupportsGame);
}

/** Newest first. Forge versions are full maven versions like "1.20.1-47.3.0". */
async function loaderVersions(loader, mcVersion) {
  if (loader === 'neoforge') {
    const list = (await neoForgeByGame()).get(mcVersion) ?? [];
    return [...list].reverse().map((version) => ({ version, stable: !/beta|alpha/i.test(version) }));
  }
  const [metadata, { promos }] = await Promise.all([cachedJson(FORGE_METADATA), cachedJson(FORGE_PROMOS)]);
  const recommended = promos[`${mcVersion}-recommended`];
  const isRecommended = (v) => recommended && (v === `${mcVersion}-${recommended}` || v.startsWith(`${mcVersion}-${recommended}-`));
  return [...(metadata[mcVersion] ?? [])]
    .reverse()
    .map((version) => ({ version, stable: true, recommended: Boolean(isRecommended(version)) }));
}

function installerUrl(loader, version) {
  return loader === 'neoforge'
    ? `${NEOFORGE_MAVEN}net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
    : `${FORGE_MAVEN}net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
}

// ---------- Install ----------

const libPath = (coords) => path.join(paths.librariesDir(), mavenPath(coords));

/** Copies the installer's bundled maven/ folder into our libraries. */
async function extractBundledLibraries(zip) {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('maven/')) continue;
    const dest = path.join(paths.librariesDir(), entry.entryName.slice('maven/'.length));
    if (await exists(dest)) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, entry.getData());
  }
}

/** Pre-1.13 installers embed the launcher profile ("versionInfo") and a universal jar. */
async function installLegacy(zip, profile) {
  const { install, versionInfo } = profile;
  const dest = libPath(install.path);
  if (!(await exists(dest))) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, zip.readFile(install.filePath));
  }
  versionInfo.libraries = versionInfo.libraries.map((lib) => {
    // The Forge jar itself came out of the installer; there's nothing to download.
    if (lib.name === install.path) return { name: lib.name, downloads: { artifact: { path: mavenPath(lib.name), url: '' } } };
    if (lib.url) return { ...lib, url: lib.url.replace(/^https?:\/\/files\.minecraftforge\.net\/maven\//, FORGE_MAVEN) };
    return lib;
  });
  return versionInfo;
}

function javaConsoleExe(java) {
  // Processors print progress to stdout; java.exe (not javaw) gives us that output.
  return java.replace(/javaw\.exe$/i, 'java.exe');
}

function runJava(java, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaConsoleExe(java), args, { windowsHide: true });
    const tail = [];
    const onData = (chunk) => {
      log.write(chunk);
      tail.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
      tail.splice(0, Math.max(0, tail.length - 15));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error(`exit code ${code}`), { tail }))));
  });
}

async function outputsMatch(outputs) {
  for (const [file, hash] of outputs) {
    const data = await fsp.readFile(file).catch(() => null);
    if (!data || sha1(data) !== hash) return false;
  }
  return true;
}

async function installModern({ zip, profile, installerPath, dir, vanilla, java, label, onProgress }) {
  await extractBundledLibraries(zip);
  const version = JSON.parse(zip.readAsText(profile.json.replace(/^\//, '')));

  // Libraries the processors need. (The game's own libraries download at launch.)
  const files = [];
  const seen = new Set();
  for (const lib of profile.libraries ?? []) {
    const artifact = lib.downloads?.artifact;
    if (!artifact?.url) continue;
    const dest = path.join(paths.librariesDir(), artifact.path);
    if (seen.has(dest)) continue;
    seen.add(dest);
    files.push({ url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size });
  }
  let done = 0;
  const reportFiles = () => onProgress({ stage: 'loader', label: `Downloading ${label} libraries`, done, total: files.length });
  reportFiles();
  await runPool(files, 16, async (f) => {
    await download(f.url, f.dest, f);
    done++;
    reportFiles();
  });

  // Processors patch the vanilla jar, so it has to be on disk first.
  const minecraftJar = path.join(paths.versionsDir(), vanilla.id, `${vanilla.id}.jar`);
  const client = vanilla.downloads.client;
  await download(client.url, minecraftJar, { sha1: client.sha1, size: client.size });

  const dataDir = path.join(dir, 'data');
  const vars = {
    SIDE: 'client',
    MINECRAFT_JAR: minecraftJar,
    MINECRAFT_VERSION: vanilla.id,
    ROOT: paths.meta(),
    INSTALLER: installerPath,
    LIBRARY_DIR: paths.librariesDir(),
  };
  // Data values: [maven coords] → library path, 'literal' → text, /path → file inside the installer.
  for (const [key, entry] of Object.entries(profile.data ?? {})) {
    const value = entry.client;
    if (value.startsWith('[') && value.endsWith(']')) {
      vars[key] = libPath(value.slice(1, -1));
    } else if (value.startsWith("'") && value.endsWith("'")) {
      vars[key] = value.slice(1, -1);
    } else if (value.startsWith('/')) {
      const out = path.join(dataDir, value.slice(1));
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, zip.readFile(value.slice(1)));
      vars[key] = out;
    } else {
      vars[key] = value;
    }
  }
  const resolveArg = (arg) =>
    arg.startsWith('[') && arg.endsWith(']')
      ? libPath(arg.slice(1, -1))
      : arg.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));

  const processors = (profile.processors ?? []).filter((p) => !p.sides || p.sides.includes('client'));
  const logFile = path.join(dir, 'install.log');
  const log = (await fsp.open(logFile, 'w')).createWriteStream();
  try {
    for (const [i, proc] of processors.entries()) {
      onProgress({ stage: 'loader', label: `Installing ${label}`, done: i, total: processors.length });
      const outputs = Object.entries(proc.outputs ?? {}).map(([file, hash]) => [resolveArg(file), resolveArg(hash)]);
      if (outputs.length && (await outputsMatch(outputs))) continue;

      const jar = libPath(proc.jar);
      const manifest = new AdmZip(jar).readAsText('META-INF/MANIFEST.MF');
      const mainClass = manifest.match(/^Main-Class:\s*(\S+)/m)?.[1];
      if (!mainClass) throw new Error(`${label} installer step ${proc.jar} has no main class.`);
      const classpath = [jar, ...(proc.classpath ?? []).map(libPath)].join(path.delimiter);

      log.write(`\n=== ${proc.jar} ${proc.args.join(' ')}\n`);
      try {
        await runJava(java, ['-cp', classpath, mainClass, ...proc.args.map(resolveArg)], log);
      } catch (err) {
        const detail = err.tail?.at(-1) ?? err.message;
        throw new Error(`${label} install failed: ${detail}. Full output is in ${logFile}`);
      }
      if (outputs.length && !(await outputsMatch(outputs))) {
        throw new Error(`${label} install produced unexpected files. Full output is in ${logFile}`);
      }
    }
  } finally {
    log.end();
  }
  onProgress({ stage: 'loader', label: `Installing ${label}`, done: processors.length, total: processors.length });
  await fsp.rm(dataDir, { recursive: true, force: true });
  return version;
}

/**
 * Installs a Forge/NeoForge version once (shared by every profile using it) and
 * returns its launcher version JSON, which inherits from the vanilla version.
 */
async function installForge({ loader, loaderVersion, vanilla, java, onProgress }) {
  const dir = path.join(paths.meta(), 'loaders', loader, loaderVersion);
  const versionFile = path.join(dir, 'version.json');
  const marker = path.join(dir, '.installed');
  if (await exists(marker)) return readJson(versionFile);

  const label = LABELS[loader];
  onProgress({ stage: 'loader', label: `Downloading ${label} installer`, done: 0, total: 1 });
  const installerPath = path.join(dir, 'installer.jar');
  await download(installerUrl(loader, loaderVersion), installerPath);

  const zip = new AdmZip(installerPath);
  const profile = JSON.parse(zip.readAsText('install_profile.json'));
  const version = profile.versionInfo
    ? await installLegacy(zip, profile)
    : await installModern({ zip, profile, installerPath, dir, vanilla, java, label, onProgress });

  await writeJson(versionFile, version);
  await fsp.writeFile(marker, '');
  return version;
}

module.exports = { supportedGameVersions, loaderVersions, installForge };
