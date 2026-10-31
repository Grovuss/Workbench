// Native window controls drawn over our custom title bar (Windows/Linux).
const TITLEBAR_HEIGHT = 48;

/** `look` is what the renderer last reported: { dark, sidebar, text, zoom }. */
function titleBarOverlay(look) {
  return {
    color: look.sidebar ?? (look.dark ? '#161617' : '#fffdf8'),
    symbolColor: look.text ?? (look.dark ? '#f6f1e6' : '#2a2a2b'),
    height: Math.round(TITLEBAR_HEIGHT * (look.zoom ?? 1)),
  };
}

module.exports = { titleBarOverlay };
