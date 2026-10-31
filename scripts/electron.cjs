// Launches Electron with ELECTRON_RUN_AS_NODE cleared. VS Code terminals set it,
// which makes Electron run as plain Node and crash on `app.whenReady`.
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
