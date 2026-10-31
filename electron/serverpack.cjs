const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const content = require('./content.cjs');
const profiles = require('./profiles.cjs');
const settings = require('./settings.cjs');
const { download, fetchJson } = require('./launcher/http.cjs');
const { installerUrl } = require('./launcher/forge.cjs');
const { getVersionJson } = require('./launcher/versions.cjs');
const { LOADER_NAMES } = require('./launcher/loaders.cjs');

// Exports a folder that runs the profile as a dedicated server: the mods that work on servers,
// config, the loader's server launcher and start scripts. The EULA is left for the owner to accept.

const COPY_FOLDERS = ['config', 'defaultconfigs', 'kubejs'];

/** Modrinth says whether a project runs on servers; local jars say so in their own metadata. */
async function serverMods(profileId) {
  const mods = (await content.list({ profileId, kind: 'mod' })).filter((m) => m.enabled);
  const ids = [...new Set(mods.map((m) => m.projectId).filter(Boolean))];
  const projects = ids.length ? await content.modrinth(`/projects?${new URLSearchParams({ ids: JSON.stringify(ids) })}`) : [];
  const serverSide = new Map(projects.map((p) => [p.id, p.server_side]));
  const dir = content.modsDir(profileId);

  const included = [];
  const clientOnly = [];
  for (const m of mods) {
    const side = m.projectId ? serverSide.get(m.projectId) : jarEnvironment(path.join(dir, m.fileName));
    if (side === 'unsupported') clientOnly.push(m);
    else included.push(m);
  }
  return { included, clientOnly: [...new Map(clientOnly.map((m) => [m.title, m])).values()] };
}

/** 'unsupported' when a local Fabric/Quilt jar says it's client only. */
function jarEnvironment(file) {
  try {
    const zip = new AdmZip(file);
    const read = (name) => {
      const text = zip.getEntry(name)?.getData().toString('utf8');
      return text ? JSON.parse(text.replace(/^﻿/, '')) : null;
    };
    const env = read('fabric.mod.json')?.environment ?? read('quilt.mod.json')?.minecraft?.environment;
    return env === 'client' || env === 'client_only' ? 'unsupported' : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function freeFolder(parent, name) {
  const base = `${name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Minecraft'} server`;
  for (let i = 1; ; i++) {
    const folder = path.join(parent, i === 1 ? base : `${base} (${i})`);
    if (!(await fsp.access(folder).then(() => true, () => false))) return folder;
  }
}

/** Downloads the loader's server side and returns the start commands for each OS. */
async function addLauncher(profile, dest, memory) {
  const { loader, mcVersion, loaderVersion } = profile;
  const xmx = `-Xmx${memory}M`;

  if (loader === 'fabric') {
    const installers = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
    const installer = (installers.find((i) => i.stable) ?? installers[0]).version;
    const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installer)}/server/jar`;
    await download(url, path.join(dest, 'fabric-server-launch.jar'));
    const run = `java ${xmx} -jar fabric-server-launch.jar nogui`;
    return { bat: run, sh: run };
  }

  if (loader === 'quilt') {
    const installers = await fetchJson('https://meta.quiltmc.org/v3/versions/installer');
    const installer = installers[0].version;
    const url = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installer}/quilt-installer-${installer}.jar`;
    await download(url, path.join(dest, 'quilt-installer.jar'));
    const install = `java -jar quilt-installer.jar install server ${mcVersion} ${loaderVersion} --download-server --install-dir=.`;
    const run = `java ${xmx} -jar quilt-server-launch.jar nogui`;
    return {
      bat: `if not exist quilt-server-launch.jar ${install}\r\n${run}`,
      sh: `[ -f quilt-server-launch.jar ] || ${install}\n${run}`,
    };
  }

  // Forge and NeoForge: their installer sets the server up on first start.
  await download(installerUrl(loader, loaderVersion), path.join(dest, 'installer.jar'));
  await fsp.writeFile(path.join(dest, 'user_jvm_args.txt'), `${xmx}\n`);
  return {
    bat: [
      'if not exist libraries java -jar installer.jar --installServer',
      'if exist run.bat (',
      '  call run.bat nogui',
      ') else (',
      `  for %%f in (forge-*.jar) do java ${xmx} -jar "%%f" nogui`,
      ')',
    ].join('\r\n'),
    sh: [
      '[ -d libraries ] || java -jar installer.jar --installServer',
      'if [ -f run.sh ]; then',
      '  sh run.sh nogui',
      'else',
      `  java ${xmx} -jar forge-*.jar nogui`,
      'fi',
    ].join('\n'),
  };
}

