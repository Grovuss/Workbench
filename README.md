# Workbench

A Minecraft launcher for people who play with mods. Built with Electron and React.

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

## Running it

```sh
npm install
npm run dev     # dev mode with live reload
npm start       # build and run
```

Profiles, accounts and game files are stored in `%APPDATA%\Workbench`.

## Setup

### Microsoft sign-in

Signing in needs an Azure app that Mojang has approved for the Minecraft API.

1. Register an app in the [Azure portal](https://portal.azure.com) (App registrations → New registration).
   Choose "Personal Microsoft accounts only" and add a Public client/native redirect URI of
   `https://login.microsoftonline.com/common/oauth2/nativeclient`.
2. Put the client ID in `electron/config.cjs` or the `WORKBENCH_MSA_CLIENT_ID` environment variable.
3. Apply for Minecraft API access at <https://aka.ms/mce-reviewappid>.

Until Mojang approves it, sign-in will fail with "This Azure app isn't approved for Minecraft sign-in yet."

### CurseForge

CurseForge pack import needs an API key. Set `WORKBENCH_CURSEFORGE_KEY`, or create
`electron/secrets.cjs` (it's git-ignored):

```js
module.exports = { CURSEFORGE_API_KEY: 'your key' };
```

Some CurseForge authors don't allow third-party downloads. For those mods the launcher links you to
the CurseForge page instead.

## Project layout

- `electron/` is the main process: profiles, accounts, content, packs, servers, skins and crash checks
- `electron/launcher/` downloads Minecraft, Java and mod loaders and starts the game
- `src/` is the React UI

Each profile lives in `profiles/<id>`, and the last launch's output is in `logs/workbench-launch.log`
inside it. Shared game files (libraries, assets, Java) go in `meta/`.

## The .workbench format

A zip with:

- `workbench.json`: the pack name, Minecraft version, loader, settings and mod list. Modrinth mods are
  saved as download links instead of files.
- `icon.png`: optional profile icon
- `overrides/`: anything else copied into the profile, like configs, options.txt and mods that
  aren't on Modrinth

Packs can only download from Modrinth, GitHub and GitLab, and can't write outside their profile.
Java arguments are never imported or exported.
