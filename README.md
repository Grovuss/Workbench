# Workbench

A desktop Minecraft launcher and modpack manager (Electron + React).

## Development

```sh
npm install
npm run dev     # Vite + Electron with live reload
npm start       # production build, then launch
```

App data (profiles, accounts, downloaded game files) lives in `%APPDATA%\Workbench`.

## Microsoft sign-in

Signing in needs an Azure app registration that Mojang has approved for the Minecraft API.

1. In the [Azure portal](https://portal.azure.com) go to **App registrations → New registration**.
   - Supported account types: **Personal Microsoft accounts only**.
   - Redirect URI: platform **Public client/native (mobile & desktop)**, value
     `https://login.microsoftonline.com/common/oauth2/nativeclient`.
2. Copy the **Application (client) ID** into `electron/config.cjs`, or set the
   `WORKBENCH_MSA_CLIENT_ID` environment variable.
3. Request Minecraft API access for that client ID with Mojang's form:
   <https://aka.ms/mce-reviewappid>.

Until step 3 is approved, the Microsoft part of sign-in works but Minecraft rejects the app
and Workbench shows "This Azure app isn't approved for Minecraft sign-in yet."

## How launching works

`electron/launcher/` is a small launcher core:

- **versions.cjs**: Mojang's version manifest and per-version JSON
- **loaders.cjs**: Fabric/Quilt metadata, merged on top of the vanilla version JSON
- **forge.cjs**: Forge/NeoForge: runs the official installer's processors once per loader version
  (Forge 1.8+, all NeoForge). Processor output goes to `meta/loaders/<loader>/<version>/install.log`.
- **java.cjs**: downloads the matching Mojang Java runtime
- **install.cjs**: libraries, natives, client jar and assets (shared across profiles in `meta/`)
- **launch.cjs**: builds JVM and game arguments and starts the game. Joining a server or opening a
  world from the launcher uses quick play (`--quickPlayMultiplayer` / `--quickPlaySingleplayer`,
  1.20+); older versions join servers with `--server`/`--port`.

Each profile gets its own game directory under `profiles/<id>`. The game's output goes to
`logs/workbench-launch.log` inside that folder.

## Mods, resource packs, shaders and data packs

- **electron/content.cjs**: one module for all four. Modrinth search, install and updates (newest
  compatible release; required dependencies for mods), enable/disable (renamed to `<file>.disabled`),
  drag-and-drop, and identifying hand-added files by SHA-1. Mods, resource packs and shaders live in
  the profile; data packs live in a world (`saves/<world>/datapacks`). Metadata is cached in
  `workbench-<folder>.json` next to each folder. The profile's Content tab lists everything in one
  place with search, sorting and type filters; dropped files are sorted into the right folder by
  looking inside them (`.jar` → mod, `shaders/` → shader, `pack.mcmeta` → resource pack).
- **electron/packs.cjs**: imports `.workbench`, Modrinth `.mrpack` and CurseForge `.zip` files and
  exports `.workbench`.
- **electron/curseforge.cjs**: CurseForge API client. CurseForge import is disabled until a key is set,
  either as the `WORKBENCH_CURSEFORGE_KEY` environment variable or in a git-ignored
  `electron/secrets.cjs`:

  ```js
  module.exports = { CURSEFORGE_API_KEY: 'your key' };
  ```

  Files whose authors don't allow third-party downloads aren't fetched; the player gets links to
  download them from CurseForge instead.

### The `.workbench` format (format 1)

A zip containing:

- `workbench.json`: `format`, `name`, `game { minecraft, loader, loaderVersion }`,
  `settings { memoryMb, resolution }` and `mods[]`. Each mod has `fileName`, `enabled`, `sha1`, `size`
  and, for Modrinth mods, a download `url` plus `projectId`/`versionId`.
- `icon.png`: optional profile icon (PNG, JPEG, WebP or GIF despite the name).
- `overrides/`: files copied into the profile (config, options.txt, resource packs, mods that
  aren't on Modrinth, and so on).

Downloads are only allowed from Modrinth's CDN, GitHub and GitLab, and every path is checked so a
pack can't write outside its profile. Java arguments are never imported or exported, since they can
run arbitrary code.

## Servers

- **electron/servers.cjs**: reads and writes the game's `servers.dat`, so servers added in the launcher
  also show up in game. Unknown fields and hidden entries are kept; the previous file is kept as
  `servers.dat_old`.
- **electron/nbt.cjs**: a small uncompressed NBT reader/writer that keeps tag types for round trips.
- **electron/ping.cjs**: Server List Ping (with SRV lookup) for status, player count, MOTD and icon.

## Mod problems and crashes

- **electron/diagnose.cjs** reads each enabled mod jar's own metadata (`fabric.mod.json`,
  `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`, plus bundled jars) and reports
  missing dependencies, declared incompatibilities, duplicate copies, mods for another Minecraft
  version or loader, and loaders that are too old. Version checks only report a problem when a range
  can be read for certain, so unusual version schemes never cause false alarms.
- When the game exits with an error (or a loader stops it with an in-game error screen), the launch
  log and newest crash report are read for known causes: missing mods, out of memory, wrong Java,
  mixin failures and crash-report suspects. Each problem comes with fixes (disable a mod, install a
  missing one from Modrinth, open settings).

## Skins, screenshots and modpacks

- **electron/skins.cjs**: the account's skin and cape through Mojang's profile API, and a local skin
  library in `<userData>/skins`.
- **electron/screenshots.cjs**: each profile's `screenshots/` folder, with cached thumbnails served
  over `workbench://screenshot/…`.
- Modrinth modpacks install through the same `.mrpack` importer as files do (`packs.installModpack`).
