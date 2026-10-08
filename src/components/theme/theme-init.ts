import type { Theme } from "./types";

export const THEME_STORAGE_KEY = "drag_theme";
export const DEFAULT_THEME: Theme = "dark";

/**
 * Runs before first paint. Without it the document renders with the default theme
 * and then snaps to the stored one, which reads as a flash on every reload.
 *
 * Also neutralises transitions for the swap: a theme change repaints every surface,
 * so without this each element animates its own background independently and the
 * change smears instead of landing in one frame.
 *
 * Only ever touches `document.documentElement`. This script runs inside <head>,
 * before the parser has created <body>, so any `document.body` access throws — which
 * silently fell through to the catch branch and reset the theme to the default, while
 * also leaking the transition-suppression stylesheet and disabling every animation
 * in the app.
 */
export const themeInitScript = `
(function () {
  var theme = ${JSON.stringify(DEFAULT_THEME)};
  var css = null;
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (e) {}
  try {
    css = document.createElement("style");
    css.appendChild(document.createTextNode(
      "*,*::before,*::after{transition:none !important;animation:none !important}"
    ));
    document.head.appendChild(css);
  } catch (e) {}
  try {
    document.documentElement.setAttribute("data-theme", theme);
    void document.documentElement.offsetHeight;
  } catch (e) {}
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (css && css.parentNode) document.head.removeChild(css);
    });
  });
})();
`;