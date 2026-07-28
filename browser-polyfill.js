/**
 * Minimal WebExtension Browser API Polyfill
 * Provides browser.* API compatibility across Chrome, Edge, and Firefox.
 * Supports both Window and ServiceWorker contexts.
 */

(function () {
  'use strict';

  const root = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));

  if (typeof root.browser !== 'undefined' && root.browser.runtime && root.browser.storage) {
    return; // Native browser API supported (e.g. Firefox)
  }

  if (typeof chrome === 'undefined') {
    return;
  }

  root.browser = {
    runtime: {
      sendMessage: (message) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
      },
      onMessage: {
        addListener: (callback) => {
          chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const result = callback(message, sender);
            if (result instanceof Promise) {
              result.then(sendResponse).catch(err => sendResponse({ error: err ? err.message : String(err) }));
              return true; // Keep channel open for async response
            }
            return result;
          });
        },
      },
      get lastError() {
        return chrome.runtime ? chrome.runtime.lastError : null;
      }
    },
    tabs: {
      query: (queryInfo) => {
        return new Promise((resolve, reject) => {
          chrome.tabs.query(queryInfo, (tabs) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(tabs || []);
            }
          });
        });
      },
      sendMessage: (tabId, message, options) => {
        return new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, message, options, (response) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
      }
    },
    storage: {
      local: {
        get: (keys) => {
          return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
              if (chrome.runtime && chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(result || {});
              }
            });
          });
        },
        set: (items) => {
          return new Promise((resolve, reject) => {
            chrome.storage.local.set(items, () => {
              if (chrome.runtime && chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
        },
        remove: (keys) => {
          return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
              if (chrome.runtime && chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
        },
      },
      sync: {
        get: (keys) => {
          return new Promise((resolve, reject) => {
            if (!chrome.storage || !chrome.storage.sync) return resolve({});
            chrome.storage.sync.get(keys, (result) => {
              if (chrome.runtime && chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(result || {});
              }
            });
          });
        }
      }
    }
  };
})();
