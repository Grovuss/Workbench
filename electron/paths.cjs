const path = require('node:path');
const { app } = require('electron');

// Everything lives under userData (%APPDATA%\Workbench on Windows).
// meta/ holds shared game files so profiles on the same version reuse them.
const root = () => app.getPath('userData');
const meta = () => path.join(root(), 'meta');

module.exports = {
  root,
  meta,
  profilesDir: () => path.join(root(), 'profiles'),
  versionsDir: () => path.join(meta(), 'versions'),
  librariesDir: () => path.join(meta(), 'libraries'),
  assetsDir: () => path.join(meta(), 'assets'),
  nativesDir: () => path.join(meta(), 'natives'),
  javaDir: () => path.join(meta(), 'java'),
};
