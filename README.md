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
- **launch.cjs**: builds JVM and game arguments and starts the game

Each profile gets its own game directory under `profiles/<id>`. The game's output goes to
`logs/workbench-launch.log` inside that folder.

## Mods, resource packs, shaders and data packs

- **electron/content.cjs**: one module for all four. Modrinth search, install and updates (newest
  compatible release; required dependencies for mods), enable/disable (renamed to `<file>.disabled`),
  drag-and-drop, and identifying hand-added files by SHA-1. Mods, resource packs and shaders live in
  the profile; data packs live in a world (`saves/<world>/datapacks`). Metadata is cached in
  `workbench-<folder>.json` next to each folder.
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
