// Minimal MV3 service worker. Zatím jen reaguje na instalaci.
chrome.runtime.onInstalled.addListener(() => {
  // noop — všechno podstatné řeší content scripty.
});
