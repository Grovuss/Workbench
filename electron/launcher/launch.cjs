const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const paths = require('../paths.cjs');
const { MSA_CLIENT_ID } = require('../config.cjs');
const { version: launcherVersion } = require('../../package.json');
const { getVersionJson } = require('./versions.cjs');
const { resolveVersion } = require('./loaders.cjs');
const { ensureJava } = require('./java.cjs');
const { installVersion } = require('./install.cjs');
const { isAllowed } = require('./rules.cjs');

// Versions before 1.13 use a single `minecraftArguments` string and no JVM arguments.
const LEGACY_JVM_ARGS = [
  ...(process.platform === 'darwin' ? ['-XstartOnFirstThread'] : []),
  '-Djava.library.path=${natives_directory}',
  '-cp',
  '${classpath}',
];

function collectArgs(list, features) {
  const out = [];
  for (const arg of list) {
    if (typeof arg === 'string') out.push(arg);
    else if (isAllowed(arg.rules, features)) out.push(...[].concat(arg.value));
  }
  return out;
}

const substitute = (str, vars) => str.replace(/\$\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));

/** Splits user-entered JVM arguments on whitespace, keeping "quoted values" together. */
function splitArgs(text) {
  return [...(text ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/** Whether the version has a quick play option (Minecraft 1.20+), e.g. 'is_quick_play_multiplayer'. */
const supportsQuickPlay = (version, feature) =>
  (version.arguments?.game ?? []).some((arg) => typeof arg !== 'string' && arg.rules?.some((r) => r.features?.[feature]));

function buildArgs(version, install, vars, { memoryMb, jvmArgs, resolution, fullscreen, quickPlay }) {
  const quickServer = Boolean(quickPlay?.server) && supportsQuickPlay(version, 'is_quick_play_multiplayer');
  const features = {
    has_custom_resolution: Boolean(resolution),
    is_quick_play_multiplayer: quickServer,
    is_quick_play_singleplayer: Boolean(quickPlay?.world),
  };
  const jvm = version.arguments?.jvm ? collectArgs(version.arguments.jvm, features) : LEGACY_JVM_ARGS;
  let game = version.arguments?.game
    ? collectArgs(version.arguments.game, features)
    : version.minecraftArguments.split(' ');
  if (resolution && !version.arguments?.game) {
    game = [...game, '--width', '${resolution_width}', '--height', '${resolution_height}'];
  }
  if (fullscreen) game = [...game, '--fullscreen'];
  // Before quick play, the game took the server as --server/--port.
  if (quickPlay?.server && !quickServer) {
    const [host, port = '25565'] = quickPlay.server.split(':');
    game = [...game, '--server', host, '--port', port];
  }
  return [
    `-Xmx${memoryMb}M`,
    // After -Xmx so a user-supplied -Xmx wins.
    ...splitArgs(jvmArgs),
    ...(install.loggingArg ? [install.loggingArg] : []),
    ...jvm,
    version.mainClass,
    ...game,
  ].map((arg) => substitute(arg, vars));
}

/**
 * Installs (if needed) and starts Minecraft for a profile.
 * `quickPlay` ({ server } or { world }) joins a server or opens a world straight away.
 * Returns the spawned process; output goes to <gameDir>/logs/workbench-launch.log.
 */
async function launchGame({ profile, gameDir, account, memoryMb, jvmArgs, resolution, fullscreen, downloadThreads, quickPlay, onProgress }) {
  const vanilla = await getVersionJson(profile.mcVersion);
  await fsp.mkdir(gameDir, { recursive: true });

  const component = vanilla.javaVersion?.component ?? 'jre-legacy';
  const java = await ensureJava(component, (done, total) =>
    onProgress({ stage: 'java', label: 'Downloading Java', done, total }),
  );
  const version = await resolveVersion(profile, { vanilla, java, onProgress });
  if (quickPlay?.world && !supportsQuickPlay(version, 'is_quick_play_singleplayer')) {
    throw new Error('Opening a world from the launcher needs Minecraft 1.20 or newer.');
  }
  const install = await installVersion(version, gameDir, onProgress, downloadThreads);

  const vars = {
    auth_player_name: account.name,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_session: `token:${account.accessToken}:${account.uuid}`,
    auth_xuid: '0',
    user_type: 'msa',
    user_properties: '{}',
    clientid: MSA_CLIENT_ID,
    version_name: version.id,
    version_type: version.type,
    game_directory: gameDir,
    assets_root: paths.assetsDir(),
    game_assets: install.gameAssets,
    assets_index_name: version.assetIndex.id,
    natives_directory: install.nativesDir,
    library_directory: paths.librariesDir(),
    classpath: install.classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    launcher_name: 'workbench',
    launcher_version: launcherVersion,
    resolution_width: String(resolution?.width ?? ''),
    resolution_height: String(resolution?.height ?? ''),
    quickPlayMultiplayer: quickPlay?.server ?? '',
    quickPlaySingleplayer: quickPlay?.world ?? '',
  };
  const args = buildArgs(version, install, vars, { memoryMb, jvmArgs, resolution, fullscreen, quickPlay });

  const logFile = path.join(gameDir, 'logs', 'workbench-launch.log');
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'w');
  fs.writeSync(fd, `[Workbench] Launching ${version.id} with ${java}\n`);

  // Output goes straight to a file (not a pipe) and the process is detached,
  // so the game keeps running if the launcher is closed.
  const child = spawn(java, args, { cwd: gameDir, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  child.unref();
  return { child, logFile };
}

module.exports = { launchGame };
