/**
 * Gemini Chat Navigator - Content Script
 * Adds a navigation panel to jump between conversation turns
 *
 * Design: Glassmorphism - Milk White - Light & Minimal
 */

(function () {
  'use strict';

  // ======================== Config ========================
  const CONFIG = {
    TRUNCATE_LENGTH: 45,
    HIGHLIGHT_DURATION: 2000,
    PANEL_WIDTH: 232,
  };

  // ======================== Selectors ========================
  const SELECTORS = {
    USER_QUERY: 'user-query, USER-QUERY',
    SCROLL_CONTAINER: '.chat-history-scroll-container, #chat-history, .chat-history, main',
  };

  // ======================== State ========================
  let panelInjected = false;
  let isPanelExpanded = true;
  let isDarkMode = false;
  let scrollTimeout = null;
  let highlightTimer = null;
  let scrollObserver = null;
  let rafId = null;
  let targetIndex = -1;     // Target message index during programmatic scroll
  let isScrollingTo = false; // Whether we're programmatically scrolling

  // Cache DOM references
  let panelEl = null;
  let listContainer = null;
  let emptyHint = null;
  let cachedScrollContainer = null;
  let cachedUserMessageNodes = null;
  let cachedPreviewTooltip = null;

  // Observer references & state
  let mainMutationObserver = null;
  let observedContainer = null;
  let isFallbackToBody = false;

  // Event listener & timer cleanup references
  let activeScrollCleanup = null;
  let exportMenuTimeout = null;
  let exportMenuClickListener = null;
  let exportCancelFlag = false;
  let isExporting = false;
  let exportOverlayEl = null;

  // Nav items
  let navItems = [];
  let userMessages = [];
  let messageHash = '';
  let focusedNavIndex = -1; // Focused index for J/K keyboard navigation


  // ======================== Theme ========================

  function applyTheme() {
    const theme = isDarkMode ? 'dark' : 'light';
    if (panelEl) panelEl.setAttribute('data-gcn-theme', theme);
    const preview = getPreview();
    if (preview) preview.setAttribute('data-gcn-theme', theme);

    const batchToolbar = document.getElementById('gt-batch-floating-bar');
    if (batchToolbar) batchToolbar.setAttribute('data-gcn-theme', theme);

    // Sync both the legacy panel ID and the current section ID
    const foldersPanel = document.getElementById('gt-folders-panel');
    if (foldersPanel) foldersPanel.setAttribute('data-gcn-theme', theme);
    const foldersSection = document.getElementById('gt-folders-section');
    if (foldersSection) foldersSection.setAttribute('data-gcn-theme', theme);

    // Sync all folder-related overlays, dialogs, toasts, and selectors
    document.querySelectorAll(
      '.gt-dialog-overlay, .gcn-shortcuts-overlay, .gt-folder-selector-overlay, .gt-folder-menu-overlay, .gt-toast'
    ).forEach(el => {
      el.setAttribute('data-gcn-theme', theme);
      el.setAttribute('data-gt-theme', theme);
    });

    // Cross-module signal: notify the folders UI so it re-applies the theme.
    // syncTheme() applies immediately (no RAF delay); refresh() queues a full
    // render that also re-themes on the next animation frame.
    try {
      if (window.GTFolders) {
        if (window.GTFolders.syncTheme) window.GTFolders.syncTheme();
        if (window.GTFolders.refresh) window.GTFolders.refresh();
      }
    } catch (e) { /* ignore */ }
  }

  function toggleTheme() {
    isDarkMode = !isDarkMode;
    applyTheme();
    updateThemeButtonIcon();
    try { localStorage.setItem('gcn-theme-dark', isDarkMode ? 'true' : 'false'); } catch (e) {}
  }

  function updateThemeButtonIcon() {
    const btn = panelEl ? panelEl.querySelector('.gcn-theme-btn') : null;
    if (!btn) return;

    const sunIcon = btn.querySelector('.gcn-icon-sun');
    const moonIcon = btn.querySelector('.gcn-icon-moon');

    if (isDarkMode) {
      if (sunIcon) sunIcon.style.display = 'block';
      if (moonIcon) moonIcon.style.display = 'none';
      btn.title = 'Switch to light mode (Alt+T)';
    } else {
      if (sunIcon) sunIcon.style.display = 'none';
      if (moonIcon) moonIcon.style.display = 'block';
      btn.title = 'Switch to dark mode (Alt+T)';
    }
  }

  // ======================== Utilities ========================

  function getScrollContainer(forceRefresh = false) {
    if (forceRefresh || !cachedScrollContainer || !document.body.contains(cachedScrollContainer)) {
      cachedScrollContainer = document.querySelector(SELECTORS.SCROLL_CONTAINER);
    }
    return cachedScrollContainer;
  }

  function extractUserText(userQuery) {
    const el = userQuery.querySelector('.query-text-line');
    if (!el) return '';
    let text = el.textContent.trim();
    if (window.GTUtils && typeof window.GTUtils.cleanText === 'function') {
      text = window.GTUtils.cleanText(text);
    }
    if (window.GTUtils && typeof window.GTUtils.truncate === 'function') {
      return window.GTUtils.truncate(text, CONFIG.TRUNCATE_LENGTH);
    }
    if (text.length > CONFIG.TRUNCATE_LENGTH) {
      text = text.substring(0, CONFIG.TRUNCATE_LENGTH) + '...';
    }
    return text;
  }

  function escapeHtml(text) {
    if (window.GTUtils && typeof window.GTUtils.escapeHtml === 'function') {
      return window.GTUtils.escapeHtml(text);
    }
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text || '').replace(/[&<>"']/g, m => map[m]);
  }

  function getUserMessages(forceRefresh = false) {
    if (forceRefresh || !cachedUserMessageNodes || cachedUserMessageNodes.length === 0) {
      cachedUserMessageNodes = document.querySelectorAll(SELECTORS.USER_QUERY);
    }
    return cachedUserMessageNodes;
  }

  // ======================== Panel UI ========================

  function createPanel() {
    // ===== Idempotency guard =====
    // Multiple code paths can call createPanel():
    //   - init() (guarded by panelInjected, runs once)
    //   - handleRouteChange() (only runs when panelEl is missing from body)
    //   - MV3 content-script re-injection after extension reload while page is open
    //   - init() racing with the first handleRouteChange() before panelInjected flips
    // Without this guard, ANY of those paths can leave an orphaned #gcn-panel
    // in the DOM, which then renders as a duplicate "GEMINI TRACE" card.
    // Fix: if a panel already exists in the DOM, reuse it; purge any extra copies.
    const existingPanels = document.querySelectorAll('#gcn-panel');
    if (existingPanels.length > 1) {
      // Keep the FIRST one (oldest), remove the rest. This makes the guard
      // order-stable regardless of which path arrived first.
      for (let i = 1; i < existingPanels.length; i++) existingPanels[i].remove();
    }
    if (existingPanels[0]) {
      panelEl = existingPanels[0];
      listContainer = panelEl.querySelector('.gcn-message-list');
      emptyHint = panelEl.querySelector('.gcn-empty');
      // Re-bind listeners only if they were lost (defensive — usually idempotent).
      if (!panelEl.dataset.gcnBound) {
        panelEl.querySelector('.gcn-help-btn').addEventListener('click', toggleShortcutsModal);
        panelEl.querySelector('.gcn-toggle-btn').addEventListener('click', togglePanel);
        panelEl.querySelector('.gcn-theme-btn').addEventListener('click', toggleTheme);
        panelEl.querySelector('.gcn-export-btn').addEventListener('click', showExportMenu);
        panelEl.querySelector('.gcn-search-btn').addEventListener('click', toggleSearch);
        const searchInput = panelEl.querySelector('.gcn-search-input');
        searchInput.addEventListener('input', (e) => filterMessages(e.target.value));
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            toggleSearch();
            searchInput.value = '';
            filterMessages('');
          }
        });
        panelEl.dataset.gcnBound = '1';
      }
      return panelEl;
    }

    panelEl = document.createElement('div');
    panelEl.id = 'gcn-panel';
    panelEl.innerHTML = `
      <div class="gcn-header">
        <div class="gcn-header-top">
          <span class="gcn-title">Gemini Pilot</span>
          <span class="gcn-turn-badge" style="display: none;">0 Turns</span>
        </div>
        <div class="gcn-header-actions">
          <button class="gcn-help-btn" title="Keyboard shortcuts (?)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="12" height="8" rx="2"/>
              <path d="M3 6h.01M5.5 6h.01M8 6h.01M10.5 6h.01M3 8.5h.01M5.5 8.5h3M10.5 8.5h.01"/>
            </svg>
          </button>
          <button class="gcn-search-btn" title="Search messages (Ctrl+F)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="6" r="4"/>
              <path d="M9 9l3.5 3.5"/>
            </svg>
          </button>
          <button class="gcn-export-btn" title="Export conversation">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 1v8M4 6l3 3 3-3"/>
              <path d="M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2"/>
            </svg>
          </button>
          <button class="gcn-theme-btn" title="Theme toggle (Alt+T)">
            <svg class="gcn-icon-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            <svg class="gcn-icon-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
          <button class="gcn-toggle-btn" title="Collapse/Expand (Alt+N)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="gcn-toggle-icon">
              <path d="M4 6l4 4 4-4"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="gcn-search-bar" style="display: none;">
        <input type="text" class="gcn-search-input" placeholder="Search messages... (Esc to close)" />
        <span class="gcn-search-count"></span>
      </div>
      <div class="gcn-message-list"></div>
      <div class="gcn-empty">No messages yet<br>Start chatting to see navigation</div>
    `;
    document.body.appendChild(panelEl);

    listContainer = panelEl.querySelector('.gcn-message-list');
    emptyHint = panelEl.querySelector('.gcn-empty');

    panelEl.querySelector('.gcn-help-btn').addEventListener('click', toggleShortcutsModal);
    panelEl.querySelector('.gcn-toggle-btn').addEventListener('click', togglePanel);
    panelEl.querySelector('.gcn-theme-btn').addEventListener('click', toggleTheme);
    panelEl.querySelector('.gcn-export-btn').addEventListener('click', showExportMenu);
    panelEl.querySelector('.gcn-search-btn').addEventListener('click', toggleSearch);

    // Search input listener
    const searchInput = panelEl.querySelector('.gcn-search-input');
    searchInput.addEventListener('input', (e) => filterMessages(e.target.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleSearch();
        searchInput.value = '';
        filterMessages('');
      }
    });

    // Mark listeners as bound so the idempotent reuse path in createPanel()
    // does not bind a second time (which would fire handlers twice).
    panelEl.dataset.gcnBound = '1';

    if (window.GTUtils && typeof window.GTUtils.isDark === 'function') {
      isDarkMode = window.GTUtils.isDark();
    } else {
      try {
        if (localStorage.getItem('gcn-theme-dark') === 'true') {
          isDarkMode = true;
        }
      } catch (e) {}
    }

    applyTheme();
    updateThemeButtonIcon();

    // Create preview element appended to body (not panel)
    const preview = document.createElement('div');
    preview.id = 'gcn-preview';
    preview.className = 'gcn-preview';
    document.body.appendChild(preview);
    cachedPreviewTooltip = preview;

    return panelEl;
  }

  function togglePanel() {
    if (!panelEl) return;
    isPanelExpanded = !isPanelExpanded;
    panelEl.classList.toggle('gcn-collapsed', !isPanelExpanded);

    if (!isPanelExpanded) {
      const searchBar = panelEl.querySelector('.gcn-search-bar');
      const searchInput = panelEl.querySelector('.gcn-search-input');
      if (searchBar) searchBar.style.display = 'none';
      if (searchInput) {
        searchInput.value = '';
        filterMessages('');
      }
    }
  }

  // ======================== Render (Incremental Diff-and-Patch) ========================

  function createNavItem(idx) {
    const item = document.createElement('div');
    item.className = 'gcn-nav-item';
    item.innerHTML = `
      <span class="gcn-nav-index"></span>
      <span class="gcn-nav-content">
        <span class="gcn-nav-text"></span>
      </span>
      <button class="gcn-copy-btn" title="Copy prompt">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="6" height="6" rx="1"/>
          <path d="M2 8V2a1 1 0 011-1h6"/>
        </svg>
      </button>
    `;
    // Click handler uses live lookup (idx captured by closure is stable
    // because we only create items for new indices; existing items keep
    // their original closure index and are updated in-place).
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.gcn-copy-btn')) {
        updateFocusedNavItem(idx);
        let target = userMessages[idx]?.element;
        if (!target || !document.body.contains(target)) {
          const freshMessages = getUserMessages(true);
          if (freshMessages[idx]) {
            target = freshMessages[idx];
            if (userMessages[idx]) userMessages[idx].element = target;
          }
        }
        if (target) scrollToMessage(target, idx);
      }
    });
    // Copy button — fullText is read from userMessages at click-time
    item.querySelector('.gcn-copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const ft = userMessages[idx]?.fullText || '';
      copyPrompt(ft, e);
    });
    // Hover preview — live lookup
    item.addEventListener('mouseenter', (e) => {
      let target = userMessages[idx]?.element;
      if (!target || !document.body.contains(target)) {
        const freshMessages = getUserMessages(true);
        if (freshMessages[idx]) {
          target = freshMessages[idx];
          if (userMessages[idx]) userMessages[idx].element = target;
        }
      }
      if (target) showPreview(target, e);
    });
    item.addEventListener('mouseleave', hidePreview);
    return item;
  }

  function updateNavItemContent(item, idx, text) {
    const indexEl = item.querySelector('.gcn-nav-index');
    const textEl = item.querySelector('.gcn-nav-text');
    if (indexEl && indexEl.textContent !== String(idx + 1)) indexEl.textContent = idx + 1;
    const escaped = escapeHtml(text);
    if (textEl && textEl.innerHTML !== escaped) textEl.innerHTML = escaped;
  }

  function renderMessageList(force = false) {
    const messages = getUserMessages(force);

    // Include location.pathname in hash to ensure re-render on conversation switch
    const firstText = messages[0] ? (messages[0].textContent || '').trim().substring(0, 30) : '';
    const newHash = `${messages.length}_${firstText}_${location.pathname}`;
    if (!force && newHash === messageHash) return;
    messageHash = newHash;

    const turnBadge = panelEl ? panelEl.querySelector('.gcn-turn-badge') : null;
    if (turnBadge) {
      if (messages.length === 0) {
        turnBadge.style.display = 'none';
      } else {
        turnBadge.style.display = 'inline-flex';
        turnBadge.textContent = messages.length === 1 ? '1 Turn' : `${messages.length} Turns`;
      }
    }

    if (messages.length === 0) {
      // Full clear only when truly empty
      if (navItems.length > 0) {
        listContainer.innerHTML = '';
        navItems = [];
        userMessages = [];
      }
      emptyHint.style.display = 'block';
      return;
    }
    emptyHint.style.display = 'none';

    // --- Incremental diff-and-patch ---
    const prevLen = navItems.length;
    const newLen = messages.length;

    // 1. Update existing items in-place (reuse DOM + event listeners)
    const updateEnd = Math.min(prevLen, newLen);
    for (let i = 0; i < updateEnd; i++) {
      const msg = messages[i];
      const fullText = msg.querySelector('.query-text-line')?.textContent.trim() || extractUserText(msg);
      const text = extractUserText(msg);
      updateNavItemContent(navItems[i], i, text);
      userMessages[i] = { element: msg, text, fullText, index: i };
    }

    // 2. Append new items if messages grew
    if (newLen > prevLen) {
      const fragment = document.createDocumentFragment();
      for (let i = prevLen; i < newLen; i++) {
        const msg = messages[i];
        const fullText = msg.querySelector('.query-text-line')?.textContent.trim() || extractUserText(msg);
        const text = extractUserText(msg);
        const item = createNavItem(i);
        updateNavItemContent(item, i, text);
        fragment.appendChild(item);
        navItems.push(item);
        userMessages[i] = { element: msg, text, fullText, index: i };
      }
      listContainer.appendChild(fragment);
    }

    // 3. Remove excess items if messages shrank
    if (newLen < prevLen) {
      for (let i = prevLen - 1; i >= newLen; i--) {
        navItems[i].remove();
      }
      navItems.length = newLen;
      userMessages.length = newLen;
    }

    // Update top-right turn badge (always safe now — progress bar is on document.body, not in panel)
    const badge = panelEl ? panelEl.querySelector('.gcn-turn-badge') : null;
    if (badge) {
      badge.textContent = `${newLen} Turns`;
      badge.style.display = newLen > 0 ? 'inline-flex' : 'none';
    }

    updateLoadEarlierButton();
  }

  function showToast(msg) {
    if (!msg) return;
    document.querySelectorAll('.gt-toast').forEach((el) => el.remove());
    const theme = isDarkMode ? 'dark' : 'light';
    const toast = document.createElement('div');
    toast.className = 'gt-toast';
    toast.setAttribute('data-gcn-theme', theme);
    toast.setAttribute('data-gt-theme', theme);
    const span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, 10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  function updateLoadEarlierButton() {
    if (!listContainer) return;
    let loadBtn = listContainer.querySelector('.gcn-load-earlier-btn');
    const messages = getUserMessages();
    
    // Gemini virtualizes history only on long conversations (typically 8+ turns).
    // Short conversations (e.g. <= 7 turns) have all messages mounted on load.
    const MIN_VIRTUAL_THRESHOLD = 8;

    if (messages.length >= MIN_VIRTUAL_THRESHOLD) {
      if (!loadBtn) {
        loadBtn = document.createElement('button');
        loadBtn.className = 'gcn-load-earlier-btn';
        loadBtn.title = 'Click to scroll up and load earlier conversation turns';
        loadBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 12V4M4 8l4-4 4 4"/>
          </svg>
          <span>Load Earlier Turns</span>
        `;
        loadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (loadBtn.classList.contains('gcn-loading')) return;

          const msgs = getUserMessages();
          if (msgs.length === 0 || !msgs[0]) return;

          const firstMsg = msgs[0];
          const container = getScrollContainer();
          const initialCount = msgs.length;

          // Determine if the user is ALREADY at the top message BEFORE triggering scroll
          const scrollTop = container ? container.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
          const rect = firstMsg.getBoundingClientRect();
          const wasAlreadyAtTop = (scrollTop <= 30) || (rect.top >= 0 && rect.top <= 350);

          // Scroll page to the top message
          firstMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (container) container.scrollTop = 0;

          // If user was NOT at top message (e.g. scrolled down reading later messages),
          // scroll to top was executed to bring them to earlier messages — DO NOT show toast.
          if (!wasAlreadyAtTop) {
            return;
          }

          // If user WAS ALREADY at the top message, test if Gemini can fetch more history from Google servers.
          // Show loading state on button while waiting for network / DOM lazy loading (2.0s polling window).
          loadBtn.classList.add('gcn-loading');
          loadBtn.innerHTML = `
            <svg class="gcn-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <span>Loading earlier turns...</span>
          `;

          const restoreButton = () => {
            loadBtn.classList.remove('gcn-loading');
            loadBtn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 12V4M4 8l4-4 4 4"/>
              </svg>
              <span>Load Earlier Turns</span>
            `;
          };

          let elapsedTime = 0;
          const checkInterval = setInterval(() => {
            elapsedTime += 300;
            const currentMsgs = getUserMessages();

            // If new earlier messages arrived from Google server:
            if (currentMsgs.length > initialCount) {
              clearInterval(checkInterval);
              restoreButton();
              return;
            }

            // If 2000ms passed and ZERO new messages arrived: all history is 100% loaded!
            if (elapsedTime >= 2000) {
              clearInterval(checkInterval);
              restoreButton();
              // THIS IS TRULY THE VERY FIRST PROMPT OF THE ENTIRE CONVERSATION!
              showToast('Already at the first prompt');
            }
          }, 300);
        });
        listContainer.insertBefore(loadBtn, listContainer.firstChild);
      }
    } else if (loadBtn) {
      loadBtn.remove();
    }
  }

  // ======================== Preview Tooltip ========================

  function extractFullContent(msg) {
    // Extract full text from all query-text-line elements in the entire message
    const textLines = msg.querySelectorAll('.query-text-line');
    let text = '';
    textLines.forEach(line => {
      const cls = line.className || '';
      if (/cdk-visually-hidden|screen-reader/i.test(cls)) return;
      text += line.textContent.trim() + '\n';
    });

    // Extract images from the entire message (not just query-content)
    const images = [];
    const imgElements = msg.querySelectorAll('img[data-test-id="uploaded-img"], .preview-image, .query-file-preview img');
    imgElements.forEach(img => {
      if (img.src && !img.src.startsWith('data:')) {
        images.push(img.src);
      }
    });

    return { text: text.trim(), images };
  }

  let previewTimeout = null;

  function getPreview() {
    if (!cachedPreviewTooltip || !document.body.contains(cachedPreviewTooltip)) {
      cachedPreviewTooltip = document.getElementById('gcn-preview');
    }
    return cachedPreviewTooltip;
  }

  function updatePreviewPosition(navItem, clientY) {
    const preview = getPreview();
    if (!preview || preview.style.display === 'none') return;

    const panelRect = panelEl ? panelEl.getBoundingClientRect() : { left: window.innerWidth - 248 };
    const itemRect = navItem ? navItem.getBoundingClientRect() : null;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Enforce max height constraint
    const maxAvailableHeight = viewportHeight - 32;
    preview.style.maxHeight = `${maxAvailableHeight}px`;

    // Measure exact outer height & width using offsetHeight/offsetWidth (accounts for border-box)
    const previewHeight = preview.offsetHeight || preview.getBoundingClientRect().height;
    const previewWidth = preview.offsetWidth || preview.getBoundingClientRect().width;

    // Horizontal positioning: default to left of panel with 12px gap
    let leftPos = panelRect.left - previewWidth - 12;
    if (leftPos < 16) {
      leftPos = 16;
    }

    // Vertical positioning: align center with hovered item
    let idealTop = itemRect ? (itemRect.top + itemRect.height / 2 - previewHeight / 2) : ((clientY || 100) - 80);

    // Strictly clamp top position so topPos >= 16 and topPos + previewHeight <= viewportHeight - 16
    let topPos = Math.max(16, Math.min(idealTop, viewportHeight - previewHeight - 16));

    preview.style.left = `${leftPos}px`;
    preview.style.top = `${topPos}px`;
    preview.style.right = 'auto';
  }

  function showPreview(msg, event) {
    if (previewTimeout) clearTimeout(previewTimeout);
    const navItem = event.currentTarget;
    const clientY = event.clientY;
    previewTimeout = setTimeout(() => {
      const preview = getPreview();
      if (!preview) return;

      const { text, images } = extractFullContent(msg);

      if (!text && images.length === 0) {
        hidePreview();
        return;
      }

      let html = `<div class="gcn-preview-text">${escapeHtml(text)}</div>`;
      if (images.length > 0) {
        html += `<div class="gcn-preview-images">`;
        images.forEach(src => {
          html += `<img src="${src}" class="gcn-preview-img" />`;
        });
        html += `</div>`;
      }

      preview.innerHTML = html;
      preview.setAttribute('data-gcn-theme', isDarkMode ? 'dark' : 'light');

      // Make visible first
      preview.style.position = 'fixed';
      preview.style.display = 'block';

      // Perform initial positioning
      updatePreviewPosition(navItem, clientY);

      // Re-position when images finish loading to prevent post-load height expansion offscreen
      const imgs = preview.querySelectorAll('img');
      imgs.forEach(img => {
        if (!img.complete) {
          img.addEventListener('load', () => updatePreviewPosition(navItem, clientY), { once: true });
        }
      });
    }, 150);
  }

  function hidePreview() {
    if (previewTimeout) {
      clearTimeout(previewTimeout);
      previewTimeout = null;
    }
    const preview = getPreview();
    if (preview) {
      preview.style.display = 'none';
    }
  }

  // ======================== Shortcuts Cheat Sheet Modal (UI UX Pro Max) ========================

  function createShortcutsModal() {
    let modal = document.getElementById('gcn-shortcuts-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'gcn-shortcuts-modal';
    modal.className = 'gcn-shortcuts-overlay';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="gcn-shortcuts-card">
        <div class="gcn-shortcuts-header">
          <div class="gcn-shortcuts-title-group">
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="12" height="8" rx="2"/>
              <path d="M3 6h.01M5.5 6h.01M8 6h.01M10.5 6h.01M3 8.5h.01M5.5 8.5h3M10.5 8.5h.01"/>
            </svg>
            <span class="gcn-shortcuts-title">Keyboard Shortcuts</span>
          </div>
          <button class="gcn-shortcuts-close" title="Close (?)">&times;</button>
        </div>
        <div class="gcn-shortcuts-body">
          <div class="gcn-shortcuts-section">
            <div class="gcn-shortcuts-section-title">Navigation (Outlines)</div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Move Focus Down</span>
              <div class="gcn-shortcuts-keys"><kbd>J</kbd> <span class="gcn-shortcuts-or">or</span> <kbd>↓</kbd></div>
            </div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Move Focus Up</span>
              <div class="gcn-shortcuts-keys"><kbd>K</kbd> <span class="gcn-shortcuts-or">or</span> <kbd>↑</kbd></div>
            </div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Scroll to Focused Prompt</span>
              <div class="gcn-shortcuts-keys"><kbd>Enter</kbd></div>
            </div>
          </div>

          <div class="gcn-shortcuts-section">
            <div class="gcn-shortcuts-section-title">Quick Actions</div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Search / Filter</span>
              <div class="gcn-shortcuts-keys"><kbd>Ctrl</kbd><kbd>F</kbd> <span class="gcn-shortcuts-or">or</span> <kbd>/</kbd></div>
            </div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Toggle Panel</span>
              <div class="gcn-shortcuts-keys"><kbd>Alt</kbd><kbd>N</kbd></div>
            </div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Toggle Theme</span>
              <div class="gcn-shortcuts-keys"><kbd>Alt</kbd><kbd>T</kbd></div>
            </div>
            <div class="gcn-shortcuts-row">
              <span class="gcn-shortcuts-label">Toggle Shortcuts Guide</span>
              <div class="gcn-shortcuts-keys"><kbd>?</kbd> <span class="gcn-shortcuts-or">or</span> <kbd>Shift</kbd><kbd>/</kbd></div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.gcn-shortcuts-close').addEventListener('click', hideShortcutsModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideShortcutsModal();
    });

    return modal;
  }

  function toggleShortcutsModal() {
    const modal = createShortcutsModal();
    if (!modal) return;
    if (modal.style.display === 'flex') {
      hideShortcutsModal();
    } else {
      showShortcutsModal();
    }
  }

  function showShortcutsModal() {
    const modal = createShortcutsModal();
    if (!modal) return;
    modal.setAttribute('data-gcn-theme', isDarkMode ? 'dark' : 'light');
    modal.style.display = 'flex';
  }

  function hideShortcutsModal() {
    const modal = document.getElementById('gcn-shortcuts-modal');
    if (modal) modal.style.display = 'none';
  }

  // ======================== Export ========================

  /**
   * Convert Gemini response HTML node into clean, properly formatted Markdown.
   * - Restores KaTeX / MathJax math formulas into $inline$ and $$block$$ LaTeX syntax
   * - Preserves code blocks (```lang ... ```)
   * - Converts HTML tables into Markdown tables (| ... |)
   * - Strips UI toolbars, action buttons, and speaker labels
   */
  function convertGeminiElementToMarkdown(element) {
    if (!element) return '';

    const clone = element.cloneNode(true);

    // 1. Strip UI controls (headers, buttons, copy buttons, toolbars, feedback controls)
    clone.querySelectorAll('header, button, svg, [class*="header"], [class*="speaker"], [class*="title"], [class*="actions"], [class*="toolbar"], .code-block-decoration, .copy-code-button, response-element-actions').forEach(el => el.remove());

    // 2. Convert display (block) math equations (.katex-display, math-tex[block], [data-math-type="block"])
    clone.querySelectorAll('.katex-display, math-tex[block], [data-math-type="block"]').forEach(displayMathNode => {
      let tex = '';
      const annotation = displayMathNode.querySelector('annotation');
      if (annotation && annotation.textContent.trim()) {
        tex = annotation.textContent.trim();
      } else if (displayMathNode.getAttribute('data-tex')) {
        tex = displayMathNode.getAttribute('data-tex').trim();
      } else if (displayMathNode.getAttribute('aria-label')) {
        tex = displayMathNode.getAttribute('aria-label').trim();
      } else {
        tex = displayMathNode.textContent.trim();
      }
      
      const mathTextNode = document.createTextNode(`\n\n$$\n${tex}\n$$\n\n`);
      displayMathNode.parentNode.replaceChild(mathTextNode, displayMathNode);
    });

    // 3. Convert inline math equations (.katex, math-tex, [data-math-type="inline"])
    clone.querySelectorAll('.katex, math-tex, [data-math-type="inline"]').forEach(inlineMathNode => {
      let tex = '';
      const annotation = inlineMathNode.querySelector('annotation');
      if (annotation && annotation.textContent.trim()) {
        tex = annotation.textContent.trim();
      } else if (inlineMathNode.getAttribute('data-tex')) {
        tex = inlineMathNode.getAttribute('data-tex').trim();
      } else if (inlineMathNode.getAttribute('aria-label')) {
        tex = inlineMathNode.getAttribute('aria-label').trim();
      } else {
        tex = inlineMathNode.textContent.trim();
      }

      const mathTextNode = document.createTextNode(` $${tex}$ `);
      inlineMathNode.parentNode.replaceChild(mathTextNode, inlineMathNode);
    });

    // 4. Convert code blocks (<pre><code>)
    clone.querySelectorAll('pre').forEach(preNode => {
      const codeNode = preNode.querySelector('code');
      const langClass = codeNode ? (codeNode.className || '') : '';
      const langMatch = langClass.match(/language-([a-zA-Z0-9_+-]+)/);
      const lang = langMatch ? langMatch[1] : '';
      const codeText = codeNode ? codeNode.textContent : preNode.textContent;

      const codeBlockNode = document.createTextNode(`\n\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`);
      preNode.parentNode.replaceChild(codeBlockNode, preNode);
    });

    // 5. Convert tables (<table>)
    clone.querySelectorAll('table').forEach(tableNode => {
      const rows = Array.from(tableNode.querySelectorAll('tr'));
      if (rows.length === 0) return;

      let mdTable = '\n\n';
      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map(c => c.textContent.trim().replace(/\|/g, '\\|'));
        mdTable += '| ' + cells.join(' | ') + ' |\n';
        if (rowIndex === 0) {
          mdTable += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        }
      });
      mdTable += '\n';

      const tableTextNode = document.createTextNode(mdTable);
      tableNode.parentNode.replaceChild(tableTextNode, tableNode);
    });

    // Extract text from modified clone
    let result = clone.innerText || clone.textContent || '';

    // Clean up excessive blank lines (more than 2 consecutive newlines)
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result;
  }

  function extractResponseText(respNode) {
    if (!respNode) return '';

    const bodyEl = respNode.querySelector('.markdown, message-content, .message-content, [class*="markdown"], [class*="message-content"]') || respNode;
    return convertGeminiElementToMarkdown(bodyEl);
  }

  function getConversationData() {
    const messages = getUserMessages();
    const data = [];

    messages.forEach((msg, idx) => {
      const text = extractUserText(msg);

      // Extract uploaded user images
      const images = [];
      const imgElements = msg.querySelectorAll('img[data-test-id="uploaded-img"], .preview-image');
      imgElements.forEach(img => {
        if (img.src && !img.src.startsWith('data:')) {
          images.push(img.src);
        }
      });

      // Extract corresponding AI model response if present
      let responseText = '';
      let respNode = null;
      const scrollContainer = getScrollContainer();

      // 1. Check if msg is inside a dedicated turn wrapper containing model-response
      let parent = msg.parentElement;
      while (parent && parent !== document.body && parent !== scrollContainer) {
        if (parent.querySelectorAll(SELECTORS.USER_QUERY).length > 1) {
          break;
        }
        const found = parent.querySelector('model-response');
        if (found) {
          respNode = found;
          break;
        }
        parent = parent.parentElement;
      }

      // 2. If no dedicated turn wrapper was found, search adjacent sibling nodes (nextElementSibling)
      if (!respNode) {
        let curr = msg;
        while (curr && curr !== document.body && curr !== scrollContainer && !respNode) {
          let sibling = curr.nextElementSibling;
          while (sibling) {
            if (sibling.matches?.(SELECTORS.USER_QUERY) || sibling.querySelector?.(SELECTORS.USER_QUERY)) {
              break;
            }
            if (sibling.tagName && sibling.tagName.toLowerCase() === 'model-response') {
              respNode = sibling;
              break;
            }
            const found = sibling.querySelector?.('model-response');
            if (found) {
              respNode = found;
              break;
            }
            sibling = sibling.nextElementSibling;
          }
          if (respNode) break;
          curr = curr.parentElement;
        }
      }

      if (respNode) {
        responseText = extractResponseText(respNode);
      }

      data.push({
        index: idx + 1,
        role: 'user',
        text: text,
        images: images,
        response: responseText
      });
    });

    return data;
  }

  function exportAsMarkdown() {
    hideExportMenu();
    collectFullConversation('md');
  }

  function exportAsJSON() {
    hideExportMenu();
    collectFullConversation('json');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function hideExportMenu() {
    if (exportMenuTimeout) {
      clearTimeout(exportMenuTimeout);
      exportMenuTimeout = null;
    }
    if (exportMenuClickListener) {
      document.removeEventListener('click', exportMenuClickListener);
      exportMenuClickListener = null;
    }
    const menu = document.getElementById('gcn-export-menu');
    if (menu) menu.remove();
  }

  function showExportMenu() {
    // Remove existing menu if any
    hideExportMenu();

    const menu = document.createElement('div');
    menu.id = 'gcn-export-menu';
    menu.className = 'gcn-export-menu';
    menu.innerHTML = `
      <button class="gcn-export-option" data-format="md">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2"/><path d="M7 1v8M4 6l3 3 3-3"/></svg>
        Export as Markdown
      </button>
      <button class="gcn-export-option" data-format="json">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2"/><path d="M7 1v8M4 6l3 3 3-3"/></svg>
        Export as JSON
      </button>
    `;

    document.body.appendChild(menu);

    // Position menu (fixed to viewport, not clipped by panel overflow:hidden)
    const btn = panelEl.querySelector('.gcn-export-btn');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.right = `${window.innerWidth - rect.right}px`;
    }

    // Event listeners
    menu.querySelectorAll('.gcn-export-option').forEach(option => {
      option.addEventListener('click', () => {
        const format = option.dataset.format;
        if (format === 'md') exportAsMarkdown();
        else if (format === 'json') exportAsJSON();
      });
    });

    // Close on outside click with leak prevention
    exportMenuClickListener = (e) => {
      const m = document.getElementById('gcn-export-menu');
      if (m && !m.contains(e.target) && !e.target.closest('.gcn-export-btn')) {
        hideExportMenu();
      }
    };

    exportMenuTimeout = setTimeout(() => {
      exportMenuTimeout = null;
      if (exportMenuClickListener) {
        document.addEventListener('click', exportMenuClickListener, { once: true });
      }
    }, 100);
  }

  // ======================== Full Conversation Export (Auto-Scroll Collection) ========================

  /**
   * Extract all currently visible user-query + model-response pairs from the DOM
   * in exact top-to-bottom order.
   */
  function getVisibleDOMTurns() {
    const messages = getUserMessages(true);
    const result = [];

    messages.forEach((msg) => {
      // Extract full user text
      const textLines = msg.querySelectorAll('.query-text-line');
      let userText = '';
      textLines.forEach(line => {
        const cls = line.className || '';
        if (/cdk-visually-hidden|screen-reader/i.test(cls)) return;
        userText += line.textContent.trim() + '\n';
      });
      userText = userText.trim();
      if (window.GTUtils && typeof window.GTUtils.cleanText === 'function') {
        userText = window.GTUtils.cleanText(userText);
      }

      // Extract uploaded user images
      const images = [];
      const imgElements = msg.querySelectorAll('img[data-test-id="uploaded-img"], .preview-image');
      imgElements.forEach(img => {
        if (img.src && !img.src.startsWith('data:')) {
          images.push(img.src);
        }
      });

      // Extract corresponding AI model response
      let responseText = '';
      let respNode = null;

      // 1. Check if msg is inside a dedicated turn wrapper containing model-response
      let parent = msg.parentElement;
      while (parent && parent !== document.body) {
        if (parent.querySelectorAll(SELECTORS.USER_QUERY).length > 1) break;
        const found = parent.querySelector('model-response');
        if (found) { respNode = found; break; }
        parent = parent.parentElement;
      }

      // 2. If no dedicated turn wrapper, search adjacent siblings
      if (!respNode) {
        let curr = msg;
        while (curr && curr !== document.body && !respNode) {
          let sibling = curr.nextElementSibling;
          while (sibling) {
            if (sibling.matches?.(SELECTORS.USER_QUERY) || sibling.querySelector?.(SELECTORS.USER_QUERY)) break;
            if (sibling.tagName && sibling.tagName.toLowerCase() === 'model-response') {
              respNode = sibling;
              break;
            }
            const found = sibling.querySelector?.('model-response');
            if (found) { respNode = found; break; }
            sibling = sibling.nextElementSibling;
          }
          if (respNode) break;
          curr = curr.parentElement;
        }
      }

      if (respNode) {
        responseText = extractResponseText(respNode);
      }

      if (userText || responseText) {
        result.push({
          userText,
          responseText,
          images,
          timestamp: Date.now()
        });
      }
    });

    return result;
  }

  /**
   * Sequence Alignment Engine:
   * Merges visible DOM turns into collectedTurns (maintained in chronological order: Turn 1..Turn N).
   * Finds sequence overlap where trailing elements of visibleTurns align with leading elements of collectedTurns,
   * prepending only genuinely new turns above collectedTurns[0], while enriching response text on overlapping turns.
   */
  function mergeSequenceTurns(collectedTurns, visibleTurns) {
    if (!visibleTurns || visibleTurns.length === 0) return 0;

    if (collectedTurns.length === 0) {
      collectedTurns.push(...visibleTurns);
      return visibleTurns.length;
    }

    function turnsMatch(v, c) {
      if (!v || !c) return false;
      if (v.userText && c.userText && v.userText === c.userText) {
        return true;
      }
      if (!v.userText && !c.userText && v.responseText && c.responseText) {
        return v.responseText.substring(0, 50) === c.responseText.substring(0, 50);
      }
      return false;
    }

    // Find the overlap index in visibleTurns that aligns with collectedTurns[0]
    let overlapIdx = -1;
    for (let i = visibleTurns.length - 1; i >= 0; i--) {
      if (turnsMatch(visibleTurns[i], collectedTurns[0])) {
        overlapIdx = i;
        break;
      }
    }

    let addedCount = 0;

    if (overlapIdx >= 0) {
      const newItems = visibleTurns.slice(0, overlapIdx);
      if (newItems.length > 0) {
        collectedTurns.unshift(...newItems);
        addedCount = newItems.length;
      }

      // Enrich overlapping items with fuller AI responses if available
      for (let i = overlapIdx; i < visibleTurns.length; i++) {
        const targetIdx = i - overlapIdx;
        if (targetIdx < collectedTurns.length) {
          const v = visibleTurns[i];
          const c = collectedTurns[targetIdx];
          if (v.responseText && v.responseText.length > (c.responseText ? c.responseText.length : 0)) {
            c.responseText = v.responseText;
          }
          if (v.images && v.images.length > (c.images ? c.images.length : 0)) {
            c.images = v.images;
          }
        }
      }
    } else {
      // Fallback: search for any overlap with collectedTurns
      let matchedVisibleIdx = -1;
      let matchedCollectedIdx = -1;

      for (let i = 0; i < visibleTurns.length; i++) {
        for (let j = 0; j < collectedTurns.length; j++) {
          if (turnsMatch(visibleTurns[i], collectedTurns[j])) {
            matchedVisibleIdx = i;
            matchedCollectedIdx = j;
            break;
          }
        }
        if (matchedVisibleIdx >= 0) break;
      }

      if (matchedVisibleIdx >= 0 && matchedCollectedIdx >= 0) {
        const newItems = visibleTurns.slice(0, matchedVisibleIdx);
        if (newItems.length > 0) {
          collectedTurns.splice(matchedCollectedIdx, 0, ...newItems);
          addedCount = newItems.length;
        }
      }
    }

    return addedCount;
  }

  /**
   * Show a premium persistent fixed-position progress bar at screen bottom center.
   * Features: animated shimmer stripe, cycling status text, cancel button.
   */
  function showExportProgressOverlay() {
    hideExportProgressOverlay();

    isExporting = true;

    const theme = isDarkMode ? 'dark' : 'light';
    const bar = document.createElement('div');
    bar.id = 'gcn-export-progress-bar';
    bar.className = 'gcn-export-progress-bar';
    bar.setAttribute('data-gcn-theme', theme);
    bar.innerHTML = `
      <div class="gcn-export-bar-left">
        <div class="gcn-export-bar-dots">
          <span class="gcn-dot"></span><span class="gcn-dot"></span><span class="gcn-dot"></span>
        </div>
        <span class="gcn-export-bar-text">Loading conversation history...</span>
      </div>
      <button class="gcn-export-bar-cancel" title="Cancel export">&times;</button>
      <div class="gcn-export-bar-shimmer"></div>
    `;

    document.body.appendChild(bar);
    exportModalEl = bar;

    // Cancel button
    bar.querySelector('.gcn-export-bar-cancel').addEventListener('click', (e) => {
      e.stopPropagation();
      exportCancelFlag = true;
    });
  }

  /**
   * Update dynamic status text in the persistent bottom progress bar.
   */
  function updateExportProgressOverlay(text) {
    if (!exportModalEl || !isExporting) return;
    const textEl = exportModalEl.querySelector('.gcn-export-bar-text');
    if (textEl && text) {
      textEl.textContent = text;
    }
  }

  /**
   * Remove the persistent bottom progress bar with a smooth exit animation.
   */
  function hideExportProgressOverlay() {
    isExporting = false;

    if (exportModalEl) {
      exportModalEl.style.opacity = '0';
      exportModalEl.style.transform = 'translateX(-50%) translateY(10px)';
      const el = exportModalEl;
      setTimeout(() => el.remove(), 300);
      exportModalEl = null;
    }
    // Fallback cleanup
    const existing = document.getElementById('gcn-export-progress-bar');
    if (existing) existing.remove();
    const oldBar = document.getElementById('gcn-panel-export-bar');
    if (oldBar) oldBar.remove();
  }

  /**
   * Find Gemini's scrollable chat container using scoring system.
   * Returns the element that actually has overflow scroll behavior.
   */
  function findGeminiScrollContainer() {
    const candidates = [
      '.chat-scrollable-container',
      '.chat-history-scroll-container',
      '[data-test-id="chat-history-container"]',
      '.chat-history',
      '#chat-history',
      'mat-sidenav-content',
      'main',
    ];

    let best = null;
    let bestScore = -1;

    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.scrollHeight <= el.clientHeight) continue;

      let score = 0;
      // Higher scrollHeight delta = more likely the real container
      score += (el.scrollHeight - el.clientHeight) / 1000;
      // Contains chat markers
      if (el.querySelector('user-query, USER-QUERY, model-response')) score += 10;
      // Covers most of viewport
      const rect = el.getBoundingClientRect();
      const vhCoverage = (rect.height / window.innerHeight);
      if (vhCoverage > 0.5) score += 5;
      // Has overflowY auto/scroll
      const style = getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') score += 15;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  /**
   * Scroll jiggle: repeatedly set scrollTop to trigger Gemini's lazy loading.
   * A single scroll is often insufficient — Gemini needs multiple "nudges".
   */
  function scrollJiggle(container, targetTop, times = 3) {
    for (let i = 0; i < times; i++) {
      container.scrollTop = targetTop;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }

  /**
   * Click any "Load More" / "Show More" buttons that Gemini may render.
   */
  function clickLoadMoreButtons() {
    const buttons = document.querySelectorAll('button, [role="button"], a, span, div');
    const moreRegex = /more|load|show|加载|更多|展开|previous|earlier/i;
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      if (moreRegex.test(text) && btn.offsetParent !== null) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Core async auto-scroll collection engine.
   * Phase 1: Smoothly scrolls up to force Gemini to load all conversation nodes into the DOM.
   * Phase 2: Performs a single, one-pass scrape over document.querySelectorAll(SELECTORS.USER_QUERY),
   * guaranteeing an exact 1-to-1 match with the DOM (0 duplicates, 0 missing).
   */
  async function collectFullConversation(format) {
    exportCancelFlag = false;
    showExportProgressOverlay();

    // Dynamic Watchdog Timer: resets whenever new DOM nodes arrive,
    // allowing ultra-long conversations (300+ turns) to complete fully,
    // while guarding against true freezes (60s without new node arrivals).
    let safetyTimer = null;
    const resetSafetyTimer = () => {
      if (safetyTimer) clearTimeout(safetyTimer);
      safetyTimer = setTimeout(() => {
        if (exportModalEl) {
          exportCancelFlag = true;
        }
      }, 60000);
    };
    resetSafetyTimer();

    // Find the real scroll container
    const container = findGeminiScrollContainer();
    if (!container) {
      hideExportProgressOverlay();
      showToast('Error: Could not find chat scroll container');
      if (safetyTimer) clearTimeout(safetyTimer);
      return;
    }

    // Save initial scroll position for restoration
    const initialScrollTop = container.scrollTop;

    // --- PHASE 1: Scroll up to force Gemini to load all conversation turns into the DOM ---
    let lastDomCount = 0;
    let sameCountRounds = 0;

    while (sameCountRounds < 4 && !exportCancelFlag) {
      const currentNodes = document.querySelectorAll(SELECTORS.USER_QUERY);
      const currentCount = currentNodes.length;
      updateExportProgressOverlay('Loading conversation history...');

      if (currentCount > lastDomCount) {
        lastDomCount = currentCount;
        sameCountRounds = 0;
        resetSafetyTimer(); // Active progress: reset watchdog timer!
      } else {
        sameCountRounds++;
      }

      if (currentNodes.length > 0) {
        const firstMsg = currentNodes[0];
        firstMsg.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      clickLoadMoreButtons();

      await new Promise(r => setTimeout(r, 800));
    }

    // --- PHASE 2: One-Pass Scrape over the exact DOM nodes (0 duplicates, 0 missing) ---
    const finalUserNodes = document.querySelectorAll(SELECTORS.USER_QUERY);
    const collectedTurns = [];

    for (let i = 0; i < finalUserNodes.length; i++) {
      if (exportCancelFlag) break;

      const msgNode = finalUserNodes[i];

      // Extract user text
      const textLines = msgNode.querySelectorAll('.query-text-line');
      let userText = '';
      textLines.forEach(line => {
        const cls = line.className || '';
        if (/cdk-visually-hidden|screen-reader/i.test(cls)) return;
        userText += line.textContent.trim() + '\n';
      });
      userText = userText.trim();
      if (window.GTUtils && typeof window.GTUtils.cleanText === 'function') {
        userText = window.GTUtils.cleanText(userText);
      }

      // Extract uploaded user images
      const images = [];
      const imgElements = msgNode.querySelectorAll('img[data-test-id="uploaded-img"], .preview-image');
      imgElements.forEach(img => {
        if (img.src && !img.src.startsWith('data:')) {
          images.push(img.src);
        }
      });

      // Extract corresponding AI model response
      let responseText = '';
      let respNode = null;

      let parent = msgNode.parentElement;
      while (parent && parent !== document.body && parent !== container) {
        if (parent.querySelectorAll(SELECTORS.USER_QUERY).length > 1) break;
        const found = parent.querySelector('model-response');
        if (found) { respNode = found; break; }
        parent = parent.parentElement;
      }

      if (!respNode) {
        let curr = msgNode;
        while (curr && curr !== document.body && curr !== container && !respNode) {
          let sibling = curr.nextElementSibling;
          while (sibling) {
            if (sibling.matches?.(SELECTORS.USER_QUERY) || sibling.querySelector?.(SELECTORS.USER_QUERY)) break;
            if (sibling.tagName && sibling.tagName.toLowerCase() === 'model-response') {
              respNode = sibling;
              break;
            }
            const found = sibling.querySelector?.('model-response');
            if (found) { respNode = found; break; }
            sibling = sibling.nextElementSibling;
          }
          if (respNode) break;
          curr = curr.parentElement;
        }
      }

      if (respNode) {
        responseText = extractResponseText(respNode);
      }

      collectedTurns.push({
        userText,
        responseText,
        images,
        timestamp: Date.now()
      });
    }

    if (exportCancelFlag && collectedTurns.length === 0) {
      hideExportProgressOverlay();
      showToast('Export cancelled');
      if (safetyTimer) clearTimeout(safetyTimer);
      return;
    }

    if (collectedTurns.length === 0) {
      hideExportProgressOverlay();
      showToast('No conversation turns found');
      if (safetyTimer) clearTimeout(safetyTimer);
      return;
    }

    // Restore original scroll position
    scrollJiggle(container, initialScrollTop, 3);

    if (safetyTimer) clearTimeout(safetyTimer);
    hideExportProgressOverlay();

    // ALWAYS TRIGGER DOWNLOAD: generate file whenever collectedTurns > 0
    if (format === 'md') {
      generateMarkdownExport(collectedTurns);
    } else {
      generateJsonExport(collectedTurns);
    }

    showToast(`Export complete: ${collectedTurns.length} turns saved`);
  }

  /**
   * Export Modal — shows spinner and cancel button for standard user UI.
   */
  let exportModalEl = null;

  /**
   * Generate Markdown file content from collected turns and trigger download.
   */
  function generateMarkdownExport(turns) {
    let md = '# Gemini Chat Export\n\n';
    md += `> Exported on ${new Date().toLocaleString()}\n\n`;
    md += `---\n\n`;

    turns.forEach((turn, idx) => {
      md += `## Turn ${idx + 1}\n\n`;
      md += `**User:**\n${turn.userText}\n\n`;
      if (turn.images && turn.images.length > 0) {
        turn.images.forEach((img, i) => {
          md += `![Image ${i + 1}](${img})\n\n`;
        });
      }
      if (turn.responseText) {
        md += `**Gemini:**\n${turn.responseText}\n\n`;
      }
      md += `---\n\n`;
    });

    downloadFile(md, 'gemini-chat.md', 'text/markdown');
  }

  /**
   * Generate JSON file content from collected turns and trigger download.
   */
  function generateJsonExport(turns) {
    const messages = turns.map((turn, idx) => ({
      index: idx + 1,
      role: 'user',
      text: turn.userText,
      images: turn.images || [],
      response: turn.responseText
    }));

    const exportData = {
      title: 'Gemini Chat Export',
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages
    };

    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, 'gemini-chat.json', 'application/json');
  }

  // ======================== Search & Filter ========================

  function toggleSearch() {
    const searchBar = panelEl.querySelector('.gcn-search-bar');
    const searchInput = panelEl.querySelector('.gcn-search-input');

    if (searchBar.style.display === 'none') {
      searchBar.style.display = 'flex';
      searchInput.focus();
    } else {
      searchBar.style.display = 'none';
      searchInput.value = '';
      filterMessages('');
    }
  }

  function filterMessages(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const countEl = panelEl.querySelector('.gcn-search-count');
    let visibleCount = 0;

    navItems.forEach((item, idx) => {
      const msgObj = userMessages[idx];
      const searchTarget = msgObj ? (msgObj.fullText || msgObj.text).toLowerCase() : '';
      const matches = !normalizedQuery || searchTarget.includes(normalizedQuery);

      item.style.display = matches ? 'flex' : 'none';
      if (matches) visibleCount++;
    });

    if (countEl) {
      countEl.textContent = normalizedQuery ? `${visibleCount}/${navItems.length}` : '';
    }
  }

  function fallbackCopyText(text) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const result = document.execCommand('copy');
      textarea.remove();
      return result;
    } catch (e) {
      return false;
    }
  }

  function copyPrompt(text, event) {
    const showSuccess = () => {
      const btn = event.target ? event.target.closest('.gcn-copy-btn') : null;
      if (btn) {
        btn.classList.add('gcn-copied');
        setTimeout(() => btn.classList.remove('gcn-copied'), 1500);
      }
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(showSuccess).catch(() => {
        if (fallbackCopyText(text)) showSuccess();
      });
    } else {
      if (fallbackCopyText(text)) showSuccess();
    }
  }

  // ======================== Scroll to Message ========================

  function scrollToMessage(element, index) {
    clearHighlight();

    // Mark programmatic scroll state
    isScrollingTo = true;
    targetIndex = index;

    // Disconnect observer
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });

    setTimeout(() => {
      element.classList.add('gcn-highlight');
      highlightTimer = setTimeout(() => element.classList.remove('gcn-highlight'), CONFIG.HIGHLIGHT_DURATION);
    }, 300);

    updateActiveNavItem(index);
    updateFocusedNavItem(index);

    // Reconnect observer after scroll ends
    waitForScrollEnd(() => {
      isScrollingTo = false;
      targetIndex = -1;
      setupIntersectionObserver();
    });
  }

  function waitForScrollEnd(callback) {
    // Clear any active scroll listener and safety timer from previous invocation
    if (activeScrollCleanup) {
      activeScrollCleanup();
      activeScrollCleanup = null;
    }

    const container = getScrollContainer();
    if (!container) { callback(); return; }

    let debounceTimer = null;
    let safetyTimer = null;
    let cleanedUp = false;

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
      container.removeEventListener('scroll', onScroll);
      if (activeScrollCleanup === cleanup) {
        activeScrollCleanup = null;
      }
    }

    function onScroll() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        cleanup();
        callback();
      }, 200);
    }

    container.addEventListener('scroll', onScroll);

    // Safety timeout
    if (scrollTimeout) clearTimeout(scrollTimeout);
    safetyTimer = setTimeout(() => {
      cleanup();
      callback();
    }, 5000);
    scrollTimeout = safetyTimer;

    activeScrollCleanup = cleanup;
  }

  function clearHighlight() {
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
    document.querySelectorAll('.gcn-highlight').forEach(el => el.classList.remove('gcn-highlight'));
  }

  function updateActiveNavItem(activeIndex) {
    // Use requestAnimationFrame for smooth UI update
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      navItems.forEach((item, idx) => {
        item.classList.toggle('gcn-active', idx === activeIndex);
      });

      const activeItem = navItems[activeIndex];
      if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // ======================== Intersection Observer ========================

  function setupIntersectionObserver() {
    // BugFix: always disconnect previous observer before rebuilding
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    // BugFix: force-refresh to get latest DOM nodes
    const messages = getUserMessages(true);
    if (messages.length === 0) return;

    const container = getScrollContainer();
    if (!container) return;

    scrollObserver = new IntersectionObserver((entries) => {
      if (!isPanelExpanded) return;
      // Don't update during programmatic scroll
      if (isScrollingTo) return;

      // Use rAF to batch DOM reads/writes
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        let closest = null;
        let closestDist = Infinity;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const rect = entry.target.getBoundingClientRect();
          const dist = Math.abs(rect.top);
          if (dist < closestDist) {
            closestDist = dist;
            closest = entry.target;
          }
        }

        if (closest) {
          // BugFix: use live DOM query instead of stale closure snapshot
          const liveMessages = getUserMessages();
          const idx = Array.from(liveMessages).indexOf(closest);
          if (idx !== -1) {
            navItems.forEach((item, i) => {
              item.classList.toggle('gcn-active', i === idx);
            });
            updateFocusedNavItem(idx);
          }
        }
      });
    }, {
      root: container,
      rootMargin: '-100px 0px -50% 0px',
      threshold: 0.1
    });

    messages.forEach(msg => scrollObserver.observe(msg));
  }

  // ======================== Mutation Observer ========================

  function isIgnoredMutationTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;

    const id = target.id || '';
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    const cls = typeof target.className === 'string' ? target.className : '';

    // Fast property filters before executing any .closest() DOM traversals
    if (id === 'gcn-panel' || id === 'gcn-preview' || id === 'gt-batch-floating-bar' || id === 'gcn-shortcuts-modal' || id.startsWith('gt-') || id.startsWith('gcn-')) {
      return true;
    }
    if (tag === 'model-response') {
      return true;
    }
    if (cls && (cls.includes('gt-') || cls.includes('gcn-') || cls.includes('response-container'))) {
      return true;
    }

    // Fallback subtree traversal check — uses only ID selectors and tag names
    // (fast path above already covers class-based checks via cls.includes)
    if (target.closest('#gcn-panel, #gcn-preview, #gt-batch-floating-bar, #gcn-shortcuts-modal, model-response')) {
      return true;
    }

    return false;
  }

  function setupMutationObserver() {
    const container = getScrollContainer();
    const targetNode = container || document.body;
    const usingFallback = !container;

    // Skip re-binding if already watching the scroll container
    if (mainMutationObserver && observedContainer === targetNode && !isFallbackToBody) {
      return;
    }

    // Disconnect existing observer if re-binding from document.body to container
    if (mainMutationObserver) {
      mainMutationObserver.disconnect();
    }

    observedContainer = targetNode;
    isFallbackToBody = usingFallback;

    const debouncedUpdate = (window.GTUtils && typeof window.GTUtils.debounce === 'function')
      ? window.GTUtils.debounce(() => {
          const prevLastElement = (userMessages.length > 0 && userMessages[userMessages.length - 1]) ? userMessages[userMessages.length - 1].element : null;
          const prevCount = userMessages.length;
          const freshMessages = getUserMessages(true);
          renderMessageList();
          // BugFix: always rebuild IntersectionObserver so new user-query
          // nodes get observed (setupIntersectionObserver handles disconnect).
          setupIntersectionObserver();

          // Auto-scroll Gemini chat pane and Trace panel to the newest prompt ONLY when a NEW message was appended at the bottom.
          // If the last message did not change, it means older messages were prepended at the top (e.g. Load Earlier Turns), so DO NOT auto-scroll to bottom.
          if (prevCount > 0 && freshMessages.length > prevCount) {
            const freshLastElement = freshMessages[freshMessages.length - 1];
            const isNewMessageAppended = freshLastElement && freshLastElement !== prevLastElement;

            if (isNewMessageAppended) {
              const newIndex = freshMessages.length - 1;
              const newElement = freshMessages[newIndex];
              if (newElement) {
                scrollToMessage(newElement, newIndex);
              }
            }
          }
        }, 200)
      : null;

    let fallbackTimer = null;

    mainMutationObserver = new MutationObserver((mutations) => {
      // Re-bind to scroll container if initial fallback to document.body was used and container is now ready
      if (isFallbackToBody) {
        const realContainer = getScrollContainer(true);
        if (realContainer) {
          setupMutationObserver();
          return;
        }
      }

      let shouldUpdate = false;
      for (const mutation of mutations) {
        const target = mutation.target;
        if (isIgnoredMutationTarget(target)) {
          continue;
        }

        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isIgnoredMutationTarget(node)) continue;
              const tag = node.tagName?.toLowerCase();
              if (tag === 'user-query' || node.querySelector?.('user-query')) {
                shouldUpdate = true;
                break;
              }
            }
          }
          if (shouldUpdate) break;

          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (isIgnoredMutationTarget(node)) continue;
              const tag = node.tagName?.toLowerCase();
              if (tag === 'user-query' || node.querySelector?.('user-query')) {
                shouldUpdate = true;
                break;
              }
            }
          }
        }
        if (shouldUpdate) break;
      }

      if (shouldUpdate) {
        if (debouncedUpdate) {
          debouncedUpdate();
        } else {
          if (fallbackTimer) clearTimeout(fallbackTimer);
          fallbackTimer = setTimeout(() => {
            getUserMessages(true);
            renderMessageList();
            // BugFix: always rebuild IntersectionObserver (same fix as debouncedUpdate)
            setupIntersectionObserver();
          }, 200);
        }
      }
    });

    mainMutationObserver.observe(targetNode, { childList: true, subtree: true });
  }

  // ======================== Keyboard & Extension Commands ========================

  function getDeepActiveElement(element) {
    let el = element || document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function isEditingElement(el) {
    const target = getDeepActiveElement(el);
    if (!target) return false;

    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'rich-textarea') return true;

    if (target.isContentEditable) return true;

    const ce = target.getAttribute && target.getAttribute('contenteditable');
    if (ce === 'true' || ce === '' || ce === 'events') return true;

    if (target.closest && target.closest('rich-textarea, textarea, [contenteditable], [contenteditable="true"]')) return true;

    return false;
  }

  function updateFocusedNavItem(index) {
    if (navItems.length === 0) return;
    focusedNavIndex = Math.max(0, Math.min(index, navItems.length - 1));

    navItems.forEach((item, idx) => {
      item.classList.toggle('gcn-focused', idx === focusedNavIndex);
    });

    const focusedItem = navItems[focusedNavIndex];
    if (focusedItem) {
      focusedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function moveFocus(delta) {
    if (navItems.length === 0) return;

    let nextIndex = focusedNavIndex;
    if (nextIndex < 0 || nextIndex >= navItems.length) {
      const activeIdx = navItems.findIndex(item => item.classList.contains('gcn-active'));
      nextIndex = activeIdx !== -1 ? activeIdx : (delta > 0 ? -1 : 0);
    }

    let attempts = 0;
    while (attempts < navItems.length) {
      nextIndex += delta;
      if (nextIndex < 0) nextIndex = navItems.length - 1;
      if (nextIndex >= navItems.length) nextIndex = 0;
      attempts++;

      // Check if visible (not hidden by search filter)
      if (navItems[nextIndex] && navItems[nextIndex].style.display !== 'none') {
        updateFocusedNavItem(nextIndex);
        break;
      }
    }
  }

  function setupKeyboardNavigation() {
    // In-page keydown shortcuts
    document.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const isEditing = isEditingElement(activeEl);

      if (e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); togglePanel(); return; }
      if (e.altKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); toggleTheme(); return; }

      // Ctrl+F or / to toggle search
      if ((e.ctrlKey && (e.key === 'f' || e.key === 'F')) || (e.key === '/' && !isEditing)) {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // ? or Shift+/ for Shortcuts Cheat Sheet Modal
      if (!isEditing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        toggleShortcutsModal();
        return;
      }

      // Escape key handling (closes modal or clears focus)
      if (e.key === 'Escape') {
        const modal = document.getElementById('gcn-shortcuts-modal');
        if (modal && modal.style.display === 'flex') {
          e.preventDefault();
          hideShortcutsModal();
          return;
        }
      }

      // J / K / Enter / Arrows geek navigation (active when not typing in text fields & panel is open)
      if (!isEditing && isPanelExpanded && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
          e.preventDefault();
          moveFocus(1);
        } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveFocus(-1);
        } else if (e.key === 'Enter') {
          if (focusedNavIndex >= 0 && focusedNavIndex < userMessages.length) {
            e.preventDefault();
            const msgObj = userMessages[focusedNavIndex];
            if (msgObj && msgObj.element) {
              scrollToMessage(msgObj.element, focusedNavIndex);
            }
          }
        } else if (e.key === 'Escape') {
          if (focusedNavIndex !== -1) {
            focusedNavIndex = -1;
            navItems.forEach(item => item.classList.remove('gcn-focused'));
          }
        }
      }
    });

    // Native extension command listener (from background service worker)
    const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (api && api.runtime && api.runtime.onMessage) {
      api.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'toggle-panel') togglePanel();
        if (msg.action === 'toggle-theme') toggleTheme();
      });
    }
  }

  // ======================== Init ========================

  function init() {
    if (panelInjected) return;

    function bootstrap() {
      if (panelInjected) return;
      createPanel();
      renderMessageList();
      setupIntersectionObserver();
      setupMutationObserver();
      setupKeyboardNavigation();
      panelInjected = true;
      // Notify integration module to clean up header once
      if (window.GTIntegration && typeof window.GTIntegration.cleanupRightPanelHeader === 'function') {
        window.GTIntegration.cleanupRightPanelHeader();
      }
    }

    // Fast path: if content is already present, bootstrap immediately
    if (getUserMessages().length > 0 || getScrollContainer()) {
      bootstrap();
      return;
    }

    // Perf: use a one-shot MutationObserver instead of 500ms setInterval polling
    let initSafetyTimer = null;
    const initObserver = new MutationObserver(() => {
      if (getUserMessages().length > 0 || getScrollContainer()) {
        initObserver.disconnect();
        if (initSafetyTimer) { clearTimeout(initSafetyTimer); initSafetyTimer = null; }
        bootstrap();
      }
    });
    initObserver.observe(document.body, { childList: true, subtree: true });

    // Safety timeout: disconnect after 30s if nothing found
    initSafetyTimer = setTimeout(() => {
      initObserver.disconnect();
      // One last try
      if (!panelInjected && (getUserMessages().length > 0 || getScrollContainer())) {
        bootstrap();
      }
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ======================== SPA Route Change Listener ========================

  let lastPathname = location.pathname;

  function handleRouteChange() {
    // Perf: compare pathname only (not full href) to avoid false triggers
    // from query/hash changes within the same conversation
    if (location.pathname === lastPathname && panelInjected) return;
    lastPathname = location.pathname;

    // Ensure GTState namespace exists and clear any prior route timer to prevent leaks
    window.GTState = window.GTState || {};
    if (window.GTState.routeTimer) {
      clearInterval(window.GTState.routeTimer);
      window.GTState.routeTimer = null;
    }

    // Reset DOM caches
    cachedScrollContainer = null;
    cachedUserMessageNodes = null;

    messageHash = '';
    navItems = [];
    userMessages = [];
    focusedNavIndex = -1;

    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    // Re-check mutation observer target on route change
    setupMutationObserver();

    // On-demand cleanup (replaces the removed 1s polling in integration.js)
    if (window.GTIntegration && typeof window.GTIntegration.cleanupRightPanelHeader === 'function') {
      window.GTIntegration.cleanupRightPanelHeader();
    }

    if (!panelEl || !document.body.contains(panelEl)) {
      createPanel();
    } else {
      if (listContainer) listContainer.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
    }

    let attempts = 0;
    window.GTState.routeTimer = setInterval(() => {
      attempts++;
      renderMessageList();
      if (userMessages.length > 0 || attempts >= 10) {
        clearInterval(window.GTState.routeTimer);
        window.GTState.routeTimer = null;
        setupIntersectionObserver();
      }
    }, 350);
  }

  // Hook History API for instantaneous route detection
  const originalPushState = history.pushState;
  if (originalPushState) {
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(handleRouteChange, 50);
    };
  }

  const originalReplaceState = history.replaceState;
  if (originalReplaceState) {
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(handleRouteChange, 50);
    };
  }

  window.addEventListener('popstate', () => setTimeout(handleRouteChange, 50));
  // Perf: event-driven hooks (pushState/popstate) cover the fast path;
  // this fallback polling runs at a relaxed interval for edge cases only.
  setInterval(handleRouteChange, 2000);

})();
