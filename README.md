# Workbench

A Minecraft launcher for people who play with mods.

## Features

- Profiles for vanilla, Fabric, Quilt, Forge and NeoForge, each with its own folder, memory and Java settings
- Browse and install mods, modpacks, resource packs, shaders and data packs from Modrinth
- Pick which version of a mod you want, see changelogs, and update everything in one click
- Spots mod problems before you launch (missing dependencies, wrong loader, wrong Minecraft version, duplicates) and offers to fix them
- Explains crashes in plain English when the game goes down
- Servers and worlds, with join-from-launcher on 1.20+
- Skins and capes, plus a library of saved skins
- Screenshot gallery for every profile
- Import `.mrpack`, CurseForge `.zip` and `.workbench` packs, and export your own profiles as `.workbench`
- Playtime tracking, custom icons, duplicating profiles, light and dark themes

## Install

Download `Workbench-Setup-<version>.exe` from the [latest release](https://github.com/Grovuss/Workbench/releases/latest) and run it. Workbench updates itself after that: new versions download in the background and install the next time you restart it.

The installer isn't code-signed yet, so Windows SmartScreen may say it's from an unknown publisher. Choose **More info → Run anyway**.

## Development

```sh
npm install
npm run dev     # the app, with hot reload
npm run dist    # builds the installer into release/ without publishing
```

## Releasing

1. Bump `version` in `package.json` and commit.
2. Tag it and push the tag: `git tag v0.4.0 && git push origin v0.4.0`

The Release workflow builds the installer and publishes it as a GitHub Release, which installed copies pick up as an update. Add a `WORKBENCH_CURSEFORGE_KEY` repository secret to include CurseForge support in release builds.
