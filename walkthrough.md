# Gemini Trace — Comprehensive Walkthrough & Feature Guide

**Version:** 1.2.6  
**Target Platform:** Google Gemini (`https://gemini.google.com/*`)  
**Extension Name:** Gemini Trace  

---

## 1. Overview

**Gemini Trace** is a high-performance Chrome / Edge Extension (Manifest V3) designed to transform Google Gemini into a structured, highly productive AI workspace. It introduces single-session prompt turn outline navigation on the right side, along with native sidebar folder management, drag-and-drop grouping, multi-language batch deletion, and 100% theme synchronization.

---

## 2. Feature Walkthrough

### 2.1 Trace Navigation Panel (Prompt Turn Outline)

The right-hand **Trace Panel** provides instant visual structure for long single-session conversations with Google Gemini:
- **Prompt Turn Outline**: Automatically extracts every user prompt in the active session into a clean, jumpable outline.
- **Hover Previews**: Hover over long prompt turns in the outline to view full prompt text previews, complete with edge clamping to stay inside viewport bounds.
- **Live Filter & Search**: Instantly filter prompt list by typing keyword queries into the search bar (`Ctrl+F` or `/`).
- **Session Export**: Export the full conversation session directly to **Markdown (`.md`)** or **JSON (`.json`)** with one click from the header action toolbar.
- **Zero-Lag SPA Adaptation**: Intercepts `history.pushState` and `history.replaceState` to update the outline in real time during single-page navigation without reloading.

### 2.2 Folder Management / 分组 (Approach A)

The **Folders Module** organizes all your past Gemini chats directly within the left sidebar using a safe, self-contained top section (`#gt-folders-section`):
- **Top Section Injection**: Injected cleanly at the top of Gemini's sidebar (above Pinned and Recent sections) without mutating Angular-managed native DOM rows.
- **Folder Operations**: Create custom folders, perform inline renaming, select from an 8-swatch color palette (`#4285F4`, `#EA4335`, `#FBBC05`, `#34A853`, `#8E24AA`, `#F06292`, `#00ACC1`, `#795548`), or delete empty/populated folders.
- **Drag-and-Drop Grouping**: Drag any conversation row from Gemini's native sidebar and drop it onto a folder to assign it instantly.
- **Native 3-Dots Popup Menu Integration**: Automatically hooks into Gemini's native Material 3 floating popup menus to add `"Move to Folder"` and `"Batch Select"` options.
- **Opaque Contrast & Badges**: Uses high-contrast styling and inline gold badges (`[Folder Name]`) on categorized rows.

### 2.3 Multi-Language Bulk Deletion

Clean up outdated or redundant chats quickly and safely:
- **Multi-Language Keyword Engine**: Supports deleting conversations across multi-language interfaces (`delete`, `删除`, `刪除`, `削除`, `löschen`, `eliminar`, `supprimer`).
- **Shift+Click Selection**: Select range checkboxes in the sidebar by holding `Shift` and clicking start and end items.
- **Progress Tracking Modal**: Displays a Glassmorphism confirmation dialog and real-time execution progress bar while processing batch operations.

### 2.4 Theme Synchronization (Light & Dark Mode)

- **3-Tier Theme Detector**: Detects theme state via (1) explicit extension toggle (`Alt+T`), (2) `localStorage['gcn-theme-dark']`, and (3) Gemini native dark mode computed surface luminance on `<body>` / `<html>`.
- **Instant Cross-Module Sync**: Invokes `window.GTFolders.syncTheme()` and `window.GTFolders.refresh()` whenever theme switches, ensuring Trace panel, floating dialogs, toasts, and sidebar folders match Gemini's appearance seamlessly.

---

## 3. Installation Guide

Follow these steps to install Gemini Trace in Chrome, Edge, or any Chromium-based browser:

1. **Download / Clone Repository**:
   Ensure you have the full `GeminiTrace` project directory locally.
2. **Open Extensions Page**:
   - In Chrome, navigate to `chrome://extensions/`
   - In Edge, navigate to `edge://extensions/`
3. **Enable Developer Mode**:
   Toggle the **Developer mode** switch in the top-right corner of the page.
4. **Load Unpacked Extension**:
   - Click the **Load unpacked** (加载已解压的扩展程序) button.
   - Select the `GeminiTrace` directory (the folder containing `manifest.json`).
