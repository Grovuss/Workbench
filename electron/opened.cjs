const fs = require('node:fs');
const path = require('node:path');

// Pack files opened from Explorer (double-click, "Open with") arrive as command-line
// arguments, either at startup or, when Workbench is already running, through the
// second instance that Windows starts. macOS sends them as 'open-file' events instead.

const PACK = /\.(workbench|mrpack)$/i;

/** Waiting for the window to ask for it, when it arrived before the page loaded. */
let pending = null;
let deliver = null;

function packFromArgs(argv) {
  return argv.slice(1).find((arg) => PACK.test(arg) && fs.existsSync(arg)) ?? null;
}

function opened(file) {
  if (!file) return;
  const full = path.resolve(file);
  if (deliver) deliver(full);
  else pending = full;
}

/** The page is listening; later files go straight to it. */
function listen(send) {
  deliver = send;
}

/** The file opened before the page was ready, once. */
function take() {
  const file = pending;
  pending = null;
  return file;
}

module.exports = { packFromArgs, opened, listen, take };