function readme(profile, javaVersion, clientOnly) {
  const lines = [
    `${profile.name} server`,
    '',
    `Minecraft ${profile.mcVersion} with ${LOADER_NAMES[profile.loader]} ${profile.loaderVersion}. Made by Workbench.`,
    '',
    'To start it:',
    `1. Install Java ${javaVersion} on the server machine.`,
    '2. Run start.bat (Windows) or start.sh (Mac/Linux). The first start sets things up and stops.',
    '3. Open eula.txt, read the Minecraft EULA (https://aka.ms/MinecraftEULA) and change eula=false to eula=true if you agree.',
    '4. Start it again. Server settings are in server.properties.',
    '',
    'Players need the same modpack on their side to join.',
  ];
  if (clientOnly.length) {
    lines.push('', 'Left out because they only run in the game client:', ...clientOnly.map((m) => `  - ${m.title}`));
  }
  return `${lines.join('\n')}\n`;
}

/** Writes the server folder inside `parentDir`. Resolves to { folder, modCount, clientOnly }. */
async function exportServerPack(profileId, parentDir, onProgress) {
  const profile = await profiles.get(profileId);
  if (profile.loader === 'vanilla') throw new Error('Vanilla profiles don’t need a server pack. Use the server from minecraft.net.');
  const memory = profile.settings.memoryMb ?? (await settings.get()).memoryMb;
  const gameDir = profiles.gameDir(profileId);
  const dest = await freeFolder(parentDir, profile.name);

  onProgress({ label: 'Checking which mods run on servers', done: 0, total: 1 });
  const { included, clientOnly } = await serverMods(profileId);

  await fsp.mkdir(path.join(dest, 'mods'), { recursive: true });
  try {
    let done = 0;
    for (const m of included) {
      onProgress({ label: 'Copying mods', done: done++, total: included.length });
      await fsp.copyFile(path.join(content.modsDir(profileId), m.fileName), path.join(dest, 'mods', m.fileName));
    }
    for (const folder of COPY_FOLDERS) {
      const from = path.join(gameDir, folder);
      if (await fsp.access(from).then(() => true, () => false)) await fsp.cp(from, path.join(dest, folder), { recursive: true });
    }

    onProgress({ label: 'Downloading the server launcher', done: 0, total: 1 });
    const scripts = await addLauncher(profile, dest, memory);
    const javaVersion = (await getVersionJson(profile.mcVersion).catch(() => null))?.javaVersion?.majorVersion ?? 21;
    await fsp.writeFile(path.join(dest, 'start.bat'), `@echo off\r\ncd /d "%~dp0"\r\n${scripts.bat}\r\npause\r\n`);
    await fsp.writeFile(path.join(dest, 'start.sh'), `#!/bin/sh\ncd "$(dirname "$0")"\n${scripts.sh}\n`, { mode: 0o755 });
    await fsp.writeFile(path.join(dest, 'README.txt'), readme(profile, javaVersion, clientOnly));
  } catch (err) {
    await fsp.rm(dest, { recursive: true, force: true });
    throw err;
  }
  return { folder: dest, modCount: included.length, clientOnly: clientOnly.map((m) => m.title) };
}

module.exports = { exportServerPack };
