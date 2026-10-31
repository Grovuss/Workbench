// Optional git-ignored overrides for values that shouldn't live in a public repo.
let secrets = {};
try {
  secrets = require('./secrets.cjs');
} catch {}

// Azure app registration (public client) used for Microsoft sign-in.
// Client IDs are not secrets. Mojang must approve it for the Minecraft API: https://aka.ms/mce-reviewappid
const MSA_CLIENT_ID = process.env.WORKBENCH_MSA_CLIENT_ID || '8d61a8f9-4212-4bef-9692-95315345180f';

// Until the Azure app is approved for Minecraft, unpackaged dev builds get an
// offline account with this name (singleplayer and offline-mode servers only).
// Set to '' to disable.
const DEV_OFFLINE_NAME = 'Grovus';

// CurseForge API key; CurseForge pack import stays disabled without one.
// Put it in electron/secrets.cjs as `module.exports = { CURSEFORGE_API_KEY: '…' }`.
const CURSEFORGE_API_KEY = process.env.WORKBENCH_CURSEFORGE_KEY || secrets.CURSEFORGE_API_KEY || '';

// Discord application id for Rich Presence (discord.com/developers/applications). The app's
// name and its "logo" art asset are what Discord shows. Not a secret.
const DISCORD_CLIENT_ID = process.env.WORKBENCH_DISCORD_CLIENT_ID ?? '1566157840568164352';

// Sent with every web request; Modrinth asks apps to identify themselves.
const USER_AGENT = `Grovuss/Workbench/${require('../package.json').version}`;

module.exports = { USER_AGENT, MSA_CLIENT_ID, DEV_OFFLINE_NAME, CURSEFORGE_API_KEY, DISCORD_CLIENT_ID };
