if (typeof browser === 'undefined') {
  try {
    importScripts('browser-polyfill.js');
  } catch (e) {
    // ServiceWorker or script loading fallback
  }
}

const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

if (api && api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener((command) => {
    if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.query) {
      browser.tabs.query({ active: true, currentWindow: true })
        .then((tabs) => {
          if (tabs && tabs[0] && tabs[0].id) {
            browser.tabs.sendMessage(tabs[0].id, { action: command }).catch(() => {});
          }
        })
        .catch((err) => console.warn('[GT Background] query error:', err));
    } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[GT Background] query error:', chrome.runtime.lastError.message || chrome.runtime.lastError);
          return;
        }
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: command }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              // Ignore error if content script isn't ready
            }
          });
        }
      });
    }
  });
}
