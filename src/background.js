/* background.js — Service worker. Currently just handles the action click fallback
 * and persists settings. Most UX is in content.js since we inject on every page.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ tmtp_enabled: true });
});

// Action icon click: send a "toggle" message to the active tab so content.js can
// simulate pressing the FAB even if it's been hidden by z-index fights.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "tmtp-toggle" });
  } catch (e) {
    // content script not present (e.g. chrome:// pages) — ignore
  }
});
