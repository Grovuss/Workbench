// Azure app registration (public client) used for Microsoft sign-in.
// Client IDs are not secrets. See README.md → "Microsoft sign-in" for setup.
const MSA_CLIENT_ID = process.env.WORKBENCH_MSA_CLIENT_ID || '8d61a8f9-4212-4bef-9692-95315345180f';

// Until the Azure app is approved for Minecraft, unpackaged dev builds get an
// offline account with this name (singleplayer and offline-mode servers only).
// Set to '' to disable.
const DEV_OFFLINE_NAME = 'Grovus';

module.exports = { MSA_CLIENT_ID, DEV_OFFLINE_NAME };
