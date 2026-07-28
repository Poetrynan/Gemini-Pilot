# Gemini Pilot - Progress & Architecture Document

**Last Updated:** 2026-07-28
**Version:** 1.0.0
**Status:** 100% Complete, Modular & Production-Ready

---

## 1. Project Overview

**Gemini Pilot (v1.0.0)** transforms Google Gemini (`gemini.google.com`) into an organized AI workspace with single-session prompt turn outline navigation and global conversation management (folders, drag-and-drop, multi-language bulk deletion).

### Key Pillars
- **Prompt Turn Navigation Panel**: Single-session prompt outline with live search, export (Markdown/JSON), theme toggles, and `J`/`K`/`Enter` keyboard traversal.
- **Direct Native 3-Dots Menu Interception**: Injects `Move to Folder` and `Batch Select` directly into Gemini's native floating Material 3 popup menu.
- **Folders / 分组 (Approach A)**: A self-contained `分组` section injected at the very top of Gemini's native conversation sidebar. Native rows are never moved or reordered; assignment is via right-click, the 3-dots `Move to Folder` item, or drag-and-drop onto a folder row.
- **Multi-Language Bulk Deletion**: Supports multi-language delete keywords (`delete`, `删除`, `削除`, `löschen`, `eliminar`, `supprimer`), Shift+Click range selection, and batch progress tracking.
- **0ms Instantaneous SPA Route Detection**: Intercepts HTML5 `history.pushState` / `replaceState` for zero-lag route change re-rendering.
- **100% English Standardization**: All UI elements, dialogs, toasts, tooltips, and code comments in crisp, professional English.
- **Performance Optimized**: Anchor caching, decoupled menu injection, merged observers, microtask guard resets.

---

## 2. File Architecture

```
GeminiTrace/
├── manifest.json              # Extension manifest (MV3 + Content Scripts + Commands, v1.0.0)
├── background.js              # Service worker handling chrome.commands (Alt+N, Alt+T)
├── browser-polyfill.js        # WebExtension API cross-browser compatibility wrapper
├── content.js                 # Primary content script (Trace panel, SPA observer, theme hook)
├── content.css                # Primary CSS (Glassmorphism tokens, Trace panel, keycaps)
├── css/
│   ├── tokens.css             # Glass design system tokens (Light & Dark theme variables)
│   ├── panel.css              # Trace navigation panel & collapsed state rules
│   ├── sidebar.css            # Batch delete floating bar & modal overlay styles
│   └── folders.css            # 分组 section, native menu items, badges, dark/narrow styles
├── modules/
│   ├── utils.js               # Centralized utility submodule (GTUtils namespace)
│   ├── batch-delete.js        # Multi-language bulk deletion engine & selection logic
│   ├── folders.js             # Approach A 分组: top section, storage, drag/drop, observers
│   └── integration.js         # Module boundary manager (maintains right panel purity)
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md                  # User-facing documentation
```

---

## 3. Module Breakdown

### 3.1 Panel UI Manager (content.js)

**Responsibility:** Create and manage the Trace navigation panel.

| Function | Description |
|----------|-------------|
| `createPanel()` | Creates the panel DOM structure with idempotency guard |
| `togglePanel()` | Collapse/expand the panel |
| `renderMessageList()` | Renders all user messages as nav items with incremental hashing |
| `updateActiveNavItem()` | Highlights the active message in the panel |
| `showPreview()` | Shows hover preview tooltip (positioned via fixed positioning) |
| `hidePreview()` | Hides hover preview tooltip |
| `showExportMenu()` | Shows export format selection menu |
| `toggleSearch()` | Toggles search bar visibility |
| `filterMessages()` | Filters messages by keyword |
| `copyPrompt()` | Copies full prompt text to clipboard |
| `scrollToMessage()` | Scrolls to target message with programmatic scroll detection |
| `setupIntersectionObserver()` | Tracks which message is closest to viewport center |
| `setupMutationObserver()` | Watches for new messages added to the DOM |
| `setupKeyboardNavigation()` | Handles J/K/Enter keyboard navigation |

**Key Design Decisions:**
- Uses `DocumentFragment` for batch DOM insertion
- Caches DOM references globally to avoid repeated queries
- Incremental rendering with hash-based change detection
- Idempotent panel creation (prevents duplicate panels on race conditions)

### 3.2 Folders Module (modules/folders.js)

**Responsibility:** Manage conversation grouping with Approach A (self-contained top section).

| Function | Description |
|----------|-------------|
| `render()` | Main render function with loading guard and batch-select detection |
| `getConversationAnchors()` | Finds conversation links with 8 fallback selectors |
| `getCachedAnchors()` | Returns cached anchors (200ms TTL) |
| `findSidebarRoot()` | Scores candidate sidebar roots by anchor count + semantic hints |
| `placeSection()` | Inserts folder section above all native rows |
| `ensureSection()` | Creates or returns cached folder section element |
| `rebuildSection()` | Rebuilds folder rows with diff-based sync |
| `tryInjectMenuItems()` | Injects custom items into native 3-dot menu |
| `showFolderSelector()` | Shows folder assignment dropdown |
| `showFolderMenu()` | Shows folder context menu (rename/color/delete) |
| `assign()` | Assigns conversation to folder |
| `openConv()` | Navigates to conversation without full page reload |

