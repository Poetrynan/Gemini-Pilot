/**
 * Gemini Trace - Folders Module (Approach A: self-contained top section)
 *
 * Per user decision (2026-07-27): switch from native in-place grouping
 * (v3, which physically moved Gemini's native rows) to Approach A — a
 * self-contained "folders" section injected at the TOP of Gemini's native
 * conversation sidebar. We DO NOT touch / reorder native rows anymore.
 *
 * Architecture (anchor discovery + self-healing ported from
 * reference/cone-deck-for-gemini/organizer.js):
 *  - Anchor discovery: collect a[href*="/app/<id>"] instead of relying on
 *    fragile component class names.
 *  - We locate the native conversation list container ONLY to decide WHERE
 *    to inject our own #gt-folders-section (at the very top, before the
 *    first native conversation row). Once injected, our section is fully
 *    self-managed — it renders folders + the conversations assigned to
 *    each folder from our own storage.
 *  - Conversation titles are resolved fresh from the live DOM when the
 *    native row is currently present; otherwise we fall back to the title
 *    cached at assignment time. Clicking an item navigates to it.
 *  - Assignment entry points (kept from v3): right-click a native row
 *    (contextmenu) -> selector popup; the native 3-dots menu "Move to
 *    Folder" item; drag a native row onto one of our folder rows.
 *  - Survives Angular re-renders via MutationObserver (self-filtered) +
 *    collapse/route watchers; our section is recreated if Angular wipes it.
 *  - Data model (unchanged from v3, so NO migration is needed):
 *    { folders:[{id,name,collapsed,color}], assignments:{convId->folderId},
 *      conversations:{convId->{title,href,lastSeenAt}} } in chrome.storage.local.
 */

