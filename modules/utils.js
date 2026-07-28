/**
 * Gemini Trace - Shared Utility Module
 * Exposes window.GTUtils
 */

(function () {
  'use strict';

  /**
   * Escapes HTML characters (&, <, >, ", ').
   * @param {string} str
   * @returns {string}
   */
  const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => _escMap[m]);
  }

  /**
   * Trims and normalizes whitespace in a string.
   * @param {string} str
   * @returns {string}
   */
  function cleanText(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/\s+/g, ' ').trim();
  }

  /**
   * Truncates a string with an ellipsis if it exceeds maxLen.
   * @param {string} str
   * @param {number} maxLen
   * @returns {string}
   */
  function truncate(str, maxLen) {
    const clean = cleanText(str);
    if (typeof maxLen !== 'number' || maxLen <= 0) return clean;
    return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
  }

  /**
   * Standard debounce function returning a debounced wrapper with a .cancel() method.
   * @param {Function} fn
   * @param {number} delay
   * @returns {Function}
   */
  function debounce(fn, delay) {
    let timer = null;
    const debounced = function (...args) {
      const context = this;
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        fn.apply(context, args);
      }, delay);
    };
    debounced.cancel = function () {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced;
  }

  /**
   * Parses conversation ID from Gemini URL href using /^\/app\/(conversations\/)?([A-Za-z0-9_-]+)/.
   * @param {string} href
   * @returns {string|null}
   */
  function getConversationIdFromHref(href) {
    if (!href || typeof href !== 'string') return null;
    let path = href;
    const appIdx = path.indexOf('/app/');
    if (appIdx !== -1) {
      path = path.slice(appIdx);
    }
    const regex = /^\/app\/(conversations\/)?([A-Za-z0-9_-]+)/;
    const match = path.match(regex);
    if (match && match[2]) {
      return match[2];
    }
    return null;
  }

  /**
   * Queries and returns Gemini sidebar container.
   * @returns {Element|null}
   */
  function findSidebar() {
    return document.querySelector(
      'aside, nav, [role="navigation"], .sidebar-container, .side-nav-content'
    ) || null;
  }

  /**
   * Determines dark mode by checking #gcn-panel[data-gcn-theme] or localStorage.getItem('gcn-theme-dark')
   * without calling expensive getComputedStyle.
   * @returns {boolean}
   */
  function isDark() {
    const panel = document.getElementById('gcn-panel');
    if (panel && panel.hasAttribute('data-gcn-theme')) {
      return panel.getAttribute('data-gcn-theme') === 'dark';
    }
    try {
      const ls = localStorage.getItem('gcn-theme-dark');
      if (ls === 'true' || ls === 'false') {
        return ls === 'true';
      }
    } catch (e) { /* ignore localStorage error */ }

    if (document.documentElement.getAttribute('data-theme') === 'dark' ||
        document.body?.getAttribute('data-theme') === 'dark' ||
        document.documentElement.classList.contains('dark-theme') ||
        document.body?.classList.contains('dark-theme')) {
      return true;
    }
    return false;
  }

  /**
   * DOM element creator helper.
   * @param {string} tag
   * @param {Object} [attrs={}]
   * @param {Array|Node|string|number} [children=[]]
   * @returns {HTMLElement}
   */
  function createEl(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    if (attrs && typeof attrs === 'object') {
      Object.entries(attrs).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (key === 'class' || key === 'className') {
          el.className = value;
        } else if (key === 'text' || key === 'textContent') {
          el.textContent = value;
        } else if (key === 'html' || key === 'innerHTML') {
          el.innerHTML = value;
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(el.style, value);
        } else if (key === 'style' && typeof value === 'string') {
          el.style.cssText = value;
        } else if (key === 'dataset' && typeof value === 'object') {
          Object.entries(value).forEach(([dk, dv]) => {
            if (dv !== undefined && dv !== null) {
              el.dataset[dk] = dv;
            }
          });
        } else if (key.startsWith('on') && typeof value === 'function') {
          const eventName = key.slice(2).toLowerCase();
          el.addEventListener(eventName, value);
        } else {
          el.setAttribute(key, value);
        }
      });
    }
    if (children) {
      const childArray = Array.isArray(children) ? children : [children];
      childArray.filter(Boolean).forEach((child) => {
        if (typeof child === 'string' || typeof child === 'number') {
          el.appendChild(document.createTextNode(String(child)));
        } else if (typeof Node !== 'undefined' && child instanceof Node) {
          el.appendChild(child);
        } else if (child && typeof child === 'object') {
          el.appendChild(child);
        }
      });
    }
    return el;
  }

  /**
   * Promise wrapper for chrome.storage.local.get.
   * @param {string|Array|Object|null} keys
   * @returns {Promise<Object>}
   */
  function storageGet(keys) {
    const promise = new Promise((resolve, reject) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(result || {});
            }
          });
        } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get(keys).then(resolve, reject);
        } else {
          resolve({});
        }
      } catch (e) {
        reject(e);
      }
    });
    promise.catch((err) => console.warn('GTUtils.storageGet failed:', err));
    return promise;
  }

  /**
   * Promise wrapper for chrome.storage.local.set.
   * @param {Object} payload
   * @returns {Promise<void>}
   */
  function storageSet(payload) {
    const promise = new Promise((resolve, reject) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(payload, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.set(payload).then(resolve, reject);
        } else {
          resolve();
        }
      } catch (e) {
        reject(e);
      }
    });
    promise.catch((err) => console.warn('GTUtils.storageSet failed:', err));
    return promise;
  }

  let pendingStoragePayload = {};
  let storageDebounceTimer = null;
  let pendingResolvers = [];
  let pendingRejecters = [];

  /**
   * Debounced chrome.storage.local.set helper.
   * @param {Object} payload
   * @param {number} [delay=300]
   * @returns {Promise<void>}
   */
  function debouncedStorageSet(payload, delay = 300) {
    const promise = new Promise((resolve, reject) => {
      if (payload && typeof payload === 'object') {
        Object.assign(pendingStoragePayload, payload);
      }
      pendingResolvers.push(resolve);
      pendingRejecters.push(reject);

      if (storageDebounceTimer !== null) {
        clearTimeout(storageDebounceTimer);
      }

      storageDebounceTimer = setTimeout(() => {
        const dataToSave = pendingStoragePayload;
        const resolvers = pendingResolvers;
        const rejecters = pendingRejecters;

        pendingStoragePayload = {};
        pendingResolvers = [];
        pendingRejecters = [];
        storageDebounceTimer = null;

        storageSet(dataToSave)
          .then(() => {
            resolvers.forEach((r) => r());
          })
          .catch((err) => {
            console.warn('GTUtils: storageSet failed in debouncedStorageSet:', err);
            rejecters.forEach((rej) => rej(err));
          });
      }, delay);
    });
    promise.catch((err) => console.warn('GTUtils.debouncedStorageSet failed:', err));
    return promise;
  }

  const GTUtils = {
    escapeHtml,
    cleanText,
    truncate,
    debounce,
    getConversationIdFromHref,
    findSidebar,
    isDark,
    createEl,
    storageGet,
    storageSet,
    debouncedStorageSet,
  };

  window.GTUtils = GTUtils;
})();