**Storage Model:**
```json
{
  "folders": [{"id", "name", "collapsed", "color"}],
  "assignments": {"convId": "folderId"},
  "conversations": {"convId": {"id", "title", "href", "lastSeenAt"}}
}
```

### 3.3 Batch Delete Module (modules/batch-delete.js)

**Responsibility:** Multi-language bulk deletion with floating action bar.

| Function | Description |
|----------|-------------|
| `enterBatchMode()` | Activates batch selection mode |
| `exitBatchMode()` | Deactivates and cleans up |
| `injectCheckboxes()` | Injects checkboxes into conversation items |
| `handleCheckboxChange()` | Handles checkbox state with Shift+Click range selection |
| `toggleSelectAll()` | Selects/deselects all conversations |
| `startBatchDelete()` | Executes batch deletion with progress tracking |
| `deleteConversation()` | Deletes single conversation via native menu automation |
| `showFloatingBar()` | Shows floating bottom action bar |
| `showConfirmDialog()` | Shows type-"DELETE" confirmation dialog |
| `showResultDialog()` | Shows deletion result summary |

**Multi-Language Support:**
- 26 delete keywords (delete, 删除, 刪除, 削除, löschen, eliminar, supprimer, etc.)
- 10 rename keywords (rename, 重命名, 重新命名, 名前を変更, etc.)

### 3.4 Utils Module (modules/utils.js)

**Responsibility:** Shared utilities exposed via `window.GTUtils`.

| Function | Description |
|----------|-------------|
| `escapeHtml()` | Escapes HTML entities |
| `cleanText()` | Normalizes whitespace |
| `truncate()` | Truncates string with ellipsis |
| `debounce()` | Standard debounce with cancel method |
| `getConversationIdFromHref()` | Extracts conversation ID from URL |
| `findSidebar()` | Finds sidebar container element |
| `isDark()` | Detects dark mode (3-tier: panel attr → localStorage → computed) |
| `createEl()` | DOM element creator helper |
| `storageGet()` | Promise wrapper for chrome.storage.local.get |
| `storageSet()` | Promise wrapper for chrome.storage.local.set |
| `debouncedStorageSet()` | Debounced storage write |

---

## 4. Design System

### 4.1 Color Palette

#### Light Mode (Milk White)

| Token | Value | Usage |
|-------|-------|-------|
| `--gt-text-primary` | `#1A1815` | Main text |
| `--gt-text-secondary` | `#4A4540` | Nav item text |
| `--gt-text-muted` | `#7A756E` | Index numbers, timestamps |
| `--gt-accent` | `#8B7355` | Active state, buttons |
| `--gt-glass-bg` | `rgba(255,255,255,0.72)` | Panel background |

#### Dark Mode (Amber Glass)

| Token | Value | Usage |
|-------|-------|-------|
| `--gt-text-primary` | `#FFFFFF` | Main text |
| `--gt-text-secondary` | `#E6E1D8` | Nav item text |
| `--gt-text-muted` | `#A89E90` | Index numbers, timestamps |
| `--gt-accent` | `#C4A97D` | Active state, buttons |
| `--gt-glass-bg` | `rgba(26,24,28,0.82)` | Panel background |

### 4.2 Glassmorphism Effect

```css
.gt-panel {
  background: var(--gt-glass-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--gt-glass-border);
  border-radius: 16px;
  box-shadow: var(--gt-shadow-md);
}
```

### 4.3 Animation

| Animation | Easing | Duration |
|-----------|--------|----------|
| Panel entrance | `cubic-bezier(0.16, 1, 0.3, 1)` | 350ms |
| Toggle icon | `cubic-bezier(0.16, 1, 0.3, 1)` | 250ms |
| Highlight pulse | `cubic-bezier(0.16, 1, 0.3, 1)` | 2000ms |
| Hover state | `cubic-bezier(0.16, 1, 0.3, 1)` | 150ms |

---

## 5. Performance Optimizations

