// Built-in browser outer-size shim. Injected by the Rust host into the PAGE
// world — not the isolated one the helper lives in — at document start, in
// every frame, on macOS only (the constant that carries it is cfg-gated).
//
// A WKWebView embedded as a child view of another window — which is what every
// built-in browser tab is on macOS — has no window rect of its own, and WebKit
// reports `window.outerWidth` / `outerHeight` as 0 for it. No real browser
// does. Pages that read the ratio `outerWidth / innerWidth` to recover the
// browser zoom level (Google Sheets' grid renderer does, to size its canvas
// backing store) compute 0, snap it to the smallest step their zoom table has
// and draw at a quarter of the viewport's resolution — the sheet renders
// blurry, upscaled 4×.
//
// While the outer size reads 0 over a laid-out viewport, the two accessors are
// redefined to report the inner size — the truthful statement this webview can
// make: the window I am in is exactly the viewport you see. The getters are
// lazy, so resizes and the host's per-tab zoom keep tracking. The guard makes
// it a no-op wherever `outerWidth` already answers (an owned window, another
// engine), and a page that defined the property before this ran is left alone.
;(function codegOuterSizeShim() {
  "use strict"
  if (window.outerWidth !== 0) return
  try {
    Object.defineProperty(window, "outerWidth", {
      get: function () {
        return window.innerWidth
      },
      configurable: true,
    })
    Object.defineProperty(window, "outerHeight", {
      get: function () {
        return window.innerHeight
      },
      configurable: true,
    })
  } catch (_) {
    // Nothing this script does may break the page: keep the engine's values.
  }
})()
