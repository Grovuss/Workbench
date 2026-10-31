// Native window controls drawn over our custom title bar (Windows/Linux).
// Colors match --bg-sidebar and --text in src/styles.css.
const TITLEBAR_HEIGHT = 48;

function titleBarOverlay(dark) {
  return {
    color: dark ? '#161617' : '#fffdf8',
    symbolColor: dark ? '#f6f1e6' : '#2a2a2b',
    height: TITLEBAR_HEIGHT,
  };
}

module.exports = { TITLEBAR_HEIGHT, titleBarOverlay };
