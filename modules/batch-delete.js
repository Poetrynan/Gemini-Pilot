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
  let activeSidebar = null;

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
    const link = conv.querySelector('a[href*="/app/"]') ||
                 (conv.matches && conv.matches('a[href*="/app/"]') ? conv : null) ||
                 (conv.closest && conv.closest('a[href*="/app/"]')) || conv;
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
    if (!isDeleteMode) return;
    const conversations = getConversationItems();

    conversations.forEach((conv, idx) => {
      const convId = getConversationId(conv);
      const isSelected = selectedConversations.has(convId);
      let checkbox = conv.querySelector('.gt-conv-checkbox');

      if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'gt-conv-checkbox';

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
      } else {
        if (conv.style.paddingLeft !== '36px') {
          conv.style.position = 'relative';
          conv.style.display = 'flex';
          conv.style.alignItems = 'center';
          conv.style.paddingLeft = '36px';
        }
      }

      checkbox.dataset.index = idx.toString();
      checkbox.checked = isSelected;

      if (isSelected) {
        conv.classList.add('gt-conv-selected');
      } else {
        conv.classList.remove('gt-conv-selected');
      }
    });

    updateCount();
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
    if (checkboxes.length === 0) return;

    const allChecked = checkboxes.every(cb => cb.checked);

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
    const checkboxes = document.querySelectorAll('.gt-conv-checkbox');
    const totalCount = checkboxes.length;
    const allChecked = totalCount > 0 && Array.from(checkboxes).every(cb => cb.checked);

    if (countEl) countEl.textContent = selectedConversations.size.toString();
    if (deleteBtn) deleteBtn.disabled = selectedConversations.size === 0 || isDeleting;
    if (selectAllBtn) {
      selectAllBtn.textContent = allChecked ? 'Deselect All' : 'Select All';
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
        .cdk-overlay-container, [role="menu"], .mat-mdc-menu-panel, .cdk-overlay-pane,
        [role="dialog"], .cdk-overlay-backdrop, .mat-mdc-dialog-container {
          opacity: 0 !important;
          pointer-events: auto !important;
          transition: none !important;
        }
      `;
      document.head.appendChild(hideStyle);
    }

    try {
      const totalToProcess = selectedConversations.size;
      const progressBar = document.querySelector('.gt-batch-progress');
      const progressBarFill = document.querySelector('.gt-batch-progress-bar-fill');
      const progressText = document.querySelector('.gt-batch-progress-text');

      if (progressBar) progressBar.classList.add('active');
      if (progressText) progressText.textContent = `0/${totalToProcess}`;
      if (progressBarFill) progressBarFill.style.width = '0%';

      let deleted = 0;
      let failed = 0;

      while (selectedConversations.size > 0) {
        const conversations = getConversationItems();
        const convToDelete = conversations.find(conv => {
          const id = getConversationId(conv);
          return selectedConversations.has(id);
        });

        if (!convToDelete) {
          break;
        }

        const convId = getConversationId(convToDelete);
        try {
          await deleteConversation(convToDelete);
          deleted++;
        } catch (e) {
          console.error('[GT Batch Delete] Failed to delete item:', e);
          failed++;
        } finally {
          selectedConversations.delete(convId);
        }

        const processed = deleted + failed;
        const percent = Math.min(100, (processed / totalToProcess) * 100);
        if (progressBarFill) progressBarFill.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `${processed}/${totalToProcess}`;
      }

      showResultDialog(deleted, failed);
    } finally {
      // Dismiss all lingering Gemini-native overlay menus, dialogs, and backdrops
      // BEFORE removing the hiding CSS, so they don't flash on screen.
      dismissAllOverlays();
      // Small delay to let Gemini's own close animations settle
      await delay(200);
      document.getElementById('gt-hide-batch-menus')?.remove();
      isDeleting = false;
      exitBatchMode();
    }
  }

  /**
   * Dismiss all lingering Gemini-native overlay popups, menus, dialogs and backdrops.
   * NON-DESTRUCTIVE: Uses Angular's own dismissal mechanisms (Escape, backdrop click)
   * instead of forcibly removing DOM nodes, which would trigger Angular re-renders.
   */
  function dismissAllOverlays() {
    const escOpts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };

    // 1. Press Escape ON EACH visible menu panel / dialog surface: CDK listens
    // for keydown on the overlay container and the panel itself, not document.
    document.querySelectorAll('.cdk-overlay-container, [role="menu"], .mat-mdc-menu-panel, [role="dialog"], mat-dialog-container').forEach((el) => {
      el.dispatchEvent(new KeyboardEvent('keydown', escOpts));
    });
    document.body.dispatchEvent(new KeyboardEvent('keydown', escOpts));

    // 2. Click any visible backdrop overlays to dismiss them naturally
    document.querySelectorAll('.cdk-overlay-backdrop').forEach(backdrop => {
      if (backdrop.offsetWidth > 0 || backdrop.offsetHeight > 0) {
        backdrop.click();
      }
    });

    // 3. Send another Escape after backdrop clicks to ensure dialogs close
    setTimeout(() => {
      document.querySelectorAll('.cdk-overlay-container, [role="menu"], .mat-mdc-menu-panel, [role="dialog"], mat-dialog-container').forEach((el) => {
        el.dispatchEvent(new KeyboardEvent('keydown', escOpts));
      });
      document.body.dispatchEvent(new KeyboardEvent('keydown', escOpts));
    }, 50);
  }

  async function deleteConversation(conv) {
    const LOG = '[GT Batch Delete]';

    // Step 1: Find and click the 3-dots menu button
    const menuBtn = conv.querySelector(
      'button[aria-label*="options" i], button[aria-label*="More" i], button[aria-label*="选项" i], button[aria-label*="更多" i], button[aria-label*="option" i], button[aria-haspopup="menu"], .mat-mdc-menu-trigger'
    );
    if (!menuBtn) throw new Error('Menu button not found');

    menuBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(300);
    menuBtn.click();
    console.log(`${LOG} Step 1: Clicked menu button`);

    // Step 2: Wait for the menu to appear and find the Delete option
    const menu = await waitFor(() => {
      const menus = document.querySelectorAll('[role="menu"], .mat-mdc-menu-panel, mat-menu-content');
      return Array.from(menus).find(m => {
        if (m.closest && m.closest('.gt-dialog-overlay')) return false;
        return (m.offsetWidth > 0 || m.offsetHeight > 0);
      });
    }, 3000, 150);

    if (!menu) throw new Error('Menu not found');

    // Record the menu's overlay pane so we can exclude it from dialog searches later
    const menuOverlayPane = menu.closest('.cdk-overlay-pane');

    const deleteKeywords = [
      'delete', '删除', '刪除', '削除', 'löschen', 'eliminar', 'supprimer',
      'elimina', 'eliminare', 'excluir', 'deletar', 'apagar', '삭제', 'удалить',
      'удаление', 'हट', 'मिटा', 'حذف', 'sil', 'verwijderen', 'usuń', 'xóa', 'ลบ', 'hapus'
    ];

    const cancelKeywords = [
      'cancel', '取消', '취소', 'abbrechen', 'cancelar', 'annuler',
      'annulla', 'отмена', 'キャンセル', 'batal', 'hủy'
    ];

    const deleteItem = Array.from(menu.querySelectorAll('[role="menuitem"], button, .mat-mdc-menu-item'))
      .find(item => {
        const text = (item.textContent || '').trim().toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').trim().toLowerCase();
        return deleteKeywords.some(kw => text.includes(kw) || aria.includes(kw));
      });

    if (!deleteItem) throw new Error('Delete option not found in menu');

    console.log(`${LOG} Step 2: Found delete item: "${(deleteItem.textContent || '').trim()}"`);
    deleteItem.click();
    console.log(`${LOG} Step 3: Clicked delete item, waiting for confirmation dialog...`);

    // Step 3: Wait for the CONFIRMATION DIALOG to appear
    // Critical: The dialog will appear in a NEW .cdk-overlay-pane, DIFFERENT from the menu's pane
    await delay(500);

    const confirmKeywords = [
      'confirm', '确认', '確認', '確定', 'delete', '删除', '刪除', '削除', 'löschen', 'eliminar', 'supprimer',
      'bestätigen', 'confirmar', 'confirmer', 'conferma', '확인', '삭제', 'подтвердить',
      'onayla', 'bevestigen', 'potwierdź', 'xác nhận', 'ยืนยัน', 'konfirmasi'
    ];

    const confirmBtn = await waitFor(() => {
      // Find ALL overlay panes, but EXCLUDE the menu's pane and GT's own dialog overlays
      const allPanes = Array.from(document.querySelectorAll('.cdk-overlay-pane'));
      const dialogPanes = allPanes.filter(pane => {
        // Exclude the menu overlay pane
        if (menuOverlayPane && pane === menuOverlayPane) return false;
        // Exclude GT's own dialogs
        if (pane.closest('.gt-dialog-overlay') || pane.classList.contains('gt-dialog-overlay')) return false;
        // Must contain a dialog or buttons (not just another menu)
        const hasDialogRole = pane.querySelector('[role="dialog"], .mat-mdc-dialog-container, [role="alertdialog"]');
        const hasButtons = pane.querySelectorAll('button, [role="button"]').length >= 2;
        return hasDialogRole || hasButtons;
      });

      console.log(`${LOG} Dialog search: found ${dialogPanes.length} candidate dialog panes (excluded menu pane: ${!!menuOverlayPane})`);

      for (const dialog of dialogPanes) {
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
        console.log(`${LOG}   Dialog pane has ${buttons.length} buttons: ${buttons.map(b => `"${(b.textContent||'').trim()}"`).join(', ')}`);

        // Strategy A: Find a button matching delete/confirm keywords (excluding cancel)
        const matchedBtn = buttons.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();

          // Skip cancel buttons
          if (cancelKeywords.some(kw => text.includes(kw) || aria.includes(kw))) return false;

          return deleteKeywords.some(kw => text.includes(kw) || aria.includes(kw)) ||
            confirmKeywords.some(kw => text.includes(kw) || aria.includes(kw));
        });

        if (matchedBtn) {
          console.log(`${LOG}   → Matched confirm button: "${(matchedBtn.textContent||'').trim()}"`);
          return matchedBtn;
        }

        // Strategy B: In a 2-button dialog (Cancel + Confirm), pick the non-cancel button
        if (buttons.length >= 2) {
          const nonCancelBtns = buttons.filter(b => {
            const text = (b.textContent || '').trim().toLowerCase();
            return !cancelKeywords.some(kw => text.includes(kw));
          });
          if (nonCancelBtns.length === 1) {
            console.log(`${LOG}   → Fallback: only non-cancel button: "${(nonCancelBtns[0].textContent||'').trim()}"`);
            return nonCancelBtns[0];
          }
          // If multiple non-cancel buttons, pick the last one (usually the primary/destructive action)
          if (nonCancelBtns.length > 1) {
            const last = nonCancelBtns[nonCancelBtns.length - 1];
            console.log(`${LOG}   → Fallback: last non-cancel button: "${(last.textContent||'').trim()}"`);
            return last;
          }
        }
      }

      // Strategy C: Look for any alertdialog or role="dialog" ANYWHERE (not just in overlay panes)
      const anyDialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]:not(.gt-dialog-overlay *)');
      for (const dialog of anyDialogs) {
        if (dialog.closest('.gt-dialog-overlay')) continue;
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
        const matchedBtn = buttons.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          if (cancelKeywords.some(kw => text.includes(kw))) return false;
          return deleteKeywords.some(kw => text.includes(kw)) || confirmKeywords.some(kw => text.includes(kw));
        });
        if (matchedBtn) {
          console.log(`${LOG}   → Strategy C matched in [role="dialog"]: "${(matchedBtn.textContent||'').trim()}"`);
          return matchedBtn;
        }
      }

      return null;
    }, 4000, 200);

    if (!confirmBtn) {
      console.error(`${LOG} FAILED: Confirm button not found after 4s. DOM snapshot of overlay panes:`);
      document.querySelectorAll('.cdk-overlay-pane').forEach((p, i) => {
        console.error(`${LOG}   Pane ${i}: ${p.innerHTML.substring(0, 200)}`);
      });
      throw new Error('Confirm button in dialog not found');
    }

    console.log(`${LOG} Step 4: Clicking confirm button: "${(confirmBtn.textContent||'').trim()}"`);
    confirmBtn.click();

    // Step 5: Truth Verification — wait up to 5s for the conversation element to be unmounted from DOM
    console.log(`${LOG} Step 5: Waiting for DOM unmount verification...`);
    const isUnmounted = await waitFor(() => {
      return !document.body.contains(conv) || (conv.offsetWidth === 0 && conv.offsetHeight === 0);
    }, 5000, 200).then(() => true).catch(() => false);

    if (!isUnmounted) {
      console.error(`${LOG} FAILED: Conv element still in DOM after 5s. Contains: ${document.body.contains(conv)}, offsetW: ${conv.offsetWidth}, offsetH: ${conv.offsetHeight}`);
      throw new Error('Conversation element was not unmounted from DOM by Gemini');
    }

    console.log(`${LOG} Step 6: ✅ Successfully deleted & verified`);

    // Clean up lingering overlays non-destructively
    await delay(200);
    dismissAllOverlays();
    await delay(200);
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

  function handleSidebarScroll() {
    if (!isDeleteMode) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectCheckboxes, 50);
  }

  function enterBatchMode() {
    isDeleteMode = true;
    selectedConversations.clear();
    lastCheckedIdx = -1;

    showFloatingBar();
    injectCheckboxes();

    if (!mutationObserver) {
      mutationObserver = new MutationObserver(() => {
        if (!isDeleteMode) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectCheckboxes, 80);
      });

      activeSidebar = findSidebar();
      if (activeSidebar) {
        mutationObserver.observe(activeSidebar, { childList: true, subtree: true });
        activeSidebar.addEventListener('scroll', handleSidebarScroll, { passive: true });
      }
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

    if (activeSidebar) {
      activeSidebar.removeEventListener('scroll', handleSidebarScroll);
      activeSidebar = null;
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