(function () {
  'use strict';

  const PANEL_ID = 'gt-folders-panel';
  const SECTION_ID = 'gt-folders-section';
  const STORAGE_KEY = 'gtFoldersState';
  const LEGACY_KEY = 'gt_folders';
  const FOLDER_COLORS = [
    '#4285F4', '#34A853', '#FBBC04', '#EA4335',
    '#A142F4', '#00BCD4', '#FF7043', '#8BC34A'
  ];

  let state = { folders: [], assignments: {}, conversations: {} };
  let renderScheduled = false;
  let isDragging = false;
  let dragSafetyTimer = null;
  let lastRouteKey = '';
  let menuInjectGuard = false;
  let sectionEl = null;                          // #gt-folders-section (top of sidebar)
  const folderRowEls = new Map();               // folderId -> injected row element

  function resetDragState() {
    if (dragSafetyTimer) {
      clearTimeout(dragSafetyTimer);
      dragSafetyTimer = null;
    }
    if (isDragging) {
      isDragging = false;
      document.querySelectorAll('.gt-dragging, .gt-drag-over').forEach((el) => {
        el.classList.remove('gt-dragging', 'gt-drag-over');
      });
      scheduleRender();
    }
  }

  function startDragSafetyTimer() {
    isDragging = true;
    if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
    dragSafetyTimer = setTimeout(resetDragState, 5000);
  }

  // ---- Diagnostics (inspired by cgptfolderize's ?cgptdebug=1 HUD) ----
  // Goal: let the user self-diagnose "grouping completely broken" WITHOUT devtools.
  // Enable with ?gtdebug=1 on the URL, or localStorage.setItem('gtFoldersDebug','1').
  const DEBUG =
    new URLSearchParams(location.search).get('gtdebug') === '1' ||
    localStorage.getItem('gtFoldersDebug') === '1';
  const diag = {
    scans: 0,
    renders: 0,
    anchors: 0,
    state: 'boot',
    lastScanAt: 0,
    lastRenderAt: 0,
    lastError: ''
  };
  function renderHud() {
    if (!DEBUG) {
      const old = document.getElementById('gt-folders-debug');
      if (old) old.remove();
      return;
    }
    let hud = document.getElementById('gt-folders-debug');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'gt-folders-debug';
      Object.assign(hud.style, {
        position: 'fixed', left: '8px', bottom: '8px', zIndex: '2147483647',
        font: '11px/1.5 ui-monospace, Menlo, Consolas, monospace',
        padding: '8px 10px', borderRadius: '8px',
        background: 'rgba(18,18,26,0.94)', color: '#7CFC00',
        border: '1px solid #3a3a4a', maxWidth: '340px', whiteSpace: 'pre-wrap',
        pointerEvents: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.5)'
      });
      document.body.appendChild(hud);
    }
    const since = (t) => (t ? ((Date.now() - t) / 1000).toFixed(1) + 's ago' : '—');
    hud.textContent =
      'GeminiTrace Folders [A] [debug]\n' +
      'state     : ' + diag.state + '\n' +
      'anchors   : ' + diag.anchors + '  (scans ' + diag.scans + ')\n' +
      'renders   : ' + diag.renders + '\n' +
      'lastScan  : ' + since(diag.lastScanAt) + '\n' +
      'lastRender : ' + since(diag.lastRenderAt) + '\n' +
      'section   : ' + (sectionEl && document.contains(sectionEl) ? 'present' : 'ABSENT') + '\n' +
      (diag.lastError ? 'error     : ' + diag.lastError : '');
  }

  // ======================== Utils ========================

  function debounce(fn, delay) {
    if (window.GTUtils && typeof window.GTUtils.debounce === 'function') {
      return window.GTUtils.debounce(fn, delay);
    }
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function cleanText(text) {
    if (window.GTUtils && typeof window.GTUtils.cleanText === 'function') {
      return window.GTUtils.cleanText(text);
    }
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function truncate(text, max) {
    if (window.GTUtils && typeof window.GTUtils.truncate === 'function') {
      return window.GTUtils.truncate(text, max);
    }
    const clean = cleanText(text);
    return clean.length > max ? clean.slice(0, max) + '…' : clean;
  }

  function uid() {
    return 'folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function createEl(tag, attrs = {}, children = []) {
    if (window.GTUtils && typeof window.GTUtils.createEl === 'function') {
      return window.GTUtils.createEl(tag, attrs, children);
    }
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'dataset') {
        Object.entries(value).forEach(([dk, dv]) => { el.dataset[dk] = dv; });
      } else {
        el.setAttribute(key, value);
      }
    });
    [].concat(children).filter(Boolean).forEach((child) => el.appendChild(child));
    return el;
  }

  function makeIcon(className, body) {
    return createEl('span', {
      class: className,
      html: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>'
    });
  }

  function isDark() {
    if (window.GTUtils && typeof window.GTUtils.isDark === 'function') {
      return window.GTUtils.isDark();
    }
    const panel = document.getElementById('gcn-panel');
    if (panel && panel.hasAttribute('data-gcn-theme')) {
      return panel.getAttribute('data-gcn-theme') === 'dark';
    }
    try {
      const ls = localStorage.getItem('gcn-theme-dark');
      if (ls === 'true' || ls === 'false') return ls === 'true';
    } catch (e) { /* ignore */ }
    return false;
  }

  function applyThemeAttr(el) {
    el.setAttribute('data-gcn-theme', isDark() ? 'dark' : 'light');
    return el;
  }

  // ======================== URL Parsing ========================

  function getConversationIdFromHref(href) {
    if (window.GTUtils && typeof window.GTUtils.getConversationIdFromHref === 'function') {
      return window.GTUtils.getConversationIdFromHref(href) || '';
    }
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
      if (!parts.length) return '';
      if (parts[0] === 'app' && parts[1]) {
        if (parts[1] === 'conversations' && parts[2]) return parts[2];
        return parts[1];
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function isGeminiConversationHref(href) {
    if (!href) return false;
    // Perf: use regex test instead of new URL() construction per anchor
    try {
      if (href.startsWith('http')) {
        const url = new URL(href);
        if (url.origin !== location.origin) return false;
        return /^\/app\/(conversations\/)?[A-Za-z0-9_-]{4,}\/?$/.test(url.pathname);
      }
      // Relative href — test directly
      return /^\/app\/(conversations\/)?[A-Za-z0-9_-]{4,}\/?$/.test(href);
    } catch (e) {
      return false;
    }
  }

  // ======================== Storage ========================

  function storageArea() {
    try { return chrome && chrome.storage && chrome.storage.local ? chrome.storage.local : null; } catch (e) { return null; }
  }

  function storageGet(keys, area) {
    return new Promise((resolve) => {
      const target = area || storageArea();
      if (!target) return resolve({});
      try {
        target.get(keys, (result) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            console.warn('[GT Storage] storageGet error:', chrome.runtime.lastError.message || chrome.runtime.lastError);
          }
          resolve(result || {});
        });
      } catch (e) {
        console.warn('[GT Storage] storageGet exception:', e);
        resolve({});
      }
    });
  }

  function storageSet(payload) {
    return new Promise((resolve) => {
      const target = storageArea();
      if (!target) return resolve();
      try {
        target.set(payload, () => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            console.warn('[GT Storage] storageSet error:', chrome.runtime.lastError.message || chrome.runtime.lastError);
          }
          resolve();
        });
      } catch (e) {
        console.warn('[GT Storage] storageSet exception:', e);
        resolve();
      }
    });
  }

  function normalizeState(raw) {
    const next = { folders: [], assignments: {}, conversations: {} };
    if (raw && Array.isArray(raw.folders)) {
      raw.folders.forEach((f) => {
        if (!f || !f.id || !f.name) return;
        next.folders.push({
          id: String(f.id),
          name: String(f.name),
          collapsed: !!f.collapsed,
          color: typeof f.color === 'string' ? f.color : FOLDER_COLORS[next.folders.length % FOLDER_COLORS.length]
        });
      });
    }
    const folderIds = new Set(next.folders.map((f) => f.id));
    if (raw && raw.assignments && typeof raw.assignments === 'object') {
      Object.entries(raw.assignments).forEach(([convId, folderId]) => {
        if (folderIds.has(folderId)) next.assignments[convId] = folderId;
      });
    }
    if (raw && raw.conversations && typeof raw.conversations === 'object') {
      Object.entries(raw.conversations).forEach(([convId, meta]) => {
        if (!meta || !meta.href) return;
        next.conversations[convId] = {
          id: convId,
          title: cleanText(meta.title) || 'Untitled chat',
          href: meta.href,
          lastSeenAt: meta.lastSeenAt || 0
        };
      });
    }
    return next;
  }

  async function loadState() {
    const result = await storageGet([STORAGE_KEY, LEGACY_KEY]);
    if (result[STORAGE_KEY]) {
      state = normalizeState(result[STORAGE_KEY]);
      return;
    }
    // Legacy v1 migration: [{id, name, icon, collapsed, conversations: []}]
    let legacy = result[LEGACY_KEY];
    if (!legacy) {
      try {
        const syncResult = await storageGet(LEGACY_KEY, chrome.storage.sync);
        legacy = syncResult[LEGACY_KEY];
      } catch (e) { /* sync unavailable */ }
    }
    if (Array.isArray(legacy) && legacy.length) {
      legacy.forEach((f) => {
        if (!f || !f.name) return;
        const folderId = f.id || uid();
        state.folders.push({
          id: folderId,
          name: String(f.name),
          collapsed: !!f.collapsed,
          color: FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length]
        });
        (f.conversations || []).forEach((convId) => {
          if (convId) state.assignments[convId] = folderId;
        });
      });
      persistNow();
    }
  }

  function pruneMeta() {
    const keep = {};
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    Object.entries(state.conversations).forEach(([convId, meta]) => {
      if (state.assignments[convId] || (meta.lastSeenAt && meta.lastSeenAt > weekAgo)) {
        keep[convId] = meta;
      }
    });
    state.conversations = keep;
  }

  function persistNow() {
    pruneMeta();
    if (window.GTUtils && typeof window.GTUtils.debouncedStorageSet === 'function') {
      window.GTUtils.debouncedStorageSet({ [STORAGE_KEY]: state });
    } else {
      storageSet({ [STORAGE_KEY]: state });
    }
  }

  const debouncedPersist = (window.GTUtils && typeof window.GTUtils.debounce === 'function')
    ? window.GTUtils.debounce(persistNow, 800)
    : debounce(persistNow, 800);

  // ======================== Sidebar Discovery ========================

  // Anchor discovery — ported from reference/cone-deck-for-gemini/organizer.js.
  // Many selectors instead of one, and ONLY our own UI is excluded. We only use
  // the anchors to (a) find WHERE to inject our section and (b) refresh titles.
  const ANCHORS_COMBINED_SELECTOR = [
    'aside a[href*="/app/"]',
    'nav a[href*="/app/"]',
    '[aria-label*="history" i] a[href*="/app/"]',
    '[class*="conversation"] a[href*="/app/"]',
    '[class*="history"] a[href*="/app/"]',
    'a[href*="/app/"][class*="row"]',
    'a[href*="/app/"][data-test-id*="conversation"]',
    'a[href*="/app/"][data-testid*="conversation"]'
  ].join(', ');

  function getConversationAnchors() {
    const seen = new Set();
    const anchors = [];
    document.querySelectorAll(ANCHORS_COMBINED_SELECTOR).forEach((a) => {
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.closest('#' + PANEL_ID)) return;
      if (a.closest('#' + SECTION_ID)) return;
      if (a.closest('.gt-folder-selector-overlay, .gt-dialog-overlay, .gt-toast, .gt-folder-menu-overlay')) return;
      const href = a.getAttribute('href') || a.href || '';
      if (!isGeminiConversationHref(href)) return;
      const id = getConversationIdFromHref(href);
      if (!id || seen.has(id)) return;
      seen.add(id);
      anchors.push(a);
    });
    diag.scans += 1;
    diag.anchors = anchors.length;
    diag.lastScanAt = Date.now();
    return anchors;
  }

  function getRow(anchor) {
    return anchor.closest('[data-test-id="conversation"], conversation-items-container, li, [role="listitem"]') || anchor;
  }

  function getAnchorTitle(anchor) {
    return cleanText(
      anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent
    ) || 'Untitled chat';
  }

  function collectLive(listRoot, precomputedAnchors) {
    const map = new Map();
    (precomputedAnchors || getConversationAnchors()).forEach((anchor) => {
      const id = getConversationIdFromHref(anchor.getAttribute('href'));
      const row = getRow(anchor);
      map.set(id, {
        id,
        anchor,
        row,
        title: getAnchorTitle(anchor),
        href: anchor.getAttribute('href')
      });
    });
    return map;
  }

  function directChildContaining(parent, descendant) {
    let node = descendant;
    while (node && node.parentElement && node.parentElement !== parent) {
      node = node.parentElement;
    }
    return node && node.parentElement === parent ? node : null;
  }

  // Score candidate sidebar roots by how many anchors they contain + semantic hints.
  // Ported & simplified from reference/cone-deck-for-gemini/organizer.js.
  function findSidebarRoot(anchors) {
    if (!anchors.length) return null;
    const scored = new Map();
    anchors.forEach((anchor) => {
      let depth = 0;
      let node = anchor;
      while (node && node !== document.body && depth < 10) {
        const parent = node.parentElement;
        if (!parent) break;
        const cur = scored.get(parent) || { count: 0, depthSum: 0, semantic: 0 };
        cur.count += 1;
        cur.depthSum += depth;
        if (parent.matches && parent.matches('aside, nav, [data-test-id*="sidebar"], [data-testid*="sidebar"], [data-test-id*="history"], [role="navigation"]')) {
          cur.semantic += 3;
        }
        if (cur.count >= 3) {
          cur.semantic += 1;
        }
        scored.set(parent, cur);
        node = parent;
        depth += 1;
      }
    });
    const sorted = Array.from(scored.entries())
      .map(([node, v]) => ({
        node,
        count: v.count,
        avgDepth: v.depthSum / Math.max(1, v.count),
        semantic: v.semantic,
        area: node.getBoundingClientRect ? node.getBoundingClientRect().width * node.getBoundingClientRect().height : 0
      }))
      .filter((e) => e.count >= Math.min(anchors.length, 3))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.semantic !== a.semantic) return b.semantic - a.semantic;
        if (a.avgDepth !== b.avgDepth) return a.avgDepth - b.avgDepth;
        return b.area - a.area;
      });
    return sorted[0] ? sorted[0].node : (anchors[0].closest('aside, nav') || anchors[0].parentElement);
  }

  function getListRoot(sidebarRoot, anchors) {
    if (!sidebarRoot) return null;
    const semantic = anchors[0] && anchors[0].closest && anchors[0].closest('[role="list"], ul, ol, [data-test-id*="history"], [data-test-id*="conversation"], [data-testid*="history"]');
    if (semantic && sidebarRoot.contains(semantic)) return semantic;
    if (anchors[1]) {
      let p = anchors[0].parentElement;
      const rowB = getRow(anchors[1]);
      while (p && p !== document.body && !p.contains(rowB)) p = p.parentElement;
      if (p && p !== document.body) return p;
    }
    const scrollable = anchors[0].closest && anchors[0].closest('infinite-scroller, [class*="scroll"], [class*="scroller"]');
    return scrollable || sidebarRoot;
  }

  // Perf: cache sidebarRoot to avoid expensive O(anchors × depth) scoring
  // on every render. Invalidated together with the anchor cache.
  let cachedSidebarRoot = null;
  let sidebarRootCacheTimestamp = 0;

  // The native list container whose direct children are the conversation rows.
  // Our section is injected at its TOP; we never move native rows.
  function getListContainer(anchors) {
    if (!anchors || !anchors.length) return null;
    const now = Date.now();
    let sidebarRoot;
    if (cachedSidebarRoot && document.contains(cachedSidebarRoot) && (now - sidebarRootCacheTimestamp) < CACHE_TTL) {
      sidebarRoot = cachedSidebarRoot;
    } else {
      sidebarRoot = findSidebarRoot(anchors);
      cachedSidebarRoot = sidebarRoot;
      sidebarRootCacheTimestamp = now;
    }
    return (sidebarRoot && (getListRoot(sidebarRoot, anchors) || sidebarRoot)) || null;
  }

  function isSidebarCollapsed(mountParent) {
    const rect = mountParent.getBoundingClientRect();
    return rect.width > 0 && rect.width < 150;
  }

  // ======================== Folder Operations ========================

  function getFolder(folderId) {
    return state.folders.find((f) => f.id === folderId) || null;
  }

  function createFolder(name) {
    const folder = {
      id: uid(),
      name: cleanText(name) || 'New Folder',
      collapsed: false,
      color: FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length]
    };
    state.folders.push(folder);
    debouncedPersist();
    scheduleRender();
    return folder;
  }

  function assign(convId, folderId) {
    if (!convId || !folderId) return;
    const folder = getFolder(folderId);
    if (!folder) return;
    if (state.assignments[convId] === folderId) {
      showToast('Already in "' + folder.name + '"');
      return;
    }
    // Capture the conversation's current title/href from the live DOM if present.
    const anc = getConversationAnchors();
    const live = collectLive(getListContainer(anc), anc);
    const rec = live.get(convId);
    if (rec) {
      state.conversations[convId] = { id: convId, title: rec.title, href: rec.href, lastSeenAt: Date.now() };
    }
    state.assignments[convId] = folderId;
    folder.collapsed = false;
    debouncedPersist();
    showToast('Moved to "' + folder.name + '"');
    scheduleRender();
  }

  function unassign(convId) {
    if (!state.assignments[convId]) return;
    delete state.assignments[convId];
    debouncedPersist();
    showToast('Removed from folder');
    scheduleRender();
  }

  function removeFolder(folderId) {
    state.folders = state.folders.filter((f) => f.id !== folderId);
    Object.keys(state.assignments).forEach((convId) => {
      if (state.assignments[convId] === folderId) delete state.assignments[convId];
    });
    debouncedPersist();
    scheduleRender();
  }

  function toggleCollapse(folderId) {
    const folder = getFolder(folderId);
    if (!folder) return;
    folder.collapsed = !folder.collapsed;
    debouncedPersist();
    scheduleRender();
  }

  function setFolderColor(folderId, color) {
    const folder = getFolder(folderId);
    if (!folder) return;
    folder.color = color;
    debouncedPersist();
    scheduleRender();
  }

  // ======================== Toast ========================

  function showToast(msg) {
    document.querySelectorAll('.gt-toast').forEach((el) => el.remove());
    const toast = applyThemeAttr(createEl('div', { class: 'gt-toast' }, [
      createEl('span', { text: msg })
    ]));
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, 10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  // ======================== Dialogs ========================

  function openDialog(titleText, bodyNodes, confirmText, confirmClass, onConfirm) {
    document.querySelectorAll('.gt-dialog-overlay').forEach((el) => el.remove());
    const cancelBtn = createEl('button', { class: 'gt-btn gt-dialog-cancel', text: 'Cancel' });
    const confirmBtn = createEl('button', { class: 'gt-btn ' + confirmClass + ' gt-dialog-confirm', text: confirmText });
    const dialog = createEl('div', { class: 'gt-dialog' }, [
      createEl('h3', { text: titleText }),
      ...bodyNodes,
      createEl('div', { class: 'gt-dialog-actions' }, [cancelBtn, confirmBtn])
    ]);
    const overlay = applyThemeAttr(createEl('div', { class: 'gt-dialog-overlay' }, [dialog]));
    document.body.appendChild(overlay);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanup();
      }
    };
    const cleanup = () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      overlay.remove();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    cancelBtn.addEventListener('click', () => cleanup());
    confirmBtn.addEventListener('click', () => { if (onConfirm() !== false) cleanup(); });
    return { overlay, confirmBtn, cleanup };
  }

  function showCreateDialog(convId) {
    const input = createEl('input', {
      type: 'text',
      class: 'gt-input gt-folder-input',
      placeholder: 'e.g. Research / Coding / Ideas'
    });
    const { overlay, confirmBtn } = openDialog(
      'New Folder',
      [createEl('p', { text: 'Enter folder name:' }), input],
      'Create', 'gt-btn-primary',
      () => {
        const name = cleanText(input.value);
        if (!name) return false;
        const folder = createFolder(name);
        if (convId) assign(convId, folder.id);
        return true;
      }
    );
    confirmBtn.disabled = true;
    input.addEventListener('input', () => { confirmBtn.disabled = !cleanText(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && cleanText(input.value)) {
        const folder = createFolder(cleanText(input.value));
        if (convId) assign(convId, folder.id);
        overlay.remove();
      }
      if (e.key === 'Escape') overlay.remove();
    });
    setTimeout(() => input.focus(), 50);
  }

  function showRenameDialog(folderId) {
    const folder = getFolder(folderId);
    if (!folder) return;
    const input = createEl('input', { type: 'text', class: 'gt-input gt-folder-input', value: folder.name });
    openDialog(
      'Rename Folder',
      [createEl('p', { text: 'New name:' }), input],
      'Rename', 'gt-btn-primary',
      () => {
        const name = cleanText(input.value);
        if (!name) return false;
        folder.name = name;
        debouncedPersist();
        scheduleRender();
        return true;
      }
    );
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  function showDeleteDialog(folderId) {
    const folder = getFolder(folderId);
    if (!folder) return;
    openDialog(
      'Delete Folder',
      [
        createEl('p', { text: 'Delete folder "' + folder.name + '"?' }),
        createEl('p', { class: 'gt-dialog-hint', text: 'Chats inside will return to the Recent list. Nothing is deleted from Gemini.' })
      ],
      'Delete Folder', 'gt-btn-danger',
      () => { removeFolder(folderId); return true; }
    );
  }

  // ======================== Folder Selector Popup ========================

  let activeSelectorMousedownHandler = null;

  function closeSelector() {
    if (activeSelectorMousedownHandler) {
      document.removeEventListener('mousedown', activeSelectorMousedownHandler, true);
      activeSelectorMousedownHandler = null;
    }
    document.querySelectorAll('.gt-folder-selector-overlay').forEach((el) => el.remove());
  }

  function showSelector(convId, x, y) {
    closeSelector();
    if (!convId) return;

    const box = createEl('div', { class: 'gt-folder-selector' });
    box.appendChild(createEl('div', { class: 'gt-folder-selector-title', text: 'Move to Folder' }));

    const newItem = createEl('div', { class: 'gt-folder-selector-item gt-create-new-item', text: '+ New folder…' });
    newItem.addEventListener('click', () => { closeSelector(); showCreateDialog(convId); });
    box.appendChild(newItem);

    if (state.folders.length) box.appendChild(createEl('div', { class: 'gt-selector-divider' }));

    state.folders.forEach((folder) => {
      const item = createEl('div', { class: 'gt-folder-selector-item' }, [
        createEl('span', { class: 'gt-selector-color-dot', dataset: { color: folder.color || '' }, style: 'background:' + (folder.color || '#4285F4') }),
        createEl('span', { text: folder.name })
      ]);
      item.addEventListener('click', () => { assign(convId, folder.id); closeSelector(); });
      box.appendChild(item);
    });

    if (state.assignments[convId]) {
      box.appendChild(createEl('div', { class: 'gt-selector-divider' }));
      const removeItem = createEl('div', { class: 'gt-folder-selector-item gt-selector-danger', text: 'Remove from folder' });
      removeItem.addEventListener('click', () => { unassign(convId); closeSelector(); });
      box.appendChild(removeItem);
    }

    const overlay = applyThemeAttr(createEl('div', { class: 'gt-folder-selector-overlay' }, [box]));
    overlay.style.position = 'fixed';
    overlay.style.left = Math.min(window.innerWidth - 230, Math.max(10, x)) + 'px';
    overlay.style.top = Math.min(window.innerHeight - 340, Math.max(10, y)) + 'px';
    overlay.style.zIndex = '999999';
    document.body.appendChild(overlay);

    setTimeout(() => {
      if (!document.contains(overlay)) return;
      const closeHandler = (e) => {
        if (!overlay.contains(e.target)) {
          closeSelector();
        }
      };
      activeSelectorMousedownHandler = closeHandler;
      document.addEventListener('mousedown', closeHandler, true);
    }, 150);
  }

  // ======================== Folder Context Menu (rename / color / delete) ========================

  let activeFolderMenuMousedownHandler = null;

  function closeFolderMenu() {
    if (activeFolderMenuMousedownHandler) {
      document.removeEventListener('mousedown', activeFolderMenuMousedownHandler, true);
      activeFolderMenuMousedownHandler = null;
    }
    document.querySelectorAll('.gt-folder-menu-overlay').forEach((el) => el.remove());
  }

  function showFolderMenu(folderId, x, y) {
    closeFolderMenu();
    const folder = getFolder(folderId);
    if (!folder) return;

    const box = createEl('div', { class: 'gt-folder-menu' });

    const renameItem = createEl('div', { class: 'gt-folder-menu-item', text: 'Rename' });
    renameItem.addEventListener('click', () => { closeFolderMenu(); showRenameDialog(folderId); });
    box.appendChild(renameItem);

    const colorItem = createEl('div', { class: 'gt-folder-menu-item gt-folder-menu-color' }, [
      createEl('span', { class: 'gt-folder-menu-color-label', text: 'Color' })
    ]);
    FOLDER_COLORS.forEach((c) => {
      const sw = createEl('span', {
        class: 'gt-swatch' + (folder.color === c ? ' is-selected' : ''),
        title: c,
        style: 'background:' + c
      });
      sw.addEventListener('click', () => { setFolderColor(folderId, c); closeFolderMenu(); });
      colorItem.appendChild(sw);
    });
    box.appendChild(colorItem);

    const delItem = createEl('div', { class: 'gt-folder-menu-item gt-menu-danger', text: 'Delete Folder' });
    delItem.addEventListener('click', () => { closeFolderMenu(); showDeleteDialog(folderId); });
    box.appendChild(delItem);

    const overlay = applyThemeAttr(createEl('div', { class: 'gt-folder-menu-overlay' }, [box]));
    overlay.style.position = 'fixed';
    overlay.style.left = Math.min(window.innerWidth - 220, Math.max(10, x)) + 'px';
    overlay.style.top = Math.min(window.innerHeight - 280, Math.max(10, y)) + 'px';
    overlay.style.zIndex = '999999';
    document.body.appendChild(overlay);

    setTimeout(() => {
      if (!document.contains(overlay)) return;
      const closeHandler = (e) => {
        if (!overlay.contains(e.target)) {
          closeFolderMenu();
        }
      };
      activeFolderMenuMousedownHandler = closeHandler;
      document.addEventListener('mousedown', closeHandler, true);
    }, 0);
  }

  // ======================== Native Row Binding ========================

  function bindSource(record) {
    const row = record.row;
    if (!row) return;
    if (row.dataset.gtFolderBound === '1') {
      row.dataset.gtConvId = record.id;
      return;
    }
    row.dataset.gtFolderBound = '1';
    row.dataset.gtConvId = record.id;
    row.setAttribute('draggable', 'true');

    row.addEventListener('dragstart', (e) => {
      startDragSafetyTimer();
      try {
        e.dataTransfer.setData('text/plain', row.dataset.gtConvId);
        e.dataTransfer.effectAllowed = 'move';
      } catch (err) { /* ignore */ }
      row.classList.add('gt-dragging');
    });

    row.addEventListener('dragend', () => {
      resetDragState();
    });

    row.addEventListener('contextmenu', (e) => {
      if (window.GTBatchDelete && window.GTBatchDelete.isActive && window.GTBatchDelete.isActive()) return;
      e.preventDefault();
      e.stopPropagation();
      showSelector(row.dataset.gtConvId, e.clientX, e.clientY);
    });
  }

  // ======================== Title / href resolution ========================

  function convTitle(convId, live) {
    const rec = live && live.get(convId);
    if (rec && rec.title) return rec.title;
    const meta = state.conversations[convId];
    if (meta && meta.title) return meta.title;
    return 'Untitled chat';
  }

  function convHref(convId, live) {
    const rec = live && live.get(convId);
    if (rec && rec.href) return rec.href;
    const meta = state.conversations[convId];
    if (meta && meta.href) return meta.href;
    return '/app/' + convId;
  }

  // Open a conversation WITHOUT a full page reload.
  // Gemini's native sidebar rows are <a href="/app/..."> elements whose clicks
  // are intercepted by Angular Router for an in-app (SPA) navigation — only the
  // chat pane re-renders. Our injected items must reproduce that behaviour:
  // 1) click the matching native anchor (Angular handles it as SPA nav), or
  // 2) dispatch a synthetic click on a freshly-built anchor, which Angular also
  //    intercepts, or
  // 3) only if all else fails, assign() to force a full navigation.
  function openConv(convId, href) {
    // Preferred: reuse Gemini's own anchor so Angular Router performs SPA nav.
    if (convId) {
      const anchors = getConversationAnchors();
      for (const a of anchors) {
        if (getConversationIdFromHref(a.getAttribute('href')) === convId) {
          a.click();
          return;
        }
      }
    }
    // Fallback A: a synthetic anchor at the same path is still intercepted by
    // Angular Router (no full reload).
    const abs = href && href.startsWith('http')
      ? href
      : location.origin + (href && href.startsWith('/') ? '' : '/') + (href || '');
    const temp = document.createElement('a');
    temp.href = abs;
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.click();
    if (temp.parentNode) temp.parentNode.removeChild(temp);
  }

  // ======================== Rendering (Approach A) ========================

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      try { render(); diag.renders += 1; diag.lastRenderAt = Date.now(); }
      catch (e) { diag.lastError = (e && e.message) || String(e); }
      renderHud();
    });
  }

  function removeGroupUI() {
    if (sectionEl) { sectionEl.remove(); sectionEl = null; }
    folderRowEls.forEach((el) => el.remove());
    folderRowEls.clear();
    closeSelector();
    closeFolderMenu();
  }

  function ensureSection() {
    if (sectionEl && document.contains(sectionEl)) return sectionEl;
    const newBtn = createEl('button', {
      class: 'gt-folders-new-btn',
      type: 'button',
      title: 'New Folder',
      'aria-label': 'New Folder'
    }, [
      makeIcon('gt-toolbar-plus-icon', '<path d="M12 5v14M5 12h14"></path>'),
      createEl('span', { class: 'gt-toolbar-label', text: 'New' })
    ]);
    newBtn.addEventListener('click', (e) => { e.stopPropagation(); showCreateDialog(null); });

    sectionEl = applyThemeAttr(createEl('div', {
      id: SECTION_ID,
      class: 'gt-folders-section',
      dataset: { gtFolderUi: '1' },
      'aria-label': 'Folders'
    }, [
      createEl('div', { class: 'gt-folders-header' }, [
        createEl('span', { class: 'gt-folders-label', text: 'Folders' }),
        newBtn
      ]),
      createEl('div', { class: 'gt-folders-list', dataset: { gtFoldersList: '1' } })
    ]));
    return sectionEl;
  }

  // Place the section above ALL native conversation rows (pinned + recent).
  // Gemini's sidebar keeps pinned items as a sibling group above the recent list;
  // scoping our search to the recent <ul> would leave pinned above our section.
  // We therefore walk sidebarRoot.children to find the topmost native row across
  // both groups and insert before it. Guarded so a steady state is mutation-free.
  function placeSection(sidebarRoot, section) {
    if (!sidebarRoot) return;
    let firstNativeRow = null;
    for (const child of sidebarRoot.children) {
      if (child === section) continue;
      if (child.dataset && child.dataset.gtFolderUi) continue;
      if (child.id === SECTION_ID) continue;
      // Skip our dialog/selector/menu overlays if any of them ended up at this level.
      if (child.classList && (
        child.classList.contains('gt-folder-selector-overlay') ||
        child.classList.contains('gt-dialog-overlay') ||
        child.classList.contains('gt-toast') ||
        child.classList.contains('gt-folder-menu-overlay')
      )) continue;
      // A native row (or group container) is anything that contains at least one
      // conversation anchor. We intentionally do NOT require an exact match for
      // a "row" — group wrappers that hold pinned items still satisfy this.
      if (child.querySelector && child.querySelector('a[href*="/app/"]')) {
        firstNativeRow = child;
        break;
      }
    }
    if (firstNativeRow) {
      if (section.parentNode !== sidebarRoot || section.nextElementSibling !== firstNativeRow) {
        sidebarRoot.insertBefore(section, firstNativeRow);
      }
    } else if (section.parentNode !== sidebarRoot) {
      sidebarRoot.appendChild(section);
    }
  }

  function buildFolderRow(folder) {
    const colorDot = createEl('span', { class: 'gt-folder-color-dot', style: 'background:' + (folder.color || '#4285F4') });
    const caret = makeIcon('gt-folder-toggle', '<path d="m6 9 6 6 6-6"></path>');
    const nameEl = createEl('span', { class: 'gt-folder-name', title: folder.name });
    const countEl = createEl('span', { class: 'gt-folder-count' });
    const menuBtn = createEl('button', {
      class: 'gt-folder-menu-btn',
      type: 'button',
      title: 'Folder menu',
      'aria-label': 'Folder menu',
      text: '⋯'
    });
    const convsEl = createEl('div', { class: 'gt-folder-convs' });
    const head = createEl('div', { class: 'gt-folder-row-head' }, [colorDot, caret, nameEl, countEl, menuBtn]);

    const row = applyThemeAttr(createEl('div', {
      class: 'gt-folder-row',
      dataset: { gtFolderUi: '1', folder: folder.id },
      role: 'button',
      tabindex: '0',
      'aria-label': 'Folder ' + folder.name
    }, [head, convsEl]));

    row.addEventListener('click', (e) => {
      if (e.target.closest('.gt-folder-menu-btn, .gt-folder-convs, .gt-conv-remove')) return;
      toggleCollapse(folder.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.target.closest('.gt-folder-convs, .gt-conv-remove')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapse(folder.id);
      }
    });
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      showFolderMenu(folder.id, r.left, r.bottom + 4);
    });

    // Drop target — drag a native chat row onto the folder row to file it.
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('gt-drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('gt-drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('gt-drag-over');
      let convId = '';
      try { convId = e.dataTransfer.getData('text/plain'); } catch (err) { /* ignore */ }
      resetDragState();
      if (convId) assign(convId, folder.id);
    });

    row._convsEl = convsEl;
    return row;
  }

  function updateFolderRow(row, folder, live) {
    // Perf: compute count once instead of 3 times
    const count = totalAssignedCount(folder.id);
    const sig = folder.name + '|' + !!folder.collapsed + '|' + count + '|' + (folder.color || '');
    if (row.dataset.gtSig !== sig) {
      row.dataset.gtSig = sig;
      const colorDot = row.querySelector('.gt-folder-color-dot');
      const nameEl = row.querySelector('.gt-folder-name');
      const countEl = row.querySelector('.gt-folder-count');
      const caret = row.querySelector('.gt-folder-toggle');
      if (colorDot) colorDot.style.background = folder.color || '#4285F4';
      if (nameEl) { nameEl.textContent = folder.name; nameEl.title = folder.name; }
      if (countEl) {
        countEl.textContent = String(count);
        countEl.setAttribute('aria-label', count + ' conversations');
      }
      if (caret) {
        caret.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          (folder.collapsed ? '<path d="m9 18 6-6-6-6"></path>' : '<path d="m6 9 6 6 6-6"></path>') + '</svg>';
      }
      row.setAttribute('aria-label', 'Folder ' + folder.name + ', ' + count + ' conversations');
      row.classList.toggle('is-collapsed', !!folder.collapsed);
    }
    applyThemeAttr(row);
    syncConvs(row._convsEl, folder, live);
  }

  function buildConvItem(convId, folder, live) {
    const title = convTitle(convId, live);
    const href = convHref(convId, live);
    const item = applyThemeAttr(createEl('div', {
      class: 'gt-folder-conv',
      dataset: { gtConvId: convId },
      role: 'link',
      tabindex: '0',
      title: title
    }, [
      makeIcon('gt-conv-icon', '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path>'),
      createEl('span', { class: 'gt-conv-title', text: title })
    ]));
    const removeBtn = createEl('button', {
      class: 'gt-conv-remove',
      type: 'button',
      title: 'Remove from folder',
      'aria-label': 'Remove from folder',
      text: '×'
    });
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); unassign(convId); });
    item.appendChild(removeBtn);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      openConv(convId, href);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        openConv(convId, href);
      }
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = item.getBoundingClientRect();
      showSelector(convId, r.left, r.bottom + 4);
    });
    return item;
  }

  // Diff the conversation list inside an expanded folder row against the
  // assignment map — add / remove / reorder items without destroying the
  // container (so nested event listeners survive and there is no flicker).
  function syncConvs(convsEl, folder, live) {
    if (!convsEl) return;
    const ids = Object.keys(state.assignments).filter((cid) => state.assignments[cid] === folder.id);
    if (folder.collapsed) {
      if (convsEl.childElementCount) convsEl.replaceChildren();
      return;
    }
    const current = new Map();
    convsEl.querySelectorAll('[data-gt-conv-id]').forEach((el) => current.set(el.dataset.gtConvId, el));
    const curId = getConversationIdFromHref(location.pathname);
    let cursor = null;
    ids.forEach((cid) => {
      let el = current.get(cid);
      const freshTitle = convTitle(cid, live);
      if (!el) {
        el = buildConvItem(cid, folder, live);
      } else {
        const t = el.querySelector('.gt-conv-title');
        if (t) t.textContent = freshTitle;
        el.title = freshTitle;
      }
      el.classList.toggle('is-current', cid === curId);
      const ref = cursor ? cursor.nextElementSibling : convsEl.firstChild;
      if (ref !== el) {
        if (cursor) cursor.after(el);
        else convsEl.insertBefore(el, convsEl.firstChild);
      }
      current.delete(cid);
      cursor = el;
    });
    // Remove any stale items left in `current`.
    current.forEach((el) => el.remove());
  }

  function totalAssignedCount(folderId) {
    let n = 0;
    Object.values(state.assignments).forEach((fid) => { if (fid === folderId) n += 1; });
    return n;
  }

  function rebuildSection(section, live) {
    const list = section.querySelector('[data-gt-folders-list]');
    if (!list) return;

    // Drop rows whose folder was deleted.
    const ids = new Set(state.folders.map((f) => f.id));
    folderRowEls.forEach((el, id) => {
      if (!ids.has(id) || !document.contains(el)) { el.remove(); folderRowEls.delete(id); }
    });

    // Ensure + position each folder row in state order (contiguous).
    let cursor = null;
    state.folders.forEach((folder) => {
      let row = folderRowEls.get(folder.id);
      if (!row) { row = buildFolderRow(folder); folderRowEls.set(folder.id, row); }
      updateFolderRow(row, folder, live);
      const ref = cursor ? cursor.nextElementSibling : list.firstChild;
      if (ref !== row) {
        if (cursor) cursor.after(row);
        else list.insertBefore(row, list.firstChild);
      }
      cursor = row;
    });
  }

  // Detect whether Gemini's sidebar is still loading its conversation list.
  // While loading, Gemini shows a Material 3 circular progress spinner (the
  // "C-shaped rotating icon"). We must NOT inject our section or bind native
  // rows during this phase — mutating Angular-managed DOM prevents Gemini
  // from reaching a stable loaded state (sidebar stuck spinning forever).
  function isGeminiSidebarLoading() {
    const sidebarArea = document.querySelector(
      'aside, nav, [role="navigation"], mat-drawer, mat-sidenav, .mat-drawer'
    );
    if (!sidebarArea) return false;
    const spinner = sidebarArea.querySelector(
      'mat-progress-spinner, .mat-progress-spinner, .mat-mdc-progress-spinner, ' +
      'mat-spinner, .mdc-circular-progress, [role="progressbar"], ' +
      '[class*="loading-spinner"], [class*="progress-spinner"], [class*="circular-progress"]'
    );
    if (!spinner) return false;
    // Only consider it "loading" if the spinner is actually visible
    return spinner.offsetWidth > 0 || spinner.offsetHeight > 0;
  }

  // Anchor cache: avoid redundant querySelectorAll on every render
  let cachedAnchors = null;
  let cacheTimestamp = 0;
  const CACHE_TTL = 200; // ms

  function getCachedAnchors() {
    const now = Date.now();
    if (cachedAnchors && (now - cacheTimestamp) < CACHE_TTL) {
      return cachedAnchors;
    }
    cachedAnchors = getConversationAnchors();
    cacheTimestamp = now;
    return cachedAnchors;
  }

  function invalidateAnchorCache() {
    cachedAnchors = null;
    cacheTimestamp = 0;
    // Also invalidate sidebarRoot cache since DOM may have changed
    cachedSidebarRoot = null;
    sidebarRootCacheTimestamp = 0;
  }

  function render() {
    if (isDragging) return;

    // Loading guard: if Gemini's sidebar is still loading (Material 3
    // circular spinner visible), do NOT run DOM scans, inject our section, or bind native
    // rows. Mutating Angular-managed DOM during loading prevents Gemini
    // from reaching a stable state (sidebar stuck spinning forever).
    if (isGeminiSidebarLoading()) {
      removeGroupUI();
      diag.state = 'gemini-loading (deferred)';
      return;
    }

    // Note: tryInjectMenuItems is NOT called here — it runs in its own
    // MutationObserver callback (CDK overlay detection) to avoid coupling
    // menu injection with the render cycle.

    const anchors = getCachedAnchors();
    const sidebarRoot = findSidebarRoot(anchors);
    const listRoot = sidebarRoot ? (getListRoot(sidebarRoot, anchors) || sidebarRoot) : null;

    if (!listRoot || isSidebarCollapsed(sidebarRoot || listRoot)) {
      removeGroupUI();
      diag.state = !listRoot ? 'no-mount (no sidebar anchor found)' : 'sidebar-collapsed';
      return;
    }

    // Batch-select mode: hide our section entirely so it never interferes.
    const batchActive = !!(window.GTBatchDelete && window.GTBatchDelete.isActive && window.GTBatchDelete.isActive());
    if (batchActive) {
      removeGroupUI();
      diag.state = 'batch-mode (section hidden)';
      return;
    }

    // Pass pre-computed anchors to avoid a second getConversationAnchors() call.
    const live = collectLive(listRoot, anchors);

    // Sanitize state.assignments against active sidebar items to eliminate ghost counts for deleted chats
    if (live && live.size > 0) {
      let cleaned = false;
      Object.keys(state.assignments).forEach((convId) => {
        if (!live.has(convId)) {
          delete state.assignments[convId];
          delete state.conversations[convId];
          cleaned = true;
        }
      });
      if (cleaned) debouncedPersist();
    }

    // Refresh metadata cache for assigned conversations present in the live DOM.
    let metaChanged = false;
    live.forEach((rec) => {
      const prev = state.conversations[rec.id];
      if (!prev || prev.title !== rec.title || prev.href !== rec.href) metaChanged = true;
      state.conversations[rec.id] = { id: rec.id, title: rec.title, href: rec.href, lastSeenAt: Date.now() };
    });
    if (metaChanged) debouncedPersist();

    // Bind drag / context-menu sources on the native rows (no DOM moves).
    live.forEach((rec) => bindSource(rec));

    // Inject our self-contained section above ALL native rows (pinned + recent).
    const section = ensureSection();
    applyThemeAttr(section); // re-apply theme every render so it follows dark/light switches
    placeSection(sidebarRoot || listRoot, section);
    rebuildSection(section, live);

    section.setAttribute('data-gt-folders-version', 'A');
    section.setAttribute('data-gt-conv-count', String(live.size));
    section.setAttribute('data-gt-folders', String(state.folders.length));
    section.setAttribute('data-gt-mount-parent', ((sidebarRoot && sidebarRoot.tagName) || '').toLowerCase());

    diag.state = 'mounted (' + live.size + ' convs, ' + state.folders.length + ' folders)';
  }

  // ======================== Native 3-Dots Menu ========================

  // Resolve the conversation id that a specific menu TRIGGER belongs to.
  // IMPORTANT: there is deliberately NO `location.pathname` fallback. That
  // fallback previously caused the "always targets the just-moved / currently
  // open conversation" bug — when resolution failed it silently assigned to
  // whatever chat you happened to have open. If we can't determine the row we
  // return null and the caller aborts (with a toast) instead of mis-assigning.
  function getConvIdFromNode(node) {
    if (!node) return null;
    const boundRow = node.closest && node.closest('[data-gt-conv-id]');
    if (boundRow && boundRow.dataset && boundRow.dataset.gtConvId) return boundRow.dataset.gtConvId;

    if (node.tagName && node.tagName.toLowerCase() === 'a' && node.getAttribute('href')) {
      const id = getConversationIdFromHref(node.getAttribute('href'));
      if (id) return id;
    }

    const itemContainer = node.closest && node.closest('conversation-item-viewer, li, [role="listitem"], [data-test-id*="conversation"], .gt-folder-conv-item');
    if (itemContainer) {
      if (itemContainer.dataset && itemContainer.dataset.gtConvId) return itemContainer.dataset.gtConvId;
      const anchor = itemContainer.querySelector('a[href*="/app/"]');
      if (anchor) {
        const id = getConversationIdFromHref(anchor.getAttribute('href') || '');
        if (id) return id;
      }
    }

    let curr = node.parentElement;
    while (curr && curr !== document.body) {
      if (curr.dataset && curr.dataset.gtConvId) return curr.dataset.gtConvId;
      const anchors = curr.querySelectorAll('a[href*="/app/"]');
      if (anchors.length >= 1) {
        const id = getConversationIdFromHref(anchors[0].getAttribute('href') || '');
        if (id) return id;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  function resolveTriggerConvId(trigger, menu) {
    if (trigger) {
      const id = getConvIdFromNode(trigger);
      if (id) return id;
    }

    if (menu) {
      const liveTrigger = getTriggerForMenu(menu);
      if (liveTrigger) {
        const id = getConvIdFromNode(liveTrigger);
        if (id) return id;
      }
    }

    const expandedTrigger = document.querySelector(
      '.mat-mdc-menu-trigger[aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"], [aria-haspopup="true"][aria-expanded="true"], button[aria-expanded="true"]'
    );
    if (expandedTrigger) {
      const id = getConvIdFromNode(expandedTrigger);
      if (id) return id;
    }

    const activeId = getConversationIdFromHref(location.href);
    if (activeId) return activeId;

    return null;
  }

  // Find the trigger element connected to a SPECIFIC menu panel. The CDK menu
  // panel is usually portaled to <body> and is NOT a DOM descendant of the row,
  // so we can't rely on the trigger's position alone — instead we match the
  // panel's id with the trigger's aria-controls, falling back to the expanded
  // trigger. This pins the move to the row whose menu is actually open.
  function getTriggerForMenu(menu) {
    if (!menu) return null;
    let trigger = null;
    if (menu.id) {
      try {
        const sel = '[aria-controls="' + (window.CSS && CSS.escape ? CSS.escape(menu.id) : menu.id) + '"]';
        trigger = document.querySelector(sel);
      } catch (e) { trigger = null; }
    }
    if (!trigger) {
      trigger = document.querySelector(
        '.mat-mdc-menu-trigger[aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"], [aria-haspopup="true"][aria-expanded="true"]'
      );
    }
    return trigger || null;
  }

  function tryInjectMenuItems() {
    if (menuInjectGuard) return;
    if (window.GTBatchDelete && window.GTBatchDelete.isActive && window.GTBatchDelete.isActive()) return;

    // Remove any stray custom menu items that got injected into dialog modals
    document.querySelectorAll('[role="dialog"] .gt-native-menu-item, mat-dialog-container .gt-native-menu-item, .mat-mdc-dialog-container .gt-native-menu-item, .mat-mdc-dialog-surface .gt-native-menu-item').forEach((el) => el.remove());

    let rawMenus = Array.from(document.querySelectorAll(
      '[role="menu"], .mat-mdc-menu-panel, mat-menu-content'
    ));
    if (!rawMenus.length) return;

    const isDialogNode = (node) => {
      if (!node) return false;
      if (node.getAttribute && (node.getAttribute('role') === 'dialog' || node.getAttribute('aria-modal') === 'true')) return true;
      if (node.classList && (node.classList.contains('mat-mdc-dialog-container') || node.classList.contains('mat-dialog-container') || node.classList.contains('mat-mdc-dialog-surface'))) return true;
      if (node.closest && node.closest('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container, .mat-mdc-dialog-surface, [aria-modal="true"]')) return true;
      if (node.querySelector && node.querySelector('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container, .mat-mdc-dialog-surface')) return true;
      return false;
    };

    const menus = rawMenus.filter((m) => {
      if (!m) return false;
      if (isDialogNode(m)) return false;
      if (m.tagName.toLowerCase() === 'mat-menu-content') {
        const inner = m.querySelector('[role="menu"], .mat-mdc-menu-panel');
        if (inner) return false;
      }
      return true;
    });
    if (!menus.length) return;

    menuInjectGuard = true;
    try {
      menus.forEach((menu) => {
        if (!menu) return;

        // Strip previously injected items to avoid duplicates on menu re-opens
        menu.querySelectorAll('.gt-native-menu-item').forEach((el) => el.remove());
        menu.dataset.gtBound = '1';

        const items = Array.from(menu.querySelectorAll('[role="menuitem"], button, .mat-mdc-menu-item, [data-test-id*="delete"], [data-testid*="delete"], [aria-label*="delete" i], [aria-label*="Delete"]'));
        const deleteKeywords = [
          'delete', '删除', '刪除', '削除', 'löschen', 'eliminar', 'supprimer',
          'elimina', 'eliminare', 'excluir', 'deletar', 'apagar', '삭제', 'удалить',
          'удаление', 'हट', 'मिटा', 'حذف', 'sil', 'verwijderen', 'usuń', 'xóa', 'ลบ', 'hapus'
        ];
        const renameKeywords = ['rename', '重命名', '重新命名', '名前を変更', 'umbenennen', 'renombrar', 'renommer', 'rinomina', 'renomear', '이름 변경', 'переименовать'];
        const isConvMenu = items.some((el) => {
          const txt = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const testId = (el.getAttribute('data-test-id') || el.getAttribute('data-testid') || '').trim().toLowerCase();
          return deleteKeywords.some((kw) => txt.includes(kw) || aria.includes(kw) || testId.includes(kw)) ||
            renameKeywords.some((kw) => txt.includes(kw) || aria.includes(kw) || testId.includes(kw)) ||
            testId.includes('delete') || aria.includes('delete');
        });
        if (!isConvMenu) return;

        // Pin the target to the row whose menu is actually open.
        const trigger = getTriggerForMenu(menu);
        const targetConvId = resolveTriggerConvId(trigger);

        const moveItem = createEl('div', {
          class: 'gt-native-menu-item gt-native-menu-move',
          role: 'menuitem',
          dataset: { gtBound: '1' }
        }, [
          createEl('span', {
            class: 'gt-native-menu-icon',
            html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
          }),
          createEl('span', { text: 'Move to Folder' })
        ]);
        moveItem.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const liveTrigger = getTriggerForMenu(menu);
          const tid = resolveTriggerConvId(liveTrigger || trigger, menu) || targetConvId;
          if (!tid) { showToast("Couldn't determine the conversation"); return; }
          const rect = moveItem.getBoundingClientRect();
          const x = rect.left > 0 ? rect.left : window.innerWidth / 2;
          const y = rect.top > 0 ? rect.top : window.innerHeight / 2;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          setTimeout(() => showSelector(tid, x - 60, y + 10), 100);
        });

        const batchItem = createEl('div', {
          class: 'gt-native-menu-item gt-native-menu-batch',
          role: 'menuitem',
          dataset: { gtBound: '1' }
        }, [
          createEl('span', {
            class: 'gt-native-menu-icon',
            html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>'
          }),
          createEl('span', { text: 'Batch Select' })
        ]);
        batchItem.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          if (window.GTBatchDelete) window.GTBatchDelete.enter();
        });

        const deleteItem = items.find((el) => {
          const txt = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const testId = (el.getAttribute('data-test-id') || el.getAttribute('data-testid') || '').trim().toLowerCase();
          return deleteKeywords.some((kw) => txt.includes(kw) || aria.includes(kw) || testId.includes(kw)) ||
            testId.includes('delete') || aria.includes('delete');
        });

        if (deleteItem && deleteItem.parentNode) {
          deleteItem.parentNode.insertBefore(moveItem, deleteItem);
          deleteItem.parentNode.insertBefore(batchItem, deleteItem);
        } else {
          menu.appendChild(moveItem);
          menu.appendChild(batchItem);
        }
      });
    } finally {
      // Use microtask instead of setTimeout for faster guard reset
      Promise.resolve().then(() => { menuInjectGuard = false; });
    }
  }

  // ======================== Observers ========================

  function isOwnNode(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches && node.matches('#' + SECTION_ID + ', [data-gt-folder-ui], .gt-folder-selector-overlay, .gt-dialog-overlay, .gt-toast, .gt-folder-menu-overlay')) return true;
    if (node.closest) {
      return !!node.closest('#' + SECTION_ID + ', [data-gt-folder-ui], .gt-folder-selector-overlay, .gt-dialog-overlay, .gt-toast, .gt-folder-menu-overlay');
    }
    return false;
  }

  function mutationTouchesOwnUI(mutation) {
    if (isOwnNode(mutation.target)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every(isOwnNode);
  }

  // Sidebar-scoped mutation filter: only react to DOM changes that actually
  // touch the sidebar / conversation list area. This prevents the feedback
  // loop where every page-wide mutation (chat streaming, UI animations,
  // Gemini's own loading spinners) triggers a full folders re-render, which
  // in turn mutates the sidebar DOM and causes Gemini to never finish loading.
  // Ported from reference/cone-deck-for-gemini/organizer.js.
  function mutationTouchesSidebar(mutations) {
    return mutations.some((mutation) => {
      if (isOwnNode(mutation.target)) return false;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.some((node) => {
        if (!(node instanceof Element)) return false;
        if (isOwnNode(node)) return false;
        // Only care about sidebar-related structural changes
        return node.matches?.(
          'aside, nav, [role="navigation"], [role="list"], [role="listitem"], ' +
          '[data-testid*="sidebar"], [data-testid*="history"], [data-testid*="conversation"], ' +
          'infinite-scroller, [class*="conversation"], [class*="sidebar"], [class*="history"], [class*="scroll"]'
        ) || !!node.querySelector?.('a[href*="/app/"]');
      });
    });
  }

  const debouncedRender = debounce(scheduleRender, 250);

  // Theme watcher: re-render the folders UI whenever the active theme flips,
  // so the section follows dark/light. Two sources:
  //  (a) the extension's own panel toggle (gcn-panel[data-gcn-theme]) — observed
  //      directly for an immediate response;
  //  (b) Gemini's native dark mode (html/body class/style) — observed broadly;
  //      reRenderIfThemeChanged only fires a render when isDark() actually flips,
  //      so the high mutation volume is absorbed by the debounced idempotent render.
  function startThemeWatch() {
    let lastTheme = isDark();
    const reRenderIfThemeChanged = () => {
      const t = isDark();
      if (t !== lastTheme) { lastTheme = t; scheduleRender(); }
    };

    const watchPanel = () => {
      const panel = document.getElementById('gcn-panel');
      if (panel && !panel.dataset.gtThemeWatched) {
        panel.dataset.gtThemeWatched = '1';
        new MutationObserver(reRenderIfThemeChanged).observe(panel, {
          attributes: true, attributeFilter: ['data-gcn-theme']
        });
      }
    };
    watchPanel();

    const rootObserver = new MutationObserver(reRenderIfThemeChanged);
    const observeRoots = () => {
      try {
        if (document.documentElement) rootObserver.observe(document.documentElement, { attributes: true });
        if (document.body) rootObserver.observe(document.body, { attributes: true });
      } catch (e) { /* ignore */ }
    };
    observeRoots();
  }

  function startObservers() {
    window.addEventListener('dragend', resetDragState, true);
    window.addEventListener('mouseup', resetDragState, true);

    const observer = new MutationObserver((mutations) => {
      // CDK Overlay Menu Observer (F2.1): detect when CDK overlay or menu elements are added to document.body
      const touchesOverlay = mutations.some((m) => {
        const nodes = [...m.addedNodes, ...(m.target ? [m.target] : [])];
        return nodes.some((n) => n instanceof Element && (
          n.matches?.('.cdk-overlay-pane, .cdk-overlay-container, mat-menu-content, [role="menu"], .mat-mdc-menu-panel') ||
          !!n.querySelector?.('.cdk-overlay-pane, mat-menu-content, [role="menu"], .mat-mdc-menu-panel')
        ));
      });
      if (touchesOverlay) {
        tryInjectMenuItems();
      }

      if (!mutationTouchesSidebar(mutations)) return;
      invalidateAnchorCache();  // DOM changed → cache stale
      debouncedRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Unified watcher: merges theme detection, sidebar collapse detection,
    // and route change detection into a single interval to reduce timers.
    // Uses a counter to run route checks at a different frequency.
    let lastCollapsed = null;
    let lastThemeTick = null;
    let tickCount = 0;
    setInterval(() => {
      tickCount++;

      // Theme check (every tick)
      const themeNow = isDark();
      if (themeNow !== lastThemeTick) {
        lastThemeTick = themeNow;
        invalidateAnchorCache();
        scheduleRender();
      }

      // Route check (every 3rd tick ≈ 1200ms)
      if (tickCount % 3 === 0) {
        const routeKey = location.pathname + location.search;
        if (routeKey !== lastRouteKey) {
          lastRouteKey = routeKey;
          invalidateAnchorCache();
          scheduleRender();
        }
      }

      // Sidebar collapse check (fast path when expanded)
      if (sectionEl && document.contains(sectionEl) && lastCollapsed === false) {
        const parent = sectionEl.parentElement;
        const rect = parent ? parent.getBoundingClientRect() : null;
        const nowCollapsed = !rect || (rect.width > 0 && rect.width < 150);
        if (nowCollapsed !== lastCollapsed) {
          lastCollapsed = nowCollapsed;
          invalidateAnchorCache();
          scheduleRender();
        } else {
          lastCollapsed = nowCollapsed;
        }
        return;
      }

      // Full scan: section missing or was collapsed — need to re-discover.
      const anchors = getCachedAnchors();
      const listRoot = getListContainer(anchors);
      const collapsed = !listRoot || isSidebarCollapsed(listRoot);
      if (collapsed !== lastCollapsed || (!collapsed && (!sectionEl || !document.contains(sectionEl)))) {
        lastCollapsed = collapsed;
        invalidateAnchorCache();
        scheduleRender();
      } else {
        lastCollapsed = collapsed;
      }
    }, 800);  // Perf: relaxed from 400ms; event-driven mutation observer handles the fast path
  }

  // ======================== Public API & Boot ========================

  window.GTFolders = {
    refresh: scheduleRender,
    create: createFolder,
    assign,
    unassign,
    getState: () => JSON.parse(JSON.stringify(state)),
    syncTheme: () => {
      if (sectionEl && document.contains(sectionEl)) {
        applyThemeAttr(sectionEl);
        // Re-theme section and all child elements synchronously
        sectionEl.querySelectorAll('.gt-folder-row, .gt-folder-row-head, .gt-folder-convs, .gt-folder-conv, [data-gcn-theme], [data-gt-theme]').forEach(el => applyThemeAttr(el));
      }
    }
  };

  loadState().then(() => {
    startObservers();
    startThemeWatch();
    scheduleRender();
  });

})();
