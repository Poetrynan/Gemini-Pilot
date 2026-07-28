/**
 * Gemini Trace - Module Integration & Event Coordination
 * Maintains clean separation: Right panel is strictly for Trace Turn Navigation,
 * Left sidebar is strictly for Batch Delete and Folders management.
 * Coordinates cross-module initialization, theme synchronization, and cleanup.
 */

(function () {
  'use strict';

  // Ensure right panel header remains clean without misplaced sidebar buttons
  function cleanupRightPanelHeader() {
    const sidebarActions = document.getElementById('gcn-sidebar-actions');
    if (sidebarActions) {
      sidebarActions.remove();
    }
  }

  // Cross-module theme synchronization coordinator
  function syncTheme() {
    if (!window.GTUtils || typeof window.GTUtils.isDark !== 'function') return;
    const dark = window.GTUtils.isDark();
    const theme = dark ? 'dark' : 'light';

    // Right panel & preview
    const panel = document.getElementById('gcn-panel');
    if (panel) panel.setAttribute('data-gcn-theme', theme);
    const preview = document.getElementById('gcn-preview');
    if (preview) preview.setAttribute('data-gcn-theme', theme);

    // Batch toolbar
    const batchToolbar = document.getElementById('gt-batch-floating-bar');
    if (batchToolbar) batchToolbar.setAttribute('data-gcn-theme', theme);

    // Folders section & overlays
    if (window.GTFolders && typeof window.GTFolders.syncTheme === 'function') {
      try { window.GTFolders.syncTheme(); } catch (e) { /* ignore */ }
    }

    document.querySelectorAll(
      '.gt-dialog-overlay, .gcn-shortcuts-overlay, .gt-folder-selector-overlay, .gt-folder-menu-overlay, .gt-toast'
    ).forEach(el => {
      el.setAttribute('data-gcn-theme', theme);
      el.setAttribute('data-gt-theme', theme);
    });
  }

  // Module initialization coordinator
  function initModules() {
    cleanupRightPanelHeader();
    syncTheme();
  }

  // Setup DOM & window event listeners for coordination
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModules);
  } else {
    initModules();
  }

  // Perf: cleanupRightPanelHeader is called on-demand from content.js
  // bootstrap and route changes — no need for perpetual 1s polling.

  window.addEventListener('gt:theme-change', syncTheme);

  // Global Integration API
  window.GTIntegration = {
    cleanupRightPanelHeader,
    syncTheme,
    init: initModules
  };

})();

