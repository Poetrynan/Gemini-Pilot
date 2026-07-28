/**
 * Gemini Trace - Batch Delete Module
 * Dual-strategy DOM detection, multi-language bulk deletion, floating bar UI & Shift+Click
 * Inspired by reference open-source architecture
 */

(function () {
  'use strict';

  // State
  let selectedConversations = new Set();
  let isDeleteMode = false;
  let isDeleting = false;
  let lastCheckedIdx = -1;
  let mutationObserver = null;
  let debounceTimer = null;
  let cachedBarElements = null;

  // ======================== Robust DOM Finder ========================

  function findSidebar() {
    if (window.GTUtils && typeof window.GTUtils.findSidebar === 'function') {
      const sb = window.GTUtils.findSidebar();
      if (sb) return sb;
    }
    return document.querySelector(
      'aside, [role="complementary"], mat-sidenav, mat-drawer, .side-nav-content, .sidebar-container, nav, .mat-drawer-inner-container'
    ) || document.body;
  }

  function getConversationItems() {
    const sidebar = findSidebar();
    if (!sidebar) return [];

    // Strategy 1: Find 3-dots menu buttons inside sidebar
    const menuBtns = Array.from(sidebar.querySelectorAll(
      'button[aria-label*="options" i], button[aria-label*="More" i], button[aria-label*="选项" i], button[aria-label*="更多" i], button[aria-haspopup="menu"], .mat-mdc-menu-trigger'
    )).filter(btn => (btn.offsetWidth > 0 || btn.offsetHeight > 0));

    let items = menuBtns.map(btn => {
      const parent = btn.closest('conversation-item-viewer, li, [role="listitem"], .mat-list-item, .conversation-item-container') || btn.parentElement?.parentElement;
      return parent;
    }).filter(Boolean);

    // Strategy 2: If strategy 1 yields 0, fallback to anchor search in sidebar
    if (items.length === 0) {
      const anchors = Array.from(sidebar.querySelectorAll('a[href*="/app/"], a[href*="conversations"], [data-test-id*="conversation"]'));
      items = anchors.map(a => a.closest('conversation-item-viewer, li, [role="listitem"], .mat-list-item') || a);
    }

    return Array.from(new Set(items)).filter(item => {
      if (!item) return false;
      return (item.offsetWidth > 0 || item.offsetHeight > 0) && (item.textContent || '').trim().length > 0;
    });
  }

  function getConversationId(conv) {
    if (!conv) return 'conv_default';
    const link = conv.querySelector('a[href*="/app/"]') || conv;
    const href = link.getAttribute('href') || link.dataset?.testId || link.getAttribute('data-test-id') || '';
    if (window.GTUtils && typeof window.GTUtils.getConversationIdFromHref === 'function') {
      const id = window.GTUtils.getConversationIdFromHref(href);
      if (id) return id;
    }
    const match = href.match(/\/app\/(conversations\/)?([A-Za-z0-9_-]+)/);
    if (match) return match[2];
    return (conv.textContent || '').trim().substring(0, 30);
  }

  // ======================== Floating Bar UI ========================

  function isDark() {
    if (window.GTUtils && typeof window.GTUtils.isDark === 'function') {
      return window.GTUtils.isDark();
    }
    return document.getElementById('gcn-panel')?.getAttribute('data-gcn-theme') === 'dark';
  }

  function showFloatingBar() {
    if (document.getElementById('gt-batch-floating-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'gt-batch-floating-bar';
    bar.className = 'gt-batch-floating-bar';
    if (isDark()) bar.setAttribute('data-gcn-theme', 'dark');

    bar.innerHTML = `
      <div class="gt-batch-bar-content">
        <span class="gt-batch-bar-title">⚡ Batch Select</span>
        <span class="gt-batch-bar-count">Selected: <strong id="gt-selected-count">0</strong></span>
        <button class="gt-btn gt-batch-bar-select-all" id="gt-select-all-btn">Select All</button>
        <button class="gt-btn gt-btn-danger gt-batch-bar-delete" disabled>Delete Selected</button>
        <button class="gt-btn gt-batch-bar-cancel" title="Cancel">✕ Cancel</button>
      </div>
      <div class="gt-batch-progress" style="display: none;">
        <div class="gt-batch-progress-bar"><div class="gt-batch-progress-bar-fill"></div></div>
        <span class="gt-batch-progress-text">0/0</span>
      </div>
    `;

    document.body.appendChild(bar);

    cachedBarElements = {
      bar,
      countEl: bar.querySelector('#gt-selected-count'),
      deleteBtn: bar.querySelector('.gt-batch-bar-delete'),
      selectAllBtn: bar.querySelector('#gt-select-all-btn')
    };

    bar.querySelector('#gt-select-all-btn').addEventListener('click', toggleSelectAll);
    bar.querySelector('.gt-batch-bar-delete').addEventListener('click', startBatchDelete);
    bar.querySelector('.gt-batch-bar-cancel').addEventListener('click', exitBatchMode);

    updateCount();
  }

  function injectCheckboxes() {
    const conversations = getConversationItems();

    conversations.forEach((conv, idx) => {
      if (conv.querySelector('.gt-conv-checkbox')) return;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'gt-conv-checkbox';
      checkbox.dataset.index = idx.toString();

      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        handleCheckboxChange(conv, checkbox, e);
      });

      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      conv.style.position = 'relative';
      conv.style.display = 'flex';
      conv.style.alignItems = 'center';
      conv.style.paddingLeft = '36px';
      conv.insertBefore(checkbox, conv.firstChild);
    });
  }

  function handleCheckboxChange(conv, checkbox, event) {
    const checkboxes = Array.from(document.querySelectorAll('.gt-conv-checkbox'));
    const currentIdx = checkboxes.indexOf(checkbox);
    if (currentIdx === -1) return;

    if (event.shiftKey && lastCheckedIdx !== -1 && lastCheckedIdx !== currentIdx && lastCheckedIdx < checkboxes.length) {
      const start = Math.min(lastCheckedIdx, currentIdx);
      const end = Math.max(lastCheckedIdx, currentIdx);
      const shouldCheck = checkbox.checked;

      for (let i = start; i <= end; i++) {
        const cb = checkboxes[i];
        if (!cb) continue;
        const item = cb.parentElement;
        if (!item) continue;
        const id = getConversationId(item);
        cb.checked = shouldCheck;

        if (shouldCheck) {
          selectedConversations.add(id);
          item.classList.add('gt-conv-selected');
        } else {
          selectedConversations.delete(id);
          item.classList.remove('gt-conv-selected');
        }
      }
    } else {
      const convId = getConversationId(conv);
      if (checkbox.checked) {
        selectedConversations.add(convId);
        conv.classList.add('gt-conv-selected');
      } else {
        selectedConversations.delete(convId);
        conv.classList.remove('gt-conv-selected');
      }
    }

    lastCheckedIdx = currentIdx;
    updateCount();
  }

  function toggleSelectAll() {
    const checkboxes = Array.from(document.querySelectorAll('.gt-conv-checkbox'));
    const totalCount = checkboxes.length;
    const allChecked = selectedConversations.size === totalCount && totalCount > 0;

    checkboxes.forEach(cb => {
      const conv = cb.parentElement;
      if (!conv) return;
      const id = getConversationId(conv);
      if (allChecked) {
        selectedConversations.delete(id);
        cb.checked = false;
        conv.classList.remove('gt-conv-selected');
      } else {
        selectedConversations.add(id);
        cb.checked = true;
        conv.classList.add('gt-conv-selected');
      }
    });

    updateCount();
  }

  function updateCount() {
    const countEl = cachedBarElements?.countEl || document.getElementById('gt-selected-count');
    const deleteBtn = cachedBarElements?.deleteBtn || document.querySelector('.gt-batch-bar-delete');
    const selectAllBtn = cachedBarElements?.selectAllBtn || document.querySelector('#gt-select-all-btn');
    const totalCount = document.querySelectorAll('.gt-conv-checkbox').length;

    if (countEl) countEl.textContent = selectedConversations.size.toString();
    if (deleteBtn) deleteBtn.disabled = selectedConversations.size === 0 || isDeleting;
    if (selectAllBtn) {
      selectAllBtn.textContent = selectedConversations.size === totalCount && totalCount > 0 ? 'Deselect All' : 'Select All';
    }
  }

  // ======================== Batch Delete Engine ========================

  async function startBatchDelete() {
    if (selectedConversations.size === 0 || isDeleting) return;

    const confirmed = await showConfirmDialog();
    if (!confirmed) return;

    isDeleting = true;
    updateCount();

    // Temporarily hide floating popup menus during automated batch deletion to avoid flashing
    let hideStyle = document.getElementById('gt-hide-batch-menus');
    if (!hideStyle) {
      hideStyle = document.createElement('style');
      hideStyle.id = 'gt-hide-batch-menus';
      hideStyle.textContent = `
        .cdk-overlay-container, [role="menu"], .mat-mdc-menu-panel, .cdk-overlay-pane {
          opacity: 0 !important;
          pointer-events: auto !important;
          transition: none !important;
        }
      `;
      document.head.appendChild(hideStyle);
    }

    try {
      const conversations = getConversationItems();
      const toDelete = conversations.filter(conv => {
        const id = getConversationId(conv);
        return selectedConversations.has(id);
      });

      const progressBar = document.querySelector('.gt-batch-progress');
      const progressBarFill = document.querySelector('.gt-batch-progress-bar-fill');
      const progressText = document.querySelector('.gt-batch-progress-text');

      if (progressBar) progressBar.classList.add('active');
      if (progressText) progressText.textContent = `0/${toDelete.length}`;
      if (progressBarFill) progressBarFill.style.width = '0%';

      let deleted = 0;
      let failed = 0;

      for (const conv of toDelete) {
        try {
          await deleteConversation(conv);
          deleted++;
        } catch (e) {
          console.error('[GT Batch Delete] Failed to delete item:', e);
          failed++;
        }

        const percent = ((deleted + failed) / toDelete.length) * 100;
        if (progressBarFill) progressBarFill.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `${deleted + failed}/${toDelete.length}`;
      }

      showResultDialog(deleted, failed);
    } finally {
      document.getElementById('gt-hide-batch-menus')?.remove();
      isDeleting = false;
      exitBatchMode();
    }
  }

  async function deleteConversation(conv) {
    const menuBtn = conv.querySelector(
      'button[aria-label*="options" i], button[aria-label*="More" i], button[aria-label*="选项" i], button[aria-label*="更多" i], button[aria-label*="option" i], button[aria-haspopup="menu"], .mat-mdc-menu-trigger'
    );
    if (!menuBtn) throw new Error('Menu button not found');

    menuBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(250);
    menuBtn.click();

    const menu = await waitFor(() => {
      const menus = document.querySelectorAll('[role="menu"], .mat-mdc-menu-panel, .cdk-overlay-pane, mat-menu-content');
      return Array.from(menus).find(m => isVisible(m));
    }, 3000, 150);

    if (!menu) throw new Error('Menu not found');

    const deleteKeywords = [
      'delete', '删除', '刪除', '削除', 'löschen', 'eliminar', 'supprimer',
      'elimina', 'eliminare', 'excluir', 'deletar', 'apagar', '삭제', 'удалить',
      'удаление', 'हट', 'मिटा', 'حذف', 'sil', 'verwijderen', 'usuń', 'xóa', 'ลบ', 'hapus'
    ];
    const deleteItem = Array.from(menu.querySelectorAll('[role="menuitem"], button, .mat-mdc-menu-item, [data-test-id*="delete"], [data-testid*="delete"], [aria-label*="delete" i], [aria-label*="Delete"]'))
      .find(item => {
        const text = (item.textContent || '').trim().toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').trim().toLowerCase();
        const testId = (item.getAttribute('data-test-id') || item.getAttribute('data-testid') || '').trim().toLowerCase();
        return deleteKeywords.some(kw => text.includes(kw) || aria.includes(kw) || testId.includes(kw)) ||
          testId.includes('delete') || aria.includes('delete');
      });

    if (!deleteItem) throw new Error('Delete option not found in menu');

    deleteItem.click();

    await delay(350);

    const confirmKeywords = [
      'confirm', '确认', '確認', '確定', 'löschen', 'eliminar', 'supprimer',
      'bestätigen', 'confirmar', 'confirmer', 'conferma', '확인', 'подтвердить',
      'пуष्टि', 'تأكيد', 'onayla', 'bevestigen', 'potwierdź', 'xác nhận', 'ยืนยัน', 'konfirmasi'
    ];

    const confirmBtn = await waitFor(() => {
      const buttons = document.querySelectorAll('button, [role="button"], [data-test-id*="confirm"], [data-testid*="confirm"], [data-test-id*="delete"], [data-testid*="delete"], [aria-label*="delete" i], [aria-label*="confirm" i]');
      return Array.from(buttons).find(b => {
        if (menu.contains(b) || !isVisible(b)) return false;
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        const testId = (b.getAttribute('data-test-id') || b.getAttribute('data-testid') || '').trim().toLowerCase();
        return deleteKeywords.some(kw => text.includes(kw) || aria.includes(kw) || testId.includes(kw)) ||
          confirmKeywords.some(kw => text.includes(kw) || aria.includes(kw) || testId.includes(kw)) ||
          testId.includes('delete') || testId.includes('confirm') || aria.includes('delete') || aria.includes('confirm');
      });
    }, 3000, 150);

    if (!confirmBtn) throw new Error('Confirm button not found');

    confirmBtn.click();
    await delay(600);
  }

  // ======================== Dialogs ========================

  function showConfirmDialog() {
    return new Promise(resolve => {
      let resolved = false;
      const overlay = document.createElement('div');
      overlay.className = 'gt-dialog-overlay';
      if (isDark()) overlay.setAttribute('data-gcn-theme', 'dark');

      overlay.innerHTML = `
        <div class="gt-dialog">
          <h3>🗑️ Confirm Batch Delete</h3>
          <p>You are about to permanently delete <strong>${selectedConversations.size}</strong> conversation(s).</p>
          <p class="gt-dialog-warning">This action cannot be undone.</p>

          <div class="gt-dialog-actions">
            <button class="gt-btn gt-dialog-cancel">Cancel</button>
            <button class="gt-btn gt-btn-danger gt-dialog-confirm">Confirm Delete (${selectedConversations.size})</button>
          </div>
        </div>
      `;

      let unmountObserver = null;

      function cleanup() {
        document.removeEventListener('keydown', handleKeyDown, true);
        if (unmountObserver) {
          unmountObserver.disconnect();
          unmountObserver = null;
        }
        if (overlay.parentNode) {
          overlay.remove();
        }
      }

      function finish(result) {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      }

      function handleKeyDown(e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(false);
        }
      }

      document.body.appendChild(overlay);

      unmountObserver = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
          finish(false);
        }
      });
      unmountObserver.observe(document.body, { childList: true });

      document.addEventListener('keydown', handleKeyDown, true);

      const confirmBtn = overlay.querySelector('.gt-dialog-confirm');
      const cancelBtn = overlay.querySelector('.gt-dialog-cancel');

      if (cancelBtn) {
        cancelBtn.focus();
        cancelBtn.addEventListener('click', () => finish(false));
      }

      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => finish(true));
      }
    });
  }

  function showResultDialog(deleted, failed) {
    const overlay = document.createElement('div');
    overlay.className = 'gt-dialog-overlay';
    if (isDark()) overlay.setAttribute('data-gcn-theme', 'dark');

    overlay.innerHTML = `
      <div class="gt-dialog">
        <h3>🎉 Batch Deletion Complete</h3>
        <p>✅ Successfully deleted: <strong>${deleted}</strong> conversation(s)</p>
        ${failed > 0 ? `<p class="gt-dialog-warning">❌ Failed to delete: <strong>${failed}</strong> conversation(s)</p>` : ''}
        <div class="gt-dialog-actions">
          <button class="gt-btn gt-btn-primary gt-dialog-ok">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.gt-dialog-ok').addEventListener('click', () => {
      overlay.remove();
    });
  }

  // ======================== Mode Toggle ========================

  function enterBatchMode() {
    isDeleteMode = true;
    selectedConversations.clear();
    lastCheckedIdx = -1;

    showFloatingBar();
    injectCheckboxes();

    if (!mutationObserver) {
      mutationObserver = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectCheckboxes, 300);
      });

      const sidebar = findSidebar();
      mutationObserver.observe(sidebar, { childList: true, subtree: true });
    }
  }

  function exitBatchMode() {
    isDeleteMode = false;
    selectedConversations.clear();
    lastCheckedIdx = -1;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }

    cachedBarElements = null;

    document.getElementById('gt-batch-floating-bar')?.remove();

    // Reset paddingLeft and inline styles on ALL conversation items
    document.querySelectorAll('.gt-conv-checkbox').forEach(cb => {
      const conv = cb.parentElement;
      if (conv) {
        conv.style.paddingLeft = '';
        conv.style.position = '';
        conv.style.display = '';
        conv.style.alignItems = '';
        conv.classList.remove('gt-conv-selected');
      }
      cb.remove();
    });

    document.querySelectorAll('.gt-conv-selected').forEach(el => {
      el.classList.remove('gt-conv-selected');
      el.style.paddingLeft = '';
    });
  }

  function isVisible(el) {
    if (!el) return false;
    return (el.offsetWidth > 0 || el.offsetHeight > 0);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitFor(selector, timeout = 3000, interval = 150) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      function check() {
        const result = typeof selector === 'function' ? selector() : document.querySelector(selector);
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - startTime >= timeout) {
          reject(new Error('Timeout waiting for element'));
          return;
        }
        setTimeout(check, interval);
      }
      check();
    });
  }

  // Public API
  window.GTBatchDelete = {
    enter: enterBatchMode,
    exit: exitBatchMode,
    isActive: () => isDeleteMode
  };

})();
