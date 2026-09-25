/* background.js — Background worker.
 *
 * Cross-browser (Chrome + Firefox) via the dual-key manifest:
 *   - Chromium (Chrome/Edge/Brave/Arc) loads it as an MV3 service worker
 *     ("background.service_worker").
 *   - Firefox 121+ loads it as an MV3 event page ("background.scripts").
 *
 * API namespace: Firefox's `chrome.*` is NOT promise-based, so plain
 * `await chrome.tabs…` would silently no-op there. Firefox exposes the
 * promise-based `browser.*`; Chromium MV3 promisifies `chrome.*`, so this
 * shim works in both engines.
 */
const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onInstalled.addListener(() => {
  api.storage.local.set({ tmtp_enabled: true });
});

// Action icon click: send a "toggle" message to the active tab so content.js can
// simulate pressing the FAB even if it's been hidden by z-index fights.
api.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await api.tabs.sendMessage(tab.id, { type: "tmtp-toggle" });
  } catch (e) {
    // content script not present (e.g. chrome://, about: pages) — ignore
  }
});