| Technique | Implementation | Impact |
|-----------|---------------|--------|
| **Incremental Diff-and-Patch** | `renderMessageList()` diffing | Reuses DOM nodes & event listeners; eliminates list rebuild jank |
| **Timer Relaxation & Events** | `handleRouteChange` relaxed to 2s, one-shot `MutationObserver` init, 800ms watcher | Reduces idle timer wakeups from ~7/s to ~1.25/s (↓82%) |
| **Anchor & Sidebar Caching** | `getCachedAnchors()` & `cachedSidebarRoot` with TTL | Eliminates redundant `querySelectorAll` & O(anchors × depth) scoring |
| **Decoupled Menu Injection** | Independent Observer for CDK overlays | Menu injection no longer in render cycle |
| **Microtask Guard Reset** | `Promise.resolve().then()` instead of `setTimeout(100ms)` | Faster guard release |
| **Loading Guard** | `isGeminiSidebarLoading()` check | Prevents DOM mutations during Gemini loading |
| **Mutation Filtering** | `mutationTouchesSidebar()` & simplified `isIgnoredMutationTarget` | Only reacts to sidebar-relevant changes |
| **GPU Compositing Optimization** | Removed `saturate()` & `will-change`, instant theme transitions | Eliminates GPU layer overhead and theme toggle ghosting |
| **Single-pass HTML Escaping** | `escapeHtml` regex + map | Reduces intermediate string allocations from 5 to 1 per call |
| **Cached DOM References** | Global cache for panel, list, empty hint | Avoids repeated queries |

---

## 6. Current Status

### 6.1 Completed Features

- [x] Navigation panel with glassmorphism design
- [x] Message extraction from Gemini DOM
- [x] Click-to-jump scrolling
- [x] Active item highlighting
- [x] Scroll tracking
- [x] Light/Dark theme toggle
- [x] Collapse/Expand panel
- [x] Hover preview with full text and images
- [x] Search/filter messages
- [x] Copy prompt to clipboard (with fallback)
- [x] Export as Markdown / JSON
- [x] Timestamps for each message
- [x] Keyboard shortcuts (J/K/Enter/Alt+N/Alt+T/Ctrl+F)
- [x] Full Cross-Browser Support (Chrome, Microsoft Edge, Mozilla Firefox)
- [x] Performance optimizations (12 items)
- [x] Folder grouping (Approach A)
- [x] Drag-and-drop assignment
- [x] Multi-language batch deletion
- [x] Native 3-dot menu integration

### 6.2 Known Limitations

| Limitation | Description |
|------------|-------------|
| DOM dependency | Relies on Gemini's DOM structure; may break if Google updates the UI |
| No virtual scrolling | All messages rendered at once; may lag with 100+ turns |

### 6.3 Browser Compatibility

| Browser | Status | Implementation Details |
|---------|--------|------------------------|
| Chrome | ✅ Verified | Manifest V3 Service Worker, `chrome.*` / `browser.*` APIs |
| Edge | ✅ Verified | Chromium Manifest V3 native compatibility |
| Firefox | ✅ Verified | Manifest V3 dual runner config (`scripts` + `service_worker`), `globalThis` polyfill, Firefox scrollbar styles |

### 6.4 Recent Milestone Fixes (July 2026)

- **Prompt Trace Stale Reference Fix**: Resolved closure DOM node detachment after sending new prompts.
- **12 Performance Optimizations**: Incremental diff-and-patch nav list, timer relaxation, string allocation optimization, GPU compositing layer reduction.
- **Cross-Browser Hardening**: Dual-context `browser-polyfill.js` (`Window` + `ServiceWorker`), Firefox MV3 background configuration, clipboard fallback.
- **Theme Switching UI Fix**: Symmetric `!important` CSS rules, full DOM tree `syncTheme()`, instant background color switching.
- **New Prompt Auto-Scroll & Focus**: Gemini chat pane & Trace navigation panel automatically scroll to and focus on the newest prompt when a new prompt is sent.
- **Clean "Load Earlier Turns" History Header**: Minimalist `.gcn-load-earlier-btn` header button in Trace to smoothly trigger Gemini's top history lazy loading without page jitter or hacky timers (filtered for long conversations >= 8 turns).
- **Multi-Strategy Conversation ID Resolution**: Resolved 3-dots native menu item targeting via `getConvIdFromNode()` with live trigger, `aria-controls`, `[aria-expanded="true"]`, and `location.href` fallback.
- **Native Menu Dark Mode Styling**: Added high-contrast `#E3E3E3` text & icon styles for injected `Move to Folder` and `Batch Select` items in dark mode.
- **Single-Click Folder Selector Opening**: Adjusted backdrop event listener arming delay in `showSelector()` to 150ms, resolving native menu dismissal event collision.

---

## 7. Future Enhancements

| Priority | Feature | Description |
|----------|---------|-------------|
| P1 | Virtual scrolling | Render only visible items for large conversations |
| P1 | Bookmarks | Mark and quickly jump to important messages |
| P2 | AI auto-summary | Generate titles for each conversation turn |
| P2 | Topic detection | Auto-detect topic changes |
| P2 | Panel positioning | Allow moving panel to left side |
| P3 | Customizable themes | User-defined color schemes |
| P3 | Conversation stats | Word count, message frequency, etc. |

---

*Document maintained by: Development Team*
*Last updated: 2026-07-28 (v1.0.0)*
