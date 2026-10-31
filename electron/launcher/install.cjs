const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const paths = require('../paths.cjs');
const { readJson, exists } = require('../store.cjs');
const { download, runPool } = require('./http.cjs');
const { isAllowed, osName } = require('./rules.cjs');

const LIBRARIES_URL = 'https://libraries.minecraft.net/';
const RESOURCES_URL = 'https://resources.download.minecraft.net/';
// Files downloaded at once, unless the launcher setting says otherwise.
const DEFAULT_CONCURRENCY = 16;


/** "group:artifact:version[:classifier][@ext]" → relative maven path. */
function mavenPath(name) {
  const [coords, ext = 'jar'] = name.split('@');
  const [group, artifact, version, classifier] = coords.split(':');
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return [...group.split('.'), artifact, version, fileName].join('/');
}

function nativeClassifier(lib) {
  return lib.natives?.[osName()]?.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
}

function planLibraries(version) {
  const libDir = paths.librariesDir();
  const classpath = [];
  const natives = [];
  const files = [];
  const seen = new Set();

  const add = (dl) => {
    const dest = path.join(libDir, dl.path);
    if (seen.has(dest)) return null;
    seen.add(dest);
    if (dl.url) files.push({ url: dl.url, dest, sha1: dl.sha1, size: dl.size });
    return dest;
  };

  for (const lib of version.libraries ?? []) {
    if (!isAllowed(lib.rules)) continue;

    let artifact = lib.downloads?.artifact;
    // Maven-style entries (used by mod loaders) have no downloads block.
    if (!artifact && !lib.downloads) {
      const rel = mavenPath(lib.name);
      artifact = { path: rel, url: (lib.url ?? LIBRARIES_URL) + rel, sha1: lib.sha1, size: lib.size };
    }
    if (artifact) {
      const dest = add(artifact);
      if (dest) classpath.push(dest);
    }

    // Pre-1.19 versions ship natives as separate classifier jars that must be extracted.
    const classifier = nativeClassifier(lib);
    const native = classifier && lib.downloads?.classifiers?.[classifier];
    if (native) {
      const dest = add(native);
      if (dest) natives.push({ jar: dest, exclude: lib.extract?.exclude ?? [] });
    }
  }
  return { classpath, natives, files };
}

async function extractNatives(natives, dir) {
  const marker = path.join(dir, '.extracted');
  if (await exists(marker)) return;
  await fsp.mkdir(dir, { recursive: true });
  for (const { jar, exclude } of natives) {
    for (const entry of new AdmZip(jar).getEntries()) {
      if (entry.isDirectory || exclude.some((prefix) => entry.entryName.startsWith(prefix))) continue;
      const dest = path.join(dir, entry.entryName);
      if (!dest.startsWith(dir + path.sep)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, entry.getData());
    }
  }
  await fsp.writeFile(marker, '');
}

async function installAssets(version, gameDir, onProgress, concurrency) {
  const { assetIndex } = version;
  const assetsDir = paths.assetsDir();
  const indexFile = path.join(assetsDir, 'indexes', `${assetIndex.id}.json`);
  await download(assetIndex.url, indexFile, { sha1: assetIndex.sha1, verify: true });

  const index = await readJson(indexFile);
  const objects = Object.entries(index.objects);
  const unique = [...new Map(objects.map(([, o]) => [o.hash, o])).values()];
  const objectPath = (hash) => path.join(assetsDir, 'objects', hash.slice(0, 2), hash);

  let done = 0;
  onProgress(done, unique.length);
  await runPool(unique, concurrency, async ({ hash, size }) => {
    await download(`${RESOURCES_URL}${hash.slice(0, 2)}/${hash}`, objectPath(hash), { sha1: hash, size });
    onProgress(++done, unique.length);
  });

  // Pre-1.7 versions read assets from a flat folder instead of the hashed object store.
  let flatDir = null;
  if (index.map_to_resources) flatDir = path.join(gameDir, 'resources');
  else if (index.virtual) flatDir = path.join(assetsDir, 'virtual', assetIndex.id);
  if (flatDir) {
    for (const [name, { hash }] of objects) {
      const dest = path.join(flatDir, name);
      if (await exists(dest)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(objectPath(hash), dest);
    }
  }
  return flatDir ?? assetsDir;
}

/** Downloads everything a version needs. onProgress({ stage, label, done, total }). */
async function installVersion(version, gameDir, onProgress, concurrency = DEFAULT_CONCURRENCY) {
  // `clientFrom` is the vanilla version whose jar gets downloaded; `jar` is the name it's
  // launched under. Forge expects a copy named after its own version id.
  const clientId = version.clientFrom ?? version.id;
  const jarId = version.jar ?? version.id;
  const vanillaJar = path.join(paths.versionsDir(), clientId, `${clientId}.jar`);
  const clientJar = path.join(paths.versionsDir(), jarId, `${jarId}.jar`);
  const libs = planLibraries(version);
  const files = [...libs.files];

  const client = version.downloads?.client;
  if (client) files.push({ url: client.url, dest: vanillaJar, sha1: client.sha1, size: client.size });

  let loggingArg = null;
  const logging = version.logging?.client;
  if (logging?.file) {
    const dest = path.join(paths.assetsDir(), 'log_configs', logging.file.id);
    files.push({ url: logging.file.url, dest, sha1: logging.file.sha1, size: logging.file.size });
    loggingArg = logging.argument.replace('${path}', dest);
  }

  let done = 0;
  const report = () => onProgress({ stage: 'files', label: 'Downloading game files', done, total: files.length });
  report();
  await runPool(files, concurrency, async (f) => {
    await download(f.url, f.dest, f);
    done++;
    report();
  });

  if (clientJar !== vanillaJar && !(await exists(clientJar))) {
    await fsp.mkdir(path.dirname(clientJar), { recursive: true });
    await fsp.copyFile(vanillaJar, clientJar);
  }

  const nativesDir = path.join(paths.nativesDir(), clientId);
  await extractNatives(libs.natives, nativesDir);

  const gameAssets = await installAssets(version, gameDir, (d, total) =>
    onProgress({ stage: 'assets', label: 'Downloading assets', done: d, total }),
    concurrency,
  );

  return { classpath: [...libs.classpath, clientJar], nativesDir, gameAssets, loggingArg };
}

module.exports = { installVersion, mavenPath };