5. **Launch & Verify**:
   - Open [https://gemini.google.com/](https://gemini.google.com/).
   - Confirm the **Gemini Trace** panel appears on the right and the `分组` section appears at the top of the sidebar.

---

## 4. Keyboard Shortcuts Guide

Gemini Trace includes built-in keyboard navigation for power users. Press `?` on any Gemini page to open the built-in Shortcuts Cheat Sheet modal.

| Shortcut | Scope | Description |
| :--- | :--- | :--- |
| <kbd>J</kbd> / <kbd>↓</kbd> | Trace Panel | Move focus down to the next prompt item |
| <kbd>K</kbd> / <kbd>↑</kbd> | Trace Panel | Move focus up to the previous prompt item |
| <kbd>Enter</kbd> | Trace Panel | Smoothly scroll the chat container to the focused prompt message |
| <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>F</kbd> | Trace Panel | Focus live prompt search & filter input |
| <kbd>?</kbd> or <kbd>Shift</kbd>+<kbd>/</kbd> | Global | Toggle Keyboard Shortcuts Cheat Sheet modal |
| <kbd>Alt</kbd>+<kbd>N</kbd> | Global | Collapse or expand the Trace navigation panel |
| <kbd>Alt</kbd>+<kbd>T</kbd> | Global | Toggle glassmorphism Light / Dark theme |
| <kbd>Escape</kbd> | Global / Modal | Clear search query or close active shortcuts modal |

---

## 5. Technical Architecture Overview

### 5.1 Codebase Layout

```
GeminiTrace/
├── manifest.json              # Extension manifest (MV3, Permissions, Content Scripts)
├── background.js              # Background service worker (chrome.commands listener)
├── browser-polyfill.js        # WebExtension API compatibility shim
├── content.js                 # Content script: Trace panel, outline, SPA observer, exports
├── content.css                # Base CSS styles & tokens import
├── css/
│   ├── tokens.css             # Glass design tokens (light & dark theme variables)
│   ├── panel.css              # Trace panel layout, animations, collapsed state
│   ├── sidebar.css            # Sidebar batch selection checkboxes & modal overlays
│   └── folders.css            # Approach A folder section, M3 menu items, badges
├── modules/
│   ├── utils.js              # GTUtils namespace: DOM helpers, storage, sanitization
│   ├── batch-delete.js        # Bulk deletion engine, Shift+Click, multi-lang matching
│   ├── folders.js             # Approach A folder section, drag/drop, M3 menu observer
│   └── integration.js        # Boundary manager (maintains right panel purity)
├── icons/                     # Extension icons (16px, 32px, 48px, 128px)
├── README.md                  # User README
├── BUGFIXES.md                # Comprehensive bugfix log (1.0.0 – 1.2.6)
├── HOW_IT_WORKS.md            # Technical design & architecture documentation
├── TECHNICAL_GUIDE.md         # Developer guide & storage API references
├── PROGRESS.md                # Milestone progress & architecture state
├── 技术方案.md                # Submodule integration technical specification

---

## 6. Recent Quality & Performance Hardening (July 2026)

- **Prompt Trace Stale DOM Resolution**: Replaced closure DOM node snapshots with live click-time resolution (`getUserMessages(true)` containment check) to prevent navigation failure after typing new prompts in active sessions.
- **12 Zero-Functional-Change Performance Optimizations**:
  - Incremental diff-and-patch navigation list rendering (reuses DOM nodes & event listeners).
  - Timer frequency relaxation (idle CPU wakeups ↓82%).
  - GPU compositing optimizations (removed `saturate()` & `will-change`, removed 1px `text-shadow`).
  - Single-pass HTML escaping regex + map.
- **Full Cross-Browser Hardening**:
  - Manifest V3 dual runner config for Chrome, Microsoft Edge, and Firefox.
  - Multi-context `browser-polyfill.js` supporting `Window` and `ServiceWorker`/`globalThis`.
  - Clipboard `document.execCommand('copy')` fallback.
  - Firefox W3C standard scrollbar styles (`scrollbar-width`, `scrollbar-color`).
- **Theme Switch Visual Residue Elimination**:
  - Balanced `!important` declarations across all light and dark CSS rules in `css/folders.css`.
  - Synchronous DOM tree traversal in `window.GTFolders.syncTheme()`.
  - Instant background color switching without transition animation lag.
- **New Prompt Auto-Scroll & Focus**:
  - Automatically detects when a new user prompt is submitted (`freshMessages.length > prevCount`).
  - Triggers smooth auto-scroll on Gemini's chat pane and Trace navigation panel to focus on the newest prompt.
- **Clean "Load Earlier Turns" History Loading**:
  - Added a minimalist `.gcn-load-earlier-btn` button at the top of the Trace list.
  - Filtered to display ONLY on long conversations (`messages.length >= 8`).
  - Allows users to smoothly trigger Gemini's native top history lazy loading without page jitter or hacky timers.
- **GitHub Open-Source `.gitignore` Hardening**:
  - Added `.pem` (private keys), `.crx` (packed binaries), `.zip`, and `.env` to security ignore list to prevent credential leaks.
  - Un-ignored `package.json` and `package-lock.json` so open-source contributors can install dependencies.
  - Un-ignored technical documentation (`HOW_IT_WORKS.md`, `TECHNICAL_GUIDE.md`, `BUGFIXES.md`, `PROGRESS.md`, `walkthrough.md`) so full docs are visible on GitHub.
- **Native Menu & Double-Click Selector Fix**:
  - Resolved conversation ID resolution with multi-strategy `getConvIdFromNode()` lookup.
  - Added high-contrast `#E3E3E3` text & SVG stroke styles for injected native menu items in dark mode.
  - Delayed `activeSelectorMousedownHandler` by 150ms in `showSelector()`, enabling single-click folder popup opening.

