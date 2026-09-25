/* Same cross-browser shim as src/background.js: Firefox's chrome.* is not
 * promise-based, so use browser.* there; Chromium MV3 promisifies chrome.*. */
const api = typeof browser !== "undefined" ? browser : chrome;

document.getElementById("edit").addEventListener("click", async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await api.tabs.sendMessage(tab.id, { type: "tmtp-edit" }).catch(() => {});
  window.close();
});

document.getElementById("reset").addEventListener("click", async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await api.tabs.sendMessage(tab.id, { type: "tmtp-reset" }).catch(() => {});
  window.close();
});
