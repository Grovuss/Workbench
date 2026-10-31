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
- **java.cjs**: downloads the matching Mojang Java runtime
- **install.cjs**: libraries, natives, client jar and assets (shared across profiles in `meta/`)
- **launch.cjs**: builds JVM and game arguments and starts the game

Each profile gets its own game directory under `profiles/<id>`. The game's output goes to
`logs/workbench-launch.log` inside that folder.
