// The splash in index.html stays until the app has something to show, and for at least
// a moment, so a fast start reads as a calm hand-off rather than a flicker.
const MIN_VISIBLE_MS = 450;

let hidden = false;

export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById('splash');
  if (!splash) return;
  window.setTimeout(
    () => {
      splash.classList.add('splash-done');
      window.setTimeout(() => splash.remove(), 250);
    },
    Math.max(0, MIN_VISIBLE_MS - performance.now()),
  );
}
