# Gemini Pilot - Bug Fixes & Changelog

This document records all bugs encountered during development and their corresponding fixes.

---

## Bug #1: IntersectionObserver TypeError

**Error:** `Cannot read properties of undefined (reading 'top')`

**Cause:** Using `entry.boundingBoundingClientRect` (undefined property) instead of the correct API.

**Fix:** Changed to `entry.target.getBoundingClientRect()`.

```javascript
// Before
const rect = entry.boundingBoundingClientRect;

// After
const rect = entry.target.getBoundingClientRect();
```

---

## Bug #2: Dark Mode Text Not Visible

**Symptom:** Text was hard to read in dark mode, appeared washed out.

**Cause:** The glassmorphism semi-transparent background reduced text contrast. Original colors were too muted.

**Fix:** Increased text color brightness and added subtle text-shadow.

```css
/* Before */
--gcn-text-primary: #E8E4DC;
--gcn-text-secondary: #A8A29A;

/* After */
--gcn-text-primary: #FFFFFF;
--gcn-text-secondary: #D8D3CA;

/* Added text-shadow for readability */
.gcn-nav-text {
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.4);
}
```

---

## Bug #3: Collapse/Expand Button Icon Confusing

**Symptom:** The button icon was unclear - hamburger menu (three lines) didn't clearly indicate collapse/expand action.

**Fix:** Changed to a chevron arrow (▼/▲) that clearly shows direction.

```svg
<!-- Before: Hamburger menu -->
<path d="M3 4h10M3 8h6M3 12h10"/>

<!-- After: Chevron arrow -->
<path d="M4 6l4 4 4-4"/>
```

CSS rotation handles the direction change:
```css
#gcn-panel.gcn-collapsed .gcn-toggle-icon {
  transform: rotate(180deg);
}
```

---

## Bug #4: Collapsed State Container Too Small

**Symptom:** When collapsed, the container (40px) was too small to fit both theme and toggle buttons.

**Fix:** Increased collapsed width from 40px to 72px.

```css
/* Before */
#gcn-panel.gcn-collapsed { width: 40px; }

/* After */
#gcn-panel.gcn-collapsed { width: 72px; }
```

---

## Bug #5: "You said" Text Appearing in Navigation

**Symptom:** Gemini's accessibility label "你说" (You said) appeared before each prompt in the navigation panel.

**Cause:** The label is in a `<span class="cdk-visually-hidden screen-reader-user-query-label">` element. Two issues:
1. The `.query-text` selector matched the parent container div, whose `textContent` included the label
2. No filtering of accessibility elements

**Fix:**
1. Changed selector from `.query-text` to `.query-text-line` (targets only the actual message element)
2. Added filtering for accessibility elements

```javascript
// Before: Matched parent container (includes label text)
const queryTextEl = userQuery.querySelector('.query-text-line, .query-text, p');

// After: Targets only the message element
const el = userQuery.querySelector('.query-text-line');

// Also filter accessibility elements
if (/cdk-visually-hidden|screen-reader-user-query-label/i.test(cls)) return;
```

**DOM Structure Reference:**
```html
<div class="query-text gds-body-l">
  <span class="cdk-visually-hidden screen-reader-user-query-label">你说</span>
  <p class="query-text-line">Actual message here</p>
</div>
```

---

## Bug #6: Theme System Too Complex

**Symptom:** Auto-follow Gemini theme was unreliable and added complexity.

**Fix:** Simplified to a simple light/dark toggle.

```javascript
// Before: Three modes (auto/light/dark)
const themes = ['auto', 'light', 'dark'];
currentTheme = themes[(currentIdx + 1) % themes.length];

// After: Simple boolean toggle
isDarkMode = !isDarkMode;
```

---

## Bug #7: Text Readability on Glass Background

**Symptom:** Text appeared faint in both light and dark modes due to the semi-transparent glass background.

**Fix:** Multiple improvements:
- Increased font weight from normal to 500
- Added subtle text-shadow
- Increased font size from 12.5px to 13px
- Used higher contrast colors

```css
.gcn-nav-text {
  font-size: 13px;
  font-weight: 500;
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.3);
}
```

---

## Bug #8: Scroll Jumping Bug

**Symptom:** When clicking a nav item to jump to an earlier message, the trace UI would:
1. First jump to the selected item (correct)
2. Then jump back to the starting position (wrong)
3. Then slowly scroll back to the target (following page scroll)

**Cause:** The IntersectionObserver was reconnecting too early (after fixed 1.5s timeout), while the page was still scrolling. It would detect the wrong message as "closest" and update the UI.

**Fix:** Track programmatic scroll state and prevent observer interference.

```javascript
// State variables
let isScrollingTo = false;
let targetIndex = -1;

function scrollToMessage(element, index) {
  isScrollingTo = true;
  targetIndex = index;

  // Disconnect observer during programmatic scroll
  if (scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateActiveNavItem(index);

  // Wait for scroll to actually finish before reconnecting
  waitForScrollEnd(() => {
    isScrollingTo = false;
    targetIndex = -1;
    setupIntersectionObserver();
  });
}

// In observer callback - skip updates during programmatic scroll
scrollObserver = new IntersectionObserver((entries) => {
  if (isScrollingTo) return; // Skip!
  // ... rest of callback
});
```

**Key Insight:** The observer is completely disconnected during programmatic scroll and only reconnected after the page has stopped scrolling for 200ms.

---

## Bug #9: Performance Issues / Lag

**Symptom:** UI felt sluggish, especially with many messages or during rapid scrolling.

**Fixes Applied:**

### 9.1 Incremental Rendering
Added message hash detection to skip unnecessary re-renders:
```javascript
const newHash = messages.length + '_' + (messages[0] ? messages[0].textContent.substring(0, 30) : '');
if (newHash === messageHash) return; // No change, skip render
```

### 9.2 DocumentFragment for Batch Insertion
```javascript
const fragment = document.createDocumentFragment();
messages.forEach((msg, idx) => {
  // ... create item
  fragment.appendChild(item);
});
listContainer.appendChild(fragment); // Single DOM operation
```

### 9.3 requestAnimationFrame for UI Updates
```javascript
function updateActiveNavItem(activeIndex) {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    // Batch DOM updates
  });
}
```

### 9.4 Cached DOM References
```javascript
// Cache globally instead of querying repeatedly
let panelEl = null;
let listContainer = null;
let emptyHint = null;
```

### 9.5 Simplified escapeHtml
```javascript
// Before: Created DOM element for each message
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// After: Regex replacement (much faster)
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
```

---

## Bug #10: Hover Preview Not Showing

**Symptom:** Hovering over nav items showed no preview.

**Cause:** The panel had `overflow: hidden` which clipped the preview element that was positioned outside the panel bounds.

**Fix:**
```css
/* Before */
#gcn-panel { overflow: hidden; }

/* After */
#gcn-panel { overflow: visible; }

/* Move scroll to inner container */
.gcn-message-list { overflow-y: auto; }
```

Also made the preview background more opaque:
```css
.gcn-preview {
  background: rgba(255, 255, 255, 0.95); /* Was 0.65 */
}
```

---

## Bug #11: Scroll Jump Back After Navigation

**Symptom:** When jumping from message 8 to message 1, the trace would:
1. Jump to message 1 (correct)
2. Jump back to message 8 (wrong)
3. Slowly scroll back to message 1 (following page scroll)

**Cause:** The `waitForScrollEnd` was triggering too early due to scroll momentum. The observer would reconnect while the page was still scrolling and detect the wrong message.

**Fix:** Added `isScrollingTo` flag that completely blocks observer updates during programmatic scroll. The flag is only cleared after `waitForScrollEnd` confirms the page has fully stopped.

```javascript
let isScrollingTo = false;

// In observer callback
scrollObserver = new IntersectionObserver((entries) => {
  if (isScrollingTo) return; // Completely skip during programmatic scroll
  // ...
});
```

---

## Bug #12: Preview Tooltip Screen Edge Clipping & Dark Mode Theme Bug

**Symptom:** Hovering on navigation items near the bottom of the screen caused the preview tooltip to be cut off / truncated by the bottom viewport edge. Additionally, dark mode styling was not applying to the preview tooltip.

**Root Cause:**
1. Position was calculated before rendering (`display: block`), so `preview.offsetHeight` could not be measured. `topPos = event.clientY - 80` ignored element height and `window.innerHeight`.
2. Dark mode CSS selector `#gcn-panel[data-gcn-theme="dark"] .gcn-preview` failed because `#gcn-preview` is appended directly to `document.body`, not inside `#gcn-panel`.

**Fix:**
1. Render first with `display: block` and `max-height: calc(100vh - 32px)`, then measure exact rendered height/width.
2. Align preview vertically to center of hovered item, then clamp `topPos` between `16px` and `window.innerHeight - previewHeight - 16px`.
3. Updated CSS selector to `#gcn-preview[data-gcn-theme="dark"]` and propagate `data-gcn-theme` in `applyTheme()` and `showPreview()`.

---

## Bug #13: Message Timestamps Not Displayed / Ineffective

**Symptom:** Navigation items showed no timestamps.

**Root Cause:**
Gemini's DOM does not natively contain `<time>` tags or timestamp text. The `extractTimestamp()` function relied on regex matching `jslog` attributes (`\d{13,}`), which contained Closure component IDs rather than Unix timestamps, resulting in empty strings `''`.

**Fix:**
1. Dynamically record discovery timestamp `userQuery.dataset.gcnTime = Date.now()` when new messages are detected by the extension.
2. Improved `formatTime()` to format relative times ("Just now", "Xm ago"), same-day time (`HH:mm`), and earlier dates (`MMM D`).
3. Added `updateTimestamps()` with a 30-second interval to automatically update displayed relative timestamps without full re-renders.

---

## Optimization #14: Native Extension Commands & Streaming Mutation Defense

**Description:** Added Manifest V3 native `commands` for shortcuts (`Alt+N`, `Alt+T`) and optimized `MutationObserver` performance during Gemini AI streaming output.

**Fix/Enhancement:**
1. Created `background.js` (Service Worker) to listen to `chrome.commands` and forward shortcuts to the content script in active tab. Added `"commands"` configuration to `manifest.json`.
2. Added fast-path skipping in `setupMutationObserver()` to ignore mutations originating from `#gcn-panel`, `#gcn-preview`, and `model-response` streaming containers, eliminating CPU thrashes while Gemini streams responses.

---

## Feature #15: UI UX Pro Max Shortcuts Cheat Sheet Modal & Tooltips

**Description:** Added high-discoverability Keyboard Shortcuts Cheat Sheet modal (`?`) and Header Help Button (`⌨️`) styled with UI UX Pro Max design system (frosted glass, tactile `<kbd>` keycaps, smooth micro-interactions).

**Changes:**
1. Added `.gcn-help-btn` button (`⌨️`) to header actions with tooltip.
2. Built `createShortcutsModal()` displaying categorized shortcuts with 3D tactile `<kbd>` keycap badges.
3. Added `?` / `Shift+/` key shortcut to open/close modal, and `Esc` key dismissal.

---

## Bug #16: Search Bar Overflow When Panel Collapsed

**Symptom:** Opening the search bar and then collapsing the panel caused the search input element to overflow past the right border of the 72px collapsed container.

**Root Cause:**
1. CSS rule for `#gcn-panel.gcn-collapsed` did not set `display: none` for `.gcn-search-bar` or `.gcn-help-btn`.
2. `togglePanel()` did not reset search bar state when collapsing.

**Fix:**
1. Added `#gcn-panel.gcn-collapsed .gcn-search-bar { display: none !important; }` and `.gcn-help-btn` in `content.css`.
2. Updated `togglePanel()` in `content.js` to automatically hide search bar and clear search input when panel is collapsed.

---

## Bug #17: Dark Mode Hover Preview Completely Black Text Bug

**Symptom:** Hovering over navigation items in dark mode resulted in a completely black block ("一片黑色") where preview text was unreadable.

**Root Cause:**
`#gcn-preview` is appended directly to `document.body`, outside `#gcn-panel`. In dark mode, `#gcn-preview[data-gcn-theme="dark"]` set background color to `#1e1c1a`, but `.gcn-preview-text` inherited `--gcn-text-primary: #1A1815` (black text) from `:root`. Black text on dark charcoal background rendered text unreadable.

**Fix:**
Explicitly set `color: #FFFFFF` and `.gcn-preview-text { color: #FFFFFF; }` for `#gcn-preview[data-gcn-theme="dark"]` in `content.css`.

---

## Bug #18: Dark Mode Keyboard Button Standout / Inconsistency Bug

**Symptom:** In dark mode, the keyboard help button (`.gcn-help-btn`) rendered as a bright white square while all other header action buttons rendered as dark glass icons.

**Root Cause:**
Dark mode CSS rules (`#gcn-panel[data-gcn-theme="dark"] .gcn-toggle-btn, ...`) in `content.css` omitted `.gcn-help-btn` and `.gcn-search-btn`. As a result, `.gcn-help-btn` fell back to light mode's `background: rgba(255, 255, 255, 0.5)` on dark backgrounds.

**Fix:**
Added `.gcn-help-btn` and `.gcn-search-btn` to the dark mode background and hover CSS selector list in `content.css`, ensuring 100% visual consistency across all tool buttons.

---

## Bug #19: Dark Mode Shortcuts Modal Faint Text Contrast Bug

**Symptom:** Opening the keyboard shortcuts modal (`?` or `⌨️`) in dark mode showed extremely faint, unreadable dark text on a dark charcoal modal background.

**Root Cause:**
`#gcn-shortcuts-modal` is appended directly to `document.body` outside `#gcn-panel`. Its sub-elements (`.gcn-shortcuts-title`, `.gcn-shortcuts-section-title`, `.gcn-shortcuts-label`) used `:root` light mode variables (`#1A1815`, `#4A4540`, `#7A756E`). Because dark mode theme variables were only scoped to `#gcn-panel[data-gcn-theme="dark"]`, the modal rendered dark grey text on dark background.

**Fix:**
Added explicit dark mode text styles in `content.css`:
- `.gcn-shortcuts-title`: `#FFFFFF` (pure crisp white)
- `.gcn-shortcuts-section-title`: `#C4A97D` (warm gold)
- `.gcn-shortcuts-label`: `#E6E1DA` (high contrast off-white)
- `.gcn-shortcuts-close`: `#E6E1DA` with hover to `#FFFFFF`

---

## Bug #20: Collapsed Panel Layout Optimization & Title Retention

**Symptom:** In collapsed mode, icons were arranged vertically, leaving empty space on the right, and the "Gemini Pilot" title disappeared completely.

**Root Cause:**
1. `togglePanel()` in `content.js` cleared `.gcn-title` text content when collapsed.
2. `#gcn-panel.gcn-collapsed .gcn-title` set `display: none` in CSS.
3. `.gcn-header-actions` did not force `flex-direction: row` horizontally for theme & toggle buttons when collapsed.

**Fix:**
1. Removed title clearing in `togglePanel()` so "Gemini Pilot" stays visible at the top of the collapsed panel.
2. Updated `content.css` to keep `.gcn-title` visible (`display: block !important`, `font-size: 9px`), force horizontal icon row (`flex-direction: row !important`), and reduce container width to a compact `80px`.

---

## Feature #21: Server RPC `/batchexecute` Network Interception & Timestamp Parsing

**Requirement:** Access real server-sent timestamps for both historical chat turns (loaded on page load) and new prompt messages.

**Solution:**
1. Injected a main-world network interceptor script overriding `window.fetch` and `XMLHttpRequest.prototype.send`.
2. Intercepted Google Gemini's background `/_/BardChatUi/data/batchexecute` RPC responses.
3. Stripped security prefix `)]}'` and recursively extracted Unix timestamps (10-digit seconds and 13-digit milliseconds).
4. Passed timestamps to content script via `window.postMessage`, mapping them sequentially to `<user-query>` elements (`q.dataset.gcnTime`) and updating the UI timestamp badges dynamically.

---

## Bug #22: Historical Messages All Defaulting to "Just now" Fix

**Symptom:** Opening an existing historical conversation showed "Just now" for all historical message turns regardless of how long ago they were sent.

**Root Cause:**
1. `extractTimestamp()` previously executed `userQuery.dataset.gcnTime = Date.now().toString()` on ALL pre-existing historical `<user-query>` elements during initial page load rendering. Since `Date.now()` is current time, `formatTime()` calculated `diff = 0ms` for every single historical turn.
2. `extractUnixTimestamps()` in the interceptor only looked for numeric 10-digit/13-digit numbers, missing microsecond timestamps (`16-digit`) and numeric strings embedded in Google's inline `AF_initDataCallback` scripts.

**Fix:**
1. Updated `extractTimestamp()` in `content.js` to NOT set `Date.now()` on pre-existing historical messages. Only newly sent messages during active conversation are stamped with `Date.now()`.
2. Added `scanPageInlineScripts()` to scan inline `<script>` tags on initial page load for Google's embedded `AF_initDataCallback` Unix timestamps.
3. Enhanced `extractUnixTimestamps()` to parse microseconds, numeric strings, and ISO dates.

---

## Bug #23: Gemini Pilot v2.0 Sidebar Integration & Multi-language Batch Delete Fixes

**Symptom:** Newly added `modules/` (batch delete & folders) failed on non-English UI (Chinese Gemini UI), `manifest.json` omitted `content.css`, dialog overlays lacked dark mode styling, and `css/panel.css` broke collapsed panel width/title retention.

**Root Cause:**
1. `modules/batch-delete.js` used hardcoded `'delete'` text matching, failing completely on Chinese (`'删除'`) interfaces.
2. `modules/folders.js` used native browser `prompt()` and `confirm()` blocking functions instead of UI UX Pro Max glass dialogs.
3. `manifest.json` omitted `content.css`, leaving navigation panel unstyled if loaded standalone.
4. `css/panel.css` set collapsed width to `72px` and hid `.gcn-title`.

**Fix:**
1. Rewrote `modules/batch-delete.js` to support multi-language keyword array (`['delete', '删除', '刪除', '削除', 'löschen', 'eliminar', 'supprimer']`), Shift+Click range selection, and robust selector matching.
2. Rewrote `modules/folders.js` with UI UX Pro Max modal dialogs, drag & drop handlers, and theme synchronization.
3. Updated `manifest.json` to include `content.css`.
4. Fixed `css/panel.css` collapsed rules: `width: 80px`, title `GEMINI TRACE` visible (`display: block !important`), horizontal icon flow.
5. Updated `applyTheme()` in `content.js` to synchronize theme attributes across right-side panel, left-side toolbar, folder panels, and modal dialogs.

---

## Feature #24: Direct Native 3-Dots Menu & Sidebar Row Injection

**Requirement:** Inject custom folder assignment options directly into Gemini's native 3-dots popup menu (`分享`, `固定`, `重命名`, `删除`) and display folder badges directly on native conversation sidebar rows.

**Solution:**
1. Implemented `setupNativeMenuObserver()` in `modules/folders.js` monitoring `document.body` for Gemini's floating popup menu (`[role="menu"]`, `.mat-mdc-menu-panel`).
2. Injected a native-styled `📁 移入文件夹...` (`.gt-native-menu-item`) button directly into Gemini's native popup menu above `🗑️ 删除`.
3. Implemented `injectRowBadges()` appending `<span class="gt-row-folder-badge">📁 论文精读</span>` directly onto conversation list item rows in Gemini's native left sidebar.

---

## Bug #25: Native Menu Click No-Response & Missing Batch Select Item Fix

**Symptom:** Clicking `📁 移入文件夹...` inside Gemini's native 3-dots popup menu resulted in no visual response, and `☑️ 进入批量模式...` was missing from the popup menu.

**Root Cause:**
1. `showFolderSelector()` was missing from `modules/folders.js`, causing a silent `ReferenceError` when clicking `📁 移入文件夹...`.
2. Menu click handler closed the native menu before reading `moveItem.getBoundingClientRect()`, causing popup positioning coordinates to evaluate to `(0, 0)`.
3. Native menu interceptor omitted `☑️ 进入批量模式...`.

**Fix:**
1. Added complete implementation of `showFolderSelector()` and `showCreateFolderModalAndAdd()` in `modules/folders.js`. If no folders exist, clicking `+ 新建文件夹...` or `📁 移入文件夹...` opens a modal allowing instantaneous creation and automatic archiving.
2. Saved click coordinates `(x, y)` prior to dismissing Gemini's native popup menu.
3. Injected `☑️ 进入批量模式...` directly into Gemini's native 3-dots popup menu, enabling 1-click entry into sidebar batch selection mode.

---

## Feature #26: Clean Right Panel Header - Removed Misplaced Sidebar Buttons

**Symptom:** Batch Delete (`🗑️`) and Folder Management (`📁`) icons were placed in the right-side **Gemini Pilot** navigation header, confusing users because right panel is for single-session turn navigation.

**Fix:**
1. Updated `modules/integration.js` to completely remove `addSidebarActions()`.
2. Kept the right-side **Gemini Pilot** header strictly dedicated to session turn navigation (`⌨️`, `🔍`, `📥`, `☀️/🌙`, `▲`).
3. Positioned all sidebar batch delete and folder management actions exclusively on Gemini's left sidebar where conversation history lives (`📁 移入文件夹...`, `☑️ 进入批量模式...`).

---

## Feature #27: Custom Folder Name Input & Automatic Archiving Flow

**Requirement:** Ensure users can type their own custom folder name (e.g. `论文精读`, `代码重构`) when clicking `📁 移入文件夹...`.

**Solution:**
1. Refined `showFolderSelector()` in `modules/folders.js`. When no folders exist, clicking `📁 移入文件夹...` immediately opens the `showCreateFolderModalAndAdd()` input modal.
2. Added `✏️ 输入新文件夹名称...` as the top item in the folder dropdown menu when existing folders are present, letting users type a brand new folder name anytime.
3. Once the user types the name and presses Enter or clicks "创建并归档", the folder is created and the conversation is automatically archived into it in one seamless step.

---

## Feature #28: 100% Codebase English Standardization

**Requirement:** Convert all UI strings, buttons, modals, toasts, comments, and options across the entire codebase into crisp, professional English.

**Solution:**
1. Converted all UI labels and dialog text in `modules/folders.js` (`📁 Folders`, `Move to Folder...`, `Batch Select...`, `New Folder & Archive`, `Enter folder name:`, `Create & Archive`, `Confirm Delete Folder`, Toast notifications).
2. Converted all UI labels and dialog text in `modules/batch-delete.js` (`⚡ Batch Delete`, `Select All`, `Delete Selected`, `Confirm Batch Delete`, `Batch Deletion Complete`).
3. Standardized all internal code comments and modal dialog texts across `content.js` and `modules/integration.js`.

---

## Bug #29: SPA Conversation Switch Blank Prompt List Fix

**Symptom:** Switching between conversations in Gemini's sidebar left the right-side Trace panel prompt list blank.

**Root Cause:**
1. Polling `location.href` at 1s intervals missed client-side SPA route transitions and suffered a timing race condition with DOM mounting.
2. `messageHash` cached the previous conversation state, preventing `renderMessageList()` from re-rendering when navigating to a new conversation URL with different prompts.

**Fix:**
1. Hooked into HTML5 `history.pushState`, `history.replaceState`, and `popstate` events in `content.js` for 0ms instantaneous route change detection.
2. Included `location.href` inside `newHash` in `renderMessageList()` to guarantee that switching conversations ALWAYS invalidates the stale hash.
3. Implemented a 400ms retry poll (`rebindTimer`) when switching conversations to continuously bind new `<user-query>` DOM elements as soon as Gemini finishes mounting them.

---

## Feature #30: Pixel-Perfect Native Menu Alignment & Material Line-Art Icons

**Requirement:** Replace emoji icons (`📁`, `☑️`) with clean line-art SVG icons matching Gemini native menu items (`分享`, `固定`, `重命名`, `删除`), and align custom menu items pixel-perfectly with native items.

**Solution:**
1. Replaced emojis in `modules/folders.js` with clean 20x20 line-art SVG icons (Outline folder SVG for `Move to Folder...`, Outline multi-checklist SVG for `Batch Select...`).
2. Updated `css/folders.css` with exact Material Design measurements (`height: 48px`, `padding: 0 16px`, `icon width: 24px`, `margin-right: 14px`).
3. Guaranteed 100% pixel-perfect horizontal alignment of text and icons with native Material menu items.

---

## Feature #31: Removal of Trailing Ellipsis Dots From Custom Menu Items

**Requirement:** Remove trailing `...` ellipsis dots from custom popup menu item labels to keep text clean and concise.

**Solution:**
1. Updated `modules/folders.js` to change `Move to Folder...` to `Move to Folder`.
2. Changed `Batch Select...` to `Batch Select`.
3. Updated dropdown and modal headers to `Move to Folder` and `Type new folder name`.

---

## Bug #32: Modal Layout Redesign & Batch Selection DOM Matcher Fix

**Symptom:**
1. Folder creation modal had clipped input text (`e.g. Research Papers / Code F...`) and plain brown button styling.
2. Clicking `Batch Select` produced no visual response or checkboxes on sidebar conversation rows.

**Root Cause:**
1. `css/sidebar.css` contained a CSS syntax error on line 170 (unclosed `.gt-dialog-actions` block), breaking modal layout calculations and causing input boxes to overflow.
2. `getConversationItems()` relied on outdated `a[data-test-id="conversation-item"]` selectors, failing to match Gemini's updated `conversation-item-viewer` / `mat-list-item` DOM nodes.

**Fix:**
1. Fixed CSS syntax error in `css/sidebar.css` and redesigned `.gt-dialog` with high-end UI UX Pro Max glassmorphism (`min-width: 380px`, `backdrop-filter: blur(24px)`, premium gold gradient primary button `linear-gradient(135deg, #A88B60, #8B7355)`).
2. Updated `getConversationItems()` in `modules/batch-delete.js` and `modules/folders.js` to match all modern Gemini sidebar items (`conversation-item-viewer`, `mat-list-item`, `[role="listitem"]`).
3. Added `padding-left: 32px` to conversation rows during batch mode to prevent checkboxes from overlapping text, and added gold amber highlight background (`.gt-conv-selected`) for checked rows.

---

## Bug #33: Reference Open-Source Integration & Floating Bar Batch Selection

**Symptom:**
Legacy selection mode inserted inline toolbars inside crowded sidebar headers, making it hard to see and click when batch mode was active.

**Solution (Learned from `reference/gemini-bulk-delete-extension` and `reference/cone-deck-for-gemini`):**
1. **Dual-Strategy Sidebar Matcher**: Combines 3-dots popup menu button queries (`button[aria-label*="options" i]` where `left < 450px`) with fallback anchor queries, matching 100% of conversation rows in modern Gemini DOM.
2. **Floating Bottom Action Bar**: Positioned at `bottom: 28px; left: 50%; transform: translateX(-50%)` with frosted glass, displaying live count `Selected: N`, `Select All`, `Delete Selected`, and `Cancel` buttons.
3. **Shift+Click Range Selection**: Enables multi-select across lists with Shift+Click.

---

## Bug #34: Silent Batch Deletion & Menu Flashing Suppression

**Symptom:**
During automated batch deletion, native 3-dots popup menus containing `Move to Folder` and `Batch Select` flashed on screen for each deleted conversation.

**Root Cause:**
1. Programmatic `menuBtn.click()` during deletion triggered Gemini's native 3-dots menu to pop open visually.
2. `setupNativeMenuObserver()` in `modules/folders.js` observed `document.body` for `[role="menu"]` and injected custom items onto the opening popup menu during deletion.

**Fix:**
1. Updated `setupNativeMenuObserver()` in `modules/folders.js` to skip menu item injection whenever `window.GTBatchDelete?.isActive()` is true.
2. Injected a temporary silent style tag (`#gt-hide-batch-menus` with `opacity: 0 !important`) during `startBatchDelete()`, making programmatic menu clicks completely invisible and silent, with clean removal in `finally`.

---

## Bug #35: Batch Progress Bar Pre-Execution Hiding Fix

**Symptom:**
The floating action bar displayed `0/0` with a progress line before the user clicked `Delete Selected`.

**Root Cause:**
`css/sidebar.css` contained `.gt-batch-progress { display: flex !important; }`, which overrode the inline `style="display: none;"` on the floating bar's progress container, forcing the progress bar to show `0/0` prematurely.

**Fix:**
Changed `.gt-batch-progress` in `css/sidebar.css` to `display: none;` and added `.gt-batch-progress.active { display: flex !important; }`. Toggled the `.active` class in `modules/batch-delete.js` only when `startBatchDelete()` begins executing.

---

## Feature #36: Native Sidebar Folder Tree Accordion Engine

**Requirement:** Render a 100% native folder tree directly inside Gemini's left sidebar DOM, drawing inspiration from `reference/cone-deck-for-gemini/organizer.js`.

**Solution:**
1. Built `#gt-folders-panel` inside `modules/folders.js`, mounted directly at the top of Gemini's sidebar drawer container.
2. Implemented expandable accordion tree nodes (`▸ 📁 Research Papers (2)`), displaying nested assigned conversation titles (`📄 Deepfake-Eval-2024 论文解读`).
3. Enabled HTML5 Drag-and-Drop: dragging any native sidebar conversation item onto a folder row instantly moves it into that folder.
4. Integrated folder filtering, inline row badges, and custom folder creation/deletion modals with UI UX Pro Max glass styling.

---

## Bug #37: Folder Moving Thread Freeze & Mutation Observer Loop Fix

**Symptom:** Moving a conversation to folder "1" caused the browser UI thread to lock up/freeze.

**Root Cause:** `refreshFolderUI()` and `injectRowBadges()` mutated sidebar DOM nodes, which repeatedly triggered `setupNativeMenuObserver()` on `document.body` in a recursive infinite loop.

**Fix:** Added an `isUpdatingDOM` reentrancy guard flag to `setupNativeMenuObserver()`, `refreshFolderUI()`, and `injectRowBadges()`, preventing recursive `MutationObserver` triggers.

---

## Bug #38: Timestamp Mismatch ("4月2日" vs Current Date 2026/7/27)

**Symptom:** Turn 1 displayed "4月2日" (April 2nd) when the conversation was active today (July 27, 2026).

**Root Cause:** `scanPageInlineScripts()` used a broad regex (`/1[6-8]\d{8,14}/g`) with a 2020 lower bound (`1577836800`), matching static Google library constants (`1585785600000` = April 2, 2020 UTC).

**---

## Bug #39: Theme Desync & Folders Component Background Bleed-Through

**Symptom:** When toggling dark mode via the Trace panel button (`Alt+T`), the Trace panel turned dark, but the folders component in the left sidebar stayed white (font text turned lighter, but background remained white).

**Root Cause:**
1. The folders section `#gt-folders-section` sits inside Gemini's native sidebar, which is natively white. The dark mode CSS in `folders.css` used transparent `rgba(255, 255, 255, 0.04)` backgrounds, allowing Gemini's native white sidebar to bleed through.
2. `applyTheme()` in `content.js` targeted the stale legacy `#gt-folders-panel` ID instead of `#gt-folders-section`.

**Fix:**
1. Updated `folders.css` to use opaque dark `#1C1B1F` backgrounds for `#gt-folders-section[data-gcn-theme="dark"]`, `.gt-folders-header`, `.gt-folders-list`, `.gt-folder-row`, `.gt-folder-row-head`, `.gt-folder-convs`, `.gt-folder-conv`, and `#2A2830` for hover states.
2. Updated `content.js:applyTheme()` to target `#gt-folders-section` directly (alongside legacy `#gt-folders-panel`) and set theme attributes on all overlays (`.gt-dialog-overlay`, `.gt-folder-selector-overlay`, `.gt-folder-menu-overlay`, `.gt-toast`).
3. Added `GTFolders.syncTheme()` API in `modules/folders.js` for immediate non-deferred theme updates alongside `GTFolders.refresh()`.

---

## Bug #40: Folder Auto-Collapse on Child Item Click (`.gt-folder-conv`)

**Symptom:** Clicking a conversation item (`.gt-folder-conv`) inside an expanded folder navigated to the conversation correctly, but the parent folder automatically collapsed and hid its contents until the folder header was clicked again.

**Root Cause:** The click event on the child conversation item (`.gt-folder-conv`) bubbled up to its parent folder container (`.gt-folder-row`). The parent container's click listener called `toggleCollapse(folder.id)`, flipping the folder state from expanded (`false`) to collapsed (`true`).

**Fix:**
1. Added `e.stopPropagation()` in `.gt-folder-conv` click and keydown event handlers in `modules/folders.js`.
2. Added guard check `if (e.target.closest('.gt-folder-menu-btn, .gt-folder-convs, .gt-conv-remove')) return;` in `.gt-folder-row` click and keydown event handlers.

---

## Summary

| Bug / Feature | Root Cause | Fix / Action |
|---------------|-----------|--------------|
| IntersectionObserver TypeError | Wrong API usage | `entry.target.getBoundingClientRect()` |
| Dark mode text invisible | Low contrast on glass | Brighter colors + text-shadow |
| Collapse icon confusing | Hamburger menu unclear | Chevron arrow icon |
| Collapsed container too small | Width 40px | Increased to 72px |
| "You said" in navigation | Wrong selector + no filtering | `.query-text-line` + filter accessibility |
| Theme complexity | Auto-follow unreliable | Simple boolean toggle |
| Text readability | Faint on glass | Font-weight + shadow + contrast |
| Scroll jumping | Observer reconnect too early | State tracking + disconnect/reconnect |
| Performance lag | Inefficient rendering | rAF, DocumentFragment, caching |
| Hover preview not showing | `overflow: hidden` clip | `overflow: visible` + opaque background |
| Scroll jump back | Observer fires during scroll | `isScrollingTo` flag blocks updates |
| Preview tooltip edge clipping | Missing `box-sizing: border-box` + async `img.onload` height expansion | `box-sizing: border-box`, `updatePreviewPosition()` clamping, `img.onload` recalculation |
| Message timestamps ineffective | Gemini DOM lacks timestamps; `jslog` regex failed | Auto-stamp `dataset.gcnTime`, improve `formatTime` (HH:mm), add 30s auto-refresh |
| Streaming lag & fixed shortcuts | `MutationObserver` thrashed on AI output | Add `background.js` Manifest V3 commands + fast-skip `model-response` in `MutationObserver` |
| Collapsed search bar overflow | Search bar & help btn not hidden under `.gcn-collapsed` | Added `display: none !important` in CSS & auto-close search in `togglePanel()` |
| Dark mode preview black text | Text inherited black color on dark background | Explicit `color: #FFFFFF` on `#gcn-preview[data-gcn-theme="dark"]` |
| Dark mode keyboard btn background | `.gcn-help-btn` omitted from dark CSS selectors | Added `.gcn-help-btn` to dark mode header button selectors in `content.css` |
| Dark mode shortcuts modal faint text | Scoped `:root` light variables used on dark modal | Explicit high-contrast white `#FFFFFF` & gold `#C4A97D` text rules |
| Collapsed layout & title retention | Vertical icons + title cleared in JS & hidden in CSS | Preserved "Gemini Pilot" title, forced horizontal icon row, compact 80px container |
| Server timestamp network interception | Gemini DOM omits timestamps; data exists in RPCs | Injected main-world `fetch`/`XHR` interceptor parsing `/batchexecute` Unix timestamps |
| Historical messages "Just now" bug | Past messages stamped with `Date.now()` on load | Stop auto-stamping `Date.now()` on historical turns; add `scanPageInlineScripts()` |
| Sidebar modules & multi-language fix | Hardcoded 'delete', missing content.css, broken collapsed CSS | Multi-lang delete keywords, UI UX Pro Max modals, sync theme & restore 80px collapsed panel |
| Direct native menu & row injection | Gemini native 3-dots menu lacked custom options | Injected `📁 Move to Folder` into 3-dots menu & injected folder badges onto native sidebar rows |
| Native menu click no-response bug | Missing `showFolderSelector()` + missing batch item | Implemented `showFolderSelector`, added `+ New Folder & Archive`, and injected `☑️ Batch Select` |
| Misplaced right header buttons | Sidebar buttons placed in right-side Trace panel | Removed `🗑️` & `📁` from right header; kept right panel focused strictly on Trace navigation |
| Custom folder name input flow | Need immediate user input for folder names | Auto-open input modal if no folders exist; add `✏️ Type new folder name` option |
| 100% Codebase English Standardization | Non-English strings in code files | Converted all UI labels, dialogs, toasts, comments, and buttons to 100% Crisp English |
| SPA conversation switch blank list | Slow 1s URL polling & stale `messageHash` cache | Intercept History API, embed `location.href` in hash, and re-bind new conversation DOM |
| Pixel-perfect native menu alignment | Misaligned custom items & confusing emojis | Replaced emojis with line-art SVGs & matched 48px height, 16px padding, 14px icon gap |
| Trailing ellipsis dots removal | Unnecessary `...` in menu labels | Removed trailing `...` from `Move to Folder` and `Batch Select` |
| Modal redesign & batch DOM fix | Syntax error in sidebar.css & outdated item selectors | Redesigned modal with 380px width & gold gradient button; updated DOM matchers for `conversation-item-viewer` |
| Reference Open-Source Integration | Need robust floating bar & dual-strategy DOM matcher | Integrated reference architectures: dual menu/anchor DOM matcher & bottom floating action bar |
| Silent Batch Deletion & No Flashing | Native menus flashed during automated deletion | Added `window.GTBatchDelete?.isActive()` check + `#gt-hide-batch-menus` (`opacity: 0 !important`) |
| Progress Bar Pre-Execution Hiding | `css/sidebar.css` forced `display: flex !important` | Switched to `.gt-batch-progress.active` class activated only during `startBatchDelete()` |
| Native Sidebar Folder Tree Engine | Render native tree directly in Gemini sidebar DOM | Built `#gt-folders-panel` accordion tree with sub-item links, drag & drop, and glassmorphism styling |
| Folder Moving Thread Freeze Fix | `MutationObserver` reentrant loop on badge update | Added `isUpdatingDOM` guard flag in `setupNativeMenuObserver()` and `addToFolder()` |
| Timestamp Mismatch Fix ("4月2日") | Script scraper matched static Google 2020 constants | Updated extraction bounds to year 2025+ (`1735689600000`), filtering Google library constants |
| Theme Desync: Folders Section | CSS used transparent `rgba(255,255,255,0.04)` backgrounds inside Gemini's white sidebar; also stale `#gt-folders-panel` ID in JS | Opaque `#1C1B1F` backgrounds for ALL dark mode elements in `folders.css`; target `#gt-folders-section` in `content.js`; add `GTFolders.syncTheme()` API |
| Folder Auto-Collapse on Item Click | Click event on child conversation item (`.gt-folder-conv`) bubbled up to parent `.gt-folder-row` container | Added `e.stopPropagation()` in `.gt-folder-conv` click/keydown handlers & added guard check in `.gt-folder-row` click handler |
| Architecture & Performance Optimization | MutationObserver thrashing, layout reflows, code duplication & memory leaks | Created `modules/utils.js` (`window.GTUtils`), fast short-circuit mutation filters, cached DOM queries, cleaned event listener leaks, and debounced storage operations |
| Gemini Native Sidebar Loading Freeze & Faint Theme Fix | Broad MutationObserver on `document.body` caused infinite render feedback loop during Gemini sidebar loading | Implemented `mutationTouchesSidebar()` filter in `folders.js`, loading state guard, and high-contrast theme variables in `tokens.css` |

---

*Last updated: 2026-07-28 (v1.0.0)*

---

## Bug #N: Timeline Misalignment (Mixed "Just now" + Real Timestamps)

**Symptom (reported 2026-07-27):** In a single session with N user messages, the timeline labels were inconsistent — the first message showed a real historical date (e.g. "Apr 2"), while every other message fell back to "Just now". Visible in user screenshot for the 6-message case.

**Root cause:** The `extractTimestamp()` function was distributing an array of *session-level* Unix timestamps (`serverTimestamps`) extracted from Gemini `/batchexecute` RPC responses — one per array slot. Because those are session-level timestamps (not per-message send times), `serverTimestamps[0]` happened to resolve to the session's creation / last-update time, but `serverTimestamps[1..N]` were all `undefined`. The fallback `Date.now()` then assigned "Just now" to every other message.

**Fix:** Per-message timestamps are now stored directly under a key composed of `(chatId, hash(messageText))` in `chrome.storage.local`. Each message is timestamped at first observation on the user's device, and that timestamp persists across reloads and session switches. `serverTimestamps` is no longer propagated to message DOM nodes.

**Files touched:**
- `content.js`
  - Removed `serverTimestamps` global; replaced with `tsMemoryCache` keyed on chatId.
  - Added `getActiveChatId()`, `hashMsgText()`, `loadChatTsMap()`, `persistChatTsMap()`.
  - Rewrote `extractTimestamp(userQuery)` (no more `idx` argument).
  - `applyServerTimestamps()` is now a no-op; callers still safely invoke it.

---

## Change: v3 Native In-place Grouping + Timestamp Removal (2026-07-27)

**User request:** Group conversations DIRECTLY inside Gemini's native sidebar list (not a separate panel), and remove the timestamp feature entirely.

**Root cause of "grouping still not working":** The v2 `render()` still invoked `resolveMount()` (renamed to `getListContainer()`) and `buildFolderSection()` (deleted) — both `ReferenceError` at runtime, so the panel never mounted. The file was left inconsistent by an interrupted previous edit.

**Fix (modules/folders.js):**
- Rewrote `render()` to splice a `＋ 新建分组` toolbar + per-folder headers INTO the native list container (`getListContainer(anchors)`), then physically MOVE the native conversation rows (never clone) right after their folder header. Every move guarded by `previousElementSibling !== cursor` → steady state produces zero DOM mutations (no observer loop).
- Collapsed folders hide their rows via `.gt-hidden-native`; unassigned rows stay visible and unflagged.
- `collectLive(listRoot)` now computes the movable DIRECT child block of the list root (not a deeply-nested element), preventing layout breakage.
- `isOwnNode` now also treats `[data-gt-folder-ui]` as own UI, so our injected nodes no longer spuriously trigger re-renders.
- Health-check interval now re-polls for anchors when the toolbar is absent (replaces the old `PANEL_ID` check).
- Batch-delete mode: `render()` drops all our UI and leaves the native list pristine.

**Timestamp removal (content.js):** Deleted cleanly — `tsMemoryCache`, `getActiveChatId`, `hashMsgText`, `loadChatTsMap`, `persistChatTsMap`, the `/batchexecute` network interceptor (`injectNetworkInterceptor`), `applyServerTimestamps`, `scanPageInlineScripts`, `extractTimestamp`, `formatTime`, `updateTimestamps`, and all call sites (nav list, export JSON, Markdown export, boot `setInterval`). No timestamp references remain (`grep` clean).

**CSS (css/folders.css):** Appended v3 native-in-line section (`.gt-groups-toolbar`, `.gt-groups-new-btn`, `.gt-folder-header`, `.gt-grouped-row`, `.gt-current-conv`, dark-mode overrides). Old panel rules left in place (harmless).

**Manifest:** version 1.0.0 → 1.0.0.

---

## Bug: Grouping UI Lost After Sidebar / "Recent" Section Collapse (2026-07-27, ~21:43)

**Symptom (reported):** Grouping now renders inline in the native list, but "收起后就不见了" — after collapsing the Gemini sidebar (or the Recent section), the grouping UI disappears and does not return.

**Root cause:** `render()` called `removeGroupUI()` whenever `isSidebarCollapsed(listRoot)` was true. Gemini collapses/expands the sidebar (and the Recent history section) in ways that frequently do NOT emit a `childList` mutation our `MutationObserver` watches (it only observes `childList`+`subtree`, not `attributes`/`resize`). The old 1.5s health-check only re-rendered when `toolbarEl` was missing AND anchors existed — but during the collapse→expand transition, width checks could flap and the window was missed, leaving the UI gone.

**Fix (`modules/folders.js` `startObservers`):** Replaced the brittle health-check with a **collapse-state-machine poller** (800ms). It records `lastCollapsed` and triggers `scheduleRender()` on *any* state flip (`collapsed !== lastCollapsed`) or whenever the toolbar is unexpectedly absent while it should show. This is deterministic (no dependency on a specific DOM event) and cannot loop (steady states produce no render). On expand, the group UI is re-spliced into the rebuilt native list automatically.

---

## Bug: Native Grouping Controls Rendered Vertically / Header Crowded (2026-07-27, ~22:00)

**Symptom:** The inline `＋ 新建分组` control collapsed into a narrow vertical button. Folder headers lost their visual hierarchy, icons and counts were squeezed together, and the injected controls did not look like part of Gemini's native sidebar.

**Root cause:** Gemini applies flex/grid and writing/layout constraints to direct children of the history scroller. The injected controls had no explicit width, shrink, writing-mode, or intrinsic-size constraints. The original header also used emoji/glyph text and separate action buttons, which consumed unpredictable width in a narrow sidebar.

**Fix:**
- Rebuilt the toolbar as a full-width native-style row: `分组` label on the left and a compact horizontal `＋ 新建` pill on the right.
- Replaced emoji/glyph controls with consistent line-art SVG icons and added accessible labels, keyboard support, and visible focus behavior.
- Added explicit `width`, `min-width`, `flex-shrink`, `white-space`, `writing-mode`, and `box-sizing` rules with narrow-sidebar media handling.
- Reworked folder headers into a stable row: chevron, outline folder icon, ellipsized name, count badge, and hover/focus actions.
- Added theme selectors that correctly apply when `data-gcn-theme` is placed on the injected node itself.

**Files:** `modules/folders.js`, `css/folders.css`, `manifest.json` (version 1.0.0 → 1.0.0).

---

## Bug: Two "GEMINI TRACE" Cards Side by Side After Collapse (2026-07-27, ~22:38)

**Symptom (reported):** After clicking "收起" (collapse) on the Trace panel, the panel rendered as TWO separate floating cards side by side — both labelled "GEMINI TRACE". Left card showed `help / search / export`, right card showed `theme / toggle`. Reproduced by reloading the extension while the Gemini page was still open and then collapsing the panel.

**Root cause:** `createPanel()` was not idempotent. Two independent paths can invoke it:
1. `init()` (guarded by `panelInjected` — runs once per content-script instance).
2. `handleRouteChange()` (re-runs every 400 ms via `setInterval`, on every `pushState`/`replaceState`/`popstate`).

In MV3, when the extension is reloaded while the page is open, the new content-script instance re-runs `init()` while the OLD instance's DOM node may still be in `document.body`. Both instances then create their own `#gcn-panel` and append it to `document.body`. With `position: fixed; right: 16px` on both, the second one renders *next to* the first one (because the first's computed `right` is its right edge, and the second is appended after it). The duplicate panels show side-by-side as in the user's screenshot.

A second race exists on cold load: if the user navigates within Gemini *before* `init()`'s `getUserMessages().length > 0` fires, `handleRouteChange()` runs with `panelEl === null` and creates a panel, then `init()` creates another one.

**Fix (`content.js` `createPanel()`):**
- Added a top-of-function idempotency guard: `document.querySelectorAll('#gcn-panel')` — if more than one exists, all but the FIRST are removed (order-stable regardless of which path arrived first).
- If a panel exists, reuse it; re-bind event listeners only when `dataset.gcnBound` is unset, so we never double-bind handlers.
- After binding, set `panelEl.dataset.gcnBound = '1'` so subsequent calls skip re-binding.
- The original-creation path also sets the flag, so the first-time path and the reuse path are mutually exclusive.

**Verification:**
- `node --check content.js` passes.
- Mock DOM unit test (`idempotency2.js`) confirms: starting with 1 panel → 2 orphans injected → cleanup → back to 1; 5 strays injected → cleanup → back to 1; 2 more strays → cleanup → back to 1. PASS in all cases.
- Headless Chrome screenshot of the same scenario (two panels → run guard → render): collapsed panel renders as a single "GEMINI TRACE" + theme + toggle card, matching the expected collapsed layout.

**Files:** `content.js` only (no CSS, no manifest bump — this is a defensive fix, no behavioural change for users who never hit the race).

---

## Bug / Change: Folders rearchitected from native in-place (v3) to Approach A (self-contained top section)

**Date:** 2026-07-27
**User decision:** After reviewing DeepSeek-Folder-Organizer and claude-nexus (both Approach A), the user chose to switch the Folders feature to **Approach A — a self-contained "分组" section injected at the TOP of Gemini's native conversation sidebar**. This reverses the earlier "native in-place DOM" (v3) direction.

**What changed (architecture):**
- v3 moved Gemini's native conversation rows physically under injected folder headers (inline grouping). Approach A instead injects ONE `#gt-folders-section` at the top of the conversation list and renders folders + their conversations from our own `chrome.storage.local` state. Native Gemini rows are **never touched or reordered**.
- Assignment entry points kept from v3: right-click a native row → selector popup; native 3-dots "Move to Folder" item; drag a native row onto one of our folder rows (drop target).
- New: folder context menu (`⋯`) with **Rename / Color (8-swatch palette) / Delete**; conversation items inside an expanded folder are clickable (navigates to `/app/<id>`), show a remove (`×`) button, and reflect the currently-open conversation (`is-current`).
- Titles resolved fresh from the live DOM when the native row is present, with fallback to the title cached at assignment time (`state.conversations`).

**Backward compatibility:** Storage key `gtFoldersState` is unchanged (`{ folders:[{id,name,collapsed,color}], assignments, conversations }`). `color` is added with a default; legacy v1 migration preserved. No data migration needed.

**Files:** `modules/folders.js` (full rewrite, v3 → A), `css/folders.css` (full rewrite for the new section/menu/styles + dark mode + narrow-sidebar), `manifest.json` (version 1.0.0 → 1.0.0). `content.js` / `integration.js` untouched (folders module is a self-contained IIFE).

**Verification:** `node --check modules/folders.js` PASS; CSS brace balance 104/104; no stale v3 symbol references (`toolbarEl`/`headerEls`/`HIDDEN_CLASS`/`placeToolbar`/`gt-grouped-row` etc.) remain. Browser runtime test pending user reload + `?gtdebug=1`.

---

## Bug: Folders Section Appears Below Pinned Items, Not Above All Chats

**Reported:** User screenshot showing `#gt-folders-section` ("分组 + 新建") rendered between the pinned item ("06 AV 特征融合" with 📌) and the first Recent item ("Deepfake Detection Model Innovat..."). User expected 分组 to appear above all chat items.

**Root cause:** `placeSection(listRoot, section)` walked `listRoot.children` for the first child containing an `a[href*="/app/"]`. But `listRoot` came from `getListContainer()` → `getListRoot()` → `anchors[0].closest('[role="list"], ul, ol, …')`. Gemini's sidebar keeps Pinned items in a separate sibling `<div>`/`<ul>` ABOVE the Recent `<ul class="conversation-list">`. The Recent `<ul>` does not contain the pinned anchor, so `anchors[0].closest('ul')` returned the Recent list — and `firstConv` became the first Recent row (Deepfake), not the Pinned row. The resulting `insertBefore(section, Deepfake)` placed our section at position 1 of Recent (after Pinned, which lives in a sibling).

**Fix:**

1. **`modules/folders.js` `placeSection(sidebarRoot, section)`** — switched the search range from `listRoot.children` to `sidebarRoot.children`. `sidebarRoot` (already computed by `findSidebarRoot`) is the highest-scoring ancestor that contains ALL conversation anchors (Pinned + Recent), so its first child containing an anchor is the actual topmost chat row across both groups. Additional guards skip our own UI (`section.id === SECTION_ID`, `dataset.gtFolderUi`, dialog/selector/menu overlays).
2. **`modules/folders.js` `render()`** — computes `sidebarRoot` once via `findSidebarRoot(anchors)`, then derives `listRoot = getListRoot(sidebarRoot, anchors) || sidebarRoot`. Calls `placeSection(sidebarRoot || listRoot, section)` so the section is anchored to the widest container. `data-gt-mount-parent` HUD attribute now reports `sidebarRoot.tagName`, giving better diagnostics.
3. `getListContainer()` unchanged — it still returns the Recent list (used for `collectLive` and as the collapse probe), so drag-source binding and `isSidebarCollapsed` are unaffected.

**Verification:** `node --check modules/folders.js` PASS. Headless Chrome test (`placeSection` exercised against a mock `<aside>` containing `[pinned-group, h2="最近", ul.conversation-list]`) confirmed: section ends up at `children[0]`, immediately above pinned-group; second call is a no-op (idempotent); section self-relocates to top when injected into the wrong slot.

**Files:** `modules/folders.js` only (`placeSection` rewritten + `render` signature updated).

---

## Bug: "Move to Folder" from the native 3-dots menu always says "Already in" after the first add

**Symptom:** Adding one conversation to a folder works ("Moved to"). Any subsequent "Move to Folder" on a *different* conversation reports "Already in '<folder>'" and silently assigns nothing.

**Root cause:** `getMenuTargetId()` (resolves which conversation a just-opened 3-dots menu belongs to) used `trigger.closest('[data-test-id="conversation"], li, [role="listitem"]')` then `holder.querySelector('a[href*="/app/"]')`. In Gemini's "Recent" list, several conversation items can share a broad `<li>`/listitem wrapper, so the matched `holder` contained MULTIPLE conversation links and `.querySelector` returned the **first** one (a sibling / the currently open chat) — not the row whose menu was opened. Every menu therefore resolved to the same conversation id, so the 2nd `assign()` saw `state.assignments[id] === folderId` and bailed with "Already in".

**Fix:** `getMenuTargetId()` now walks UP from the menu trigger and returns the id from the **smallest ancestor that contains a conversation anchor** (the tightest container that actually owns the menu). Priority: (1) our own bound row `[data-gt-conv-id]`, (2) first ancestor with any `a[href*="/app/"]`, (3) only as a true last resort the currently-open conversation via `location.pathname`. This pins each move to the correct conversation regardless of how broad the surrounding wrapper is.

**Verification:** `node --check modules/folders.js` PASS. Headless Chrome test built a mock sidebar where one `<li class="group">` wraps 3 conversation items each with its own link + menu trigger (the bug shape). With the 2nd item's menu open: OLD returned `AAAA` (first sibling → wrong), NEW returned `BBBB` (the opened item → correct). Right-click path (`row.dataset.gtConvId`) was never affected.

**Files:** `modules/folders.js` only (`getMenuTargetId` rewritten). Version 1.0.0 → 1.0.0.

---

## Bug: "Move to Folder" always targets the previously-moved conversation (syntax-level root cause)

**Symptom:** After the 1.0.0 edit, the native three-dot "Move to Folder" still reported "Already in" for every item except the first. User correctly diagnosed it as "the just-moved item stays selected as the target no matter which item you pick."

**Root cause (two layers):**
1. *Logic* (fixed in 1.0.0): `getMenuTargetId()` fell back to `location.pathname` (the currently-open chat) when resolution failed, and the CDK menu panel is re-used across openings so the target captured at injection time went stale. This was rewritten into `resolveTriggerConvId(trigger)` (no `location` fallback → returns `null` and aborts) + `getTriggerForMenu(menu)` (matches panel `aria-controls` to the real trigger) + re-stripping injected items on every open.
2. *Syntax* (fixed in 1.0.0): the 1.0.0 rewrite introduced two defects that broke the whole `tryInjectMenuItems` function at parse time — (a) a string literal `'Couldn't determine the conversation'` used a straight ASCII apostrophe, prematurely closing the string; (b) the `batchItem` `createEl(...)` children array was closed with `});` instead of `]);`, leaving the `[` opened at line 1218 unterminated (brack +1) and prematurely closing the `forEach` callback. `node --check` failed at line 1224 with "Unexpected token '}'". Because the script never parsed, NONE of the 1.0.0 logic ran — the menu injection was dead, which is why the bug persisted.

**Fix:** Restored the correct `]);` terminator for `batchItem` and switched the toast string to double quotes (`"Couldn't determine the conversation"`) so the apostrophe is inert. Verified the file parses and `{}`/`()`/`[]` net depth is 0/0/0. No stale `getMenuTargetId` references remain.

**Verification:** `node --check modules/folders.js` PASS; brace/paren/bracket net balance 0/0/0. Earlier headless mock confirmed `resolveTriggerConvId` resolves to the opened item (not the first sibling, not the current path).

**Files:** `modules/folders.js` (`tryInjectMenuItems` children-array terminator + toast string quoting). Version 1.0.0 → 1.0.0.

---

## Bug: Folders component does not follow dark/light theme switch

**Symptom:** Switching to dark mode leaves the "分组" (folders) component in the old theme — colors don't switch.

**Root cause (two layers):**
1. *Static theme attribute.* `applyThemeAttr()` only set `data-gcn-theme` when an element was **created**. The `#gt-folders-section` wrapper is created once in `ensureSection()` and then cached, so its `data-gcn-theme` was frozen at first-render time. The CSS (`#gt-folders-section[data-gcn-theme="dark"] ...`) keys entirely off that attribute, so the section never updated.
2. *No theme-change signal.* `isDark()` read only `gcn-panel`'s `data-gcn-theme` attribute / `localStorage['gcn-theme-dark']` — it had **no awareness of Gemini's own dark mode**. And nothing re-rendered the folders UI when the theme changed: the extension's `toggleTheme()` (Alt+T / moon button) updated only the gcn-panel, while the folders module observed the sidebar, not the panel.

**Fix:**
- `render()` now calls `applyThemeAttr(section)` on **every** render, so the section always reflects the current theme (rows were already rebuilt with `applyThemeAttr` each render).
- `isDark()` upgraded to a 3-tier detector: (1) extension panel `data-gcn-theme` (explicit user choice, top priority) → (2) `localStorage['gcn-theme-dark']` → (3) **Gemini native dark mode** via computed background luminance of `<body>`/`<html>` (Material sets a dark surface). This makes the component follow Gemini's own theme toggle too.
- New `startThemeWatch()` (called at boot): a `MutationObserver` on `gcn-panel[data-gcn-theme]` fires an immediate re-render on the extension toggle; a broad `MutationObserver` on `<html>`/`<body>` attributes catches Gemini's native dark switch. Both only call `scheduleRender()` when `isDark()` actually flips, so the high mutation volume is absorbed by the debounced idempotent render.

**Verification:** `node --check modules/folders.js` PASS. Extracted the real `isDark()` and ran 8 mocked-DOM cases (panel attr / localStorage / body-dark / body-light / html-dark / empty) — all 8 PASS, confirming the regex luminance parser and 3-tier priority.

**Files:** `modules/folders.js` (`isDark` 3-tier, `render` re-applies theme, new `startThemeWatch`). Version 1.0.0 → 1.0.0.

**Note:** The user's hypothesis ("global color variable override") was not the cause — folders.css uses plain `data-gcn-theme` attribute selectors, no shared CSS variables. The real issue was the attribute being set once and never re-applied, plus no theme-change listener.

---

## Bug: Folders component still ignores the extension theme toggle (1.0.0 fix didn't take effect)

**Symptom:** After toggling the extension's own dark mode (Alt+T / moon button), the `gcn-panel` flips to dark but the `#gt-folders-section` in the sidebar stays light. The 1.0.0 MutationObserver-based detection did not fire.

**Root cause:** The 1.0.0 fix relied on `startThemeWatch()`'s `MutationObserver` bound to `#gcn-panel[data-gcn-theme]`. This is **fragile across content-script load order**:
- `startThemeWatch()` runs at folders boot (`loadState().then(...)`). If `gcn-panel` was not yet in the DOM at that moment (content.js creates it later), the immediate `watchPanel()` call found `null`. The 2 s retry interval eventually binds, but the observer depends on the element never being replaced. More critically, the observer fires a DOM mutation but the signal has to travel: mutation → observer → `reRenderIfThemeChanged` → `isDark()` → `scheduleRender`. Any single missed step (e.g. `getElementById` returning a re-created panel after the observer was bound to an orphaned one) silently breaks it.
- Compounding issue: content.js's `applyTheme()` writes `data-gcn-theme` to `#gt-folders-panel` — a **dead id from an old version** — never touching the actual `#gt-folders-section`. So even with the panel attr updated, content.js never directly refreshed the folders module.

**Fix (belt + suspenders, with the direct hook as the primary signal):**
1. **Direct cross-module hook (primary).** `content.js#applyTheme()` now calls `window.GTFolders && window.GTFolders.refresh()` after setting all panel/theme attributes. Because folders.js exposes `refresh: scheduleRender`, this guarantees a folders render on every extension theme toggle, regardless of observer timing.
2. **Render re-applies theme (already in 1.0.0).** `render()` calls `applyThemeAttr(section)` every render, so the section always reflects `isDark()`.
3. **800 ms interval theme-flip detection (fallback).** The existing collapse-poll interval now also tracks `isDark()` and calls `scheduleRender()` on flip — catches Gemini native dark and any edge case where the direct hook + MutationObserver both miss.
4. **MutationObserver (kept).** `startThemeWatch()`'s observers remain as an additional safety net for Gemini's `<html>`/`<body>` attribute changes.

**Verification:** `node --check modules/folders.js` and `content.js` both PASS. Wiring confirmed via grep: `applyTheme()` → `GTFolders.refresh`; render → `applyThemeAttr(section)`; 800 ms interval → `lastThemeTick` flip check.

**Files:** `content.js` (cross-module hook in `applyTheme()`), `modules/folders.js` (800 ms interval theme check). Version 1.0.0 → 1.0.0.

---

## Bug: Manifest & Extension Title Mismatch (F3.1)

**Symptom:** `manifest.json` line 3 displayed legacy `"name": "Gemini Pilot"` and line 4 displayed `"version": "1.0.0"`. `content.js` contained header text `<span class="gcn-title">Gemini Pilot</span>`.

**Fix:** Updated `manifest.json` name to `"Gemini Pilot"`, version to `"1.0.0"`, and gecko ID to `gemini-pilot@example.com`. Updated `content.js` panel title string to `Gemini Pilot`. Verified consistency across all UI elements and documentation.

**Verification:** Executed `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"` — PASS.

**Files:** `manifest.json`, `content.js`. Version 1.0.0.

---

## Bug: Storage Engine Documentation Out of Sync (F3.2)

**Symptom:** `HOW_IT_WORKS.md` and `TECHNICAL_GUIDE.md` described `chrome.storage.sync` as the primary storage engine, which caused confusion because the implementation uses `chrome.storage.local` to avoid sync quota limits (100KB total quota).

**Fix:** Updated `HOW_IT_WORKS.md` and `TECHNICAL_GUIDE.md` to accurately document `chrome.storage.local` as the primary storage engine (explaining quota optimization and automatic migration from legacy `chrome.storage.sync`).

**Files:** `HOW_IT_WORKS.md`, `TECHNICAL_GUIDE.md`. Version 1.0.0.

---

## Performance Optimization #33: Render Cycle Decoupling & Anchor Caching (2026-07-28)

**Symptom:** Extension caused Gemini's native sidebar to load slowly or get stuck in loading state.

**Root Causes:**
1. `tryInjectMenuItems()` was called inside `render()`, executing expensive DOM queries on every render cycle
2. `getConversationAnchors()` ran 8 `querySelectorAll` calls on every render
3. Two separate `setInterval` timers (800ms + 600ms) running simultaneously
4. `menuInjectGuard` used `setTimeout(100ms)` for reset

**Fixes Applied:**
1. **Decoupled menu injection**: `tryInjectMenuItems()` now runs in its own MutationObserver callback (CDK overlay detection), not inside `render()`
2. **Anchor caching**: Added `getCachedAnchors()` with 200ms TTL cache, reducing DOM queries by ~90%
3. **Merged observers**: Combined two `setInterval` calls into one (400ms) with tick-based frequency control
4. **Microtask guard reset**: Changed `setTimeout(100ms)` to `Promise.resolve().then()` for faster guard release
5. **Cache invalidation**: `invalidateAnchorCache()` called on DOM changes and route changes


---

## Bug #38: Stale DOM Reference in Prompt Trace Navigation After New Prompt

**Symptom:** In an active session, after typing and sending a new prompt, the Trace list updated correctly, but clicking older/other Trace items failed to scroll to the corresponding prompt position in Gemini's chat stream.

**Cause:**
1. Click handlers in `renderMessageList` captured `msg` DOM node references via closures at render time. When Gemini's SPA re-rendered `user-query` elements on message output, the captured DOM references became detached. Calling `scrollIntoView()` on detached nodes was a silent no-op.
2. `if (!scrollObserver)` condition in MutationObserver update handler prevented rebuilding `IntersectionObserver` when new messages arrived.
3. Observer callback used a stale snapshot `messages` NodeList captured at observer creation.

**Fixes Applied:**
1. Click & hover handlers resolve target DOM element at click-time via `userMessages[idx]?.element`, verifying `document.body.contains(target)` with fallback re-query (`getUserMessages(true)`).
2. MutationObserver update path always tears down & rebuilds `IntersectionObserver` via `setupIntersectionObserver()`.
3. `setupIntersectionObserver()` force-refreshes `messages` and uses live `getUserMessages()` inside callback.

**Files:** `content.js`. Version 1.0.0.

---

## Bug #39: Performance & Fluency Optimizations (12 Items)

**Symptom:** High CPU timer wakeups (~7/sec) during page idle, layout reflows from full nav list rebuilding on each new prompt, GPU compositing layer overhead from `backdrop-filter: blur() saturate()`, and 5-chain string allocation in HTML escaping.

**Fixes Applied:**
1. **Timer Relaxation**: `handleRouteChange` polling relaxed from 400ms to 2000ms (event-driven `pushState`/`popstate` hooks handle fast path); `init()` interval replaced with one-shot `MutationObserver`; `folders.js` watcher relaxed from 400ms to 800ms; removed perpetual 1s timer in `integration.js`.
2. **Incremental Diff-and-Patch**: Converted `renderMessageList()` from full-rebuild (`innerHTML = ''`) to incremental diff-and-patch, reusing DOM nodes and event listeners.
3. **DOM Filtering & Caching**: Removed `[class*=""]` substring attribute selectors from `isIgnoredMutationTarget()` `.closest()`; cached `sidebarRoot` in `folders.js` with TTL; optimized `totalAssignedCount` call count.
4. **CSS Compositing & Paint**: Removed `saturate(180%)` and `will-change` on `#gcn-panel`; removed 1px `text-shadow` on `.gcn-nav-text`.
5. **Memory & String Allocations**: Single-pass `escapeHtml` regex + map; `handleRouteChange` compares `pathname` instead of `href`; `isGeminiConversationHref` fast-paths relative links.

**Files:** `content.js`, `content.css`, `modules/utils.js`, `modules/folders.js`, `modules/integration.js`. Version 1.0.0.

---

## Bug #40: Cross-Browser Compatibility (Chrome, Microsoft Edge, Mozilla Firefox)

**Symptom:** Firefox MV3 background workers and extension storage handling threw errors or failed promises when using callback-only patterns or `window` references in ServiceWorkers.

**Fixes Applied:**
1. **Manifest V3 Specification**: Updated `manifest.json` with dual background runner configuration (`service_worker` for Chrome/Edge, `scripts` array & `browser_specific_settings.gecko` for Firefox).
2. **Universal Polyfill**: Enhanced `browser-polyfill.js` to support both `Window` and `ServiceWorker`/`GlobalThis` scopes, providing unified `browser.runtime`, `browser.tabs`, `browser.storage` promise wrappers.
3. **Background Script Worker**: Updated `background.js` with `importScripts('browser-polyfill.js')` and dual promise/callback tab messaging.
4. **Clipboard & CSS Standards**: Added `execCommand('copy')` fallback in `copyPrompt()` and added W3C standard `scrollbar-width: thin` and `scrollbar-color` CSS properties for Firefox.

**Files:** `manifest.json`, `background.js`, `browser-polyfill.js`, `content.js`, `content.css`. Version 1.0.0.

---

## Bug #41: Theme Switch Visual Residue & Asymmetric CSS Specificity

**Symptom:** When toggling themes in the folders section (especially Dark mode), a light milk-white/grey rounded box bled through underneath folder rows and conversation items, causing visual ghosting and un-smooth theme transitions.

**Cause:**
1. Light mode rules in `css/folders.css` used `!important` on background colors, whereas dark mode rules lacked `!important`. Light mode `!important` rules took precedence over dark mode rules.
2. `GTFolders.syncTheme()` only queried `[data-gcn-theme]` nodes, missing child elements (`.gt-folder-row`, `.gt-folder-convs`, `.gt-folder-conv`).
3. Base `transition: background 150ms ease` caused background colors to slowly fade over 150ms during theme toggling, producing visual ghosting.

**Fixes Applied:**
1. Added `!important` to all dark mode rules in `css/folders.css` and expanded selector coverage (`#gt-folders-section[data-gcn-theme="dark"]`, `.gt-folder-row[data-gcn-theme="dark"]`, `.gt-folder-conv[data-gcn-theme="dark"]`).
2. Updated `syncTheme()` in `modules/folders.js` to query all folder child elements (`.gt-folder-row, .gt-folder-row-head, .gt-folder-convs, .gt-folder-conv, [data-gcn-theme], [data-gt-theme]`).
3. Removed base background transitions from `.gt-folder-row` and `.gt-folder-conv` so theme switches occur instantaneously without background fade lag.

---

## Bug #42: Auto-Scroll & Focus on Newly Sent User Prompt

**Symptom:** When sending a new prompt while scrolled up reading a previous turn in an active session, Gemini's native chat pane and the Trace navigation panel did not auto-scroll or focus on the newly sent prompt.

**Cause:** Gemini's native SPA only auto-scrolls if the user's view was already at the very bottom. The extension's `debouncedUpdate` appended the new nav item to `listContainer` but did not call `scrollToMessage` to focus the new turn in Gemini's chat pane or scroll the Trace panel to the newly appended item.

**Fix Applied:** Updated `debouncedUpdate` in `setupMutationObserver()` to check `freshMessages.length > prevCount`. When a new prompt is added, it automatically invokes `scrollToMessage(newElement, newIndex)` to smoothly scroll Gemini's chat pane to the new query and scroll the Trace panel to highlight the new item as `.gcn-active`.

---

## Bug #43: Historical Conversation "Load Earlier Turns" Navigation Header

**Symptom:** When opening a long conversation session, Gemini's native SPA initially renders only a subset of recent turns in the DOM (e.g. 10 turns). Earlier turns are not present in the DOM until a scroll event near the top of the chat area triggers Gemini's lazy load.

**Cause:** Gemini uses DOM virtualization for long conversations. Attempting to force-scroll on initial load with timers caused page jitter, race conditions with Gemini's initial page rendering, and unreliable behavior.

**Fix Applied:** Added a minimalist `.gcn-load-earlier-btn` ("Load Earlier Turns") button at the top of the Trace navigation list. When clicked, it smoothly scrolls the top message into view, triggering Gemini's native `IntersectionObserver` lazy-loader without hacky timers or page jitter. Upon prepending older turns, Trace's `MutationObserver` automatically expands the navigation list (e.g. from 10 to 16 turns).

---

## Bug #44: Conversation ID Resolution & Double-Click Selector Issue

**Symptom:** 
1. Clicking "Move to Folder" from the native 3-dots menu threw an error toast `"Couldn't determine the conversation"`.
2. Users had to click "Move to Folder" twice for the folder selector popup window to stay open.

**Cause:** 
1. `resolveTriggerConvId` relied on a static `trigger` captured when the menu mutated. If `getTriggerForMenu(menu)` returned `null` during initialization, the closure captured `null`.
2. When closing Gemini's native menu via `Escape` key event, `showSelector` armed its document `mousedown` backdrop click listener in `0ms`. The native menu's teardown event immediately triggered `closeSelector()`, prematurely closing the selector popup on the first click.

**Fix Applied:** 
1. Replaced `resolveTriggerConvId` in `modules/folders.js` with `getConvIdFromNode` supporting multi-strategy resolution: live trigger, menu `aria-controls`, expanded triggers `[aria-expanded="true"]`, item container matching, and `location.href` fallback.
2. Adjusted backdrop listener arming delay in `showSelector` to 150ms and `showSelector` invocation delay to 100ms, ensuring Gemini CDK menu teardown completes cleanly before arming outside click handlers.

**Files:** `modules/folders.js`. Version 1.0.0.

---

## Bug #45: Dark Mode Text Contrast on Native Menu Items

**Symptom:** In Gemini's dark mode, `Move to Folder` and `Batch Select` menu text and icons were dark grey on a dark background, making them nearly invisible.

**Cause:** `.gt-native-menu-item` forced `color: var(--gt-text-primary, #1F1F1F) !important;`. The hardcoded `#1F1F1F` dark color applied regardless of whether Gemini was in light or dark theme.

**Fix Applied:** Updated `.gt-native-menu-item` in `css/folders.css` to use `var(--mat-menu-item-label-text-color, var(--gmat-sys-color-on-surface, inherit))` and added explicit dark mode selectors (`body.dark-theme`, `html[dark]`, `[data-gcn-theme="dark"]`, `[data-gt-theme="dark"]`) forcing high-contrast `#E3E3E3` text & SVG stroke color in dark mode.

**Files:** `css/folders.css`. Version 1.0.0.

---

## Bug #46: "Load Earlier Turns" Header Button Displayed on Short Conversations

**Symptom:** In short conversations (e.g. 4 turns total), Trace list still rendered the `Load Earlier Turns` header button even though no earlier turns existed.

**Cause:** `updateLoadEarlierButton()` previously checked `if (messages.length > 0)` unconditionally. Since Gemini only virtualizes top history on long conversations (>= 8 turns), short conversations do not have off-screen top turns.

**Fix Applied:** Updated `updateLoadEarlierButton()` in `content.js` to enforce `const MIN_VIRTUAL_THRESHOLD = 8`. `Load Earlier Turns` is now rendered ONLY when `messages.length >= 8`.

**Files:** `content.js`. Version 1.0.0.

---

## Summary

| Bug / Feature | Root Cause | Fix / Action |
|---------------|-----------|--------------|
| IntersectionObserver TypeError | Wrong API usage | `entry.target.getBoundingClientRect()` |
| Dark mode text invisible | Low contrast on glass | Brighter colors + text-shadow |
| Collapse icon confusing | Hamburger menu unclear | Chevron arrow icon |
| Collapsed container too small | Width 40px | Increased to 72px |
| "You said" in navigation | Wrong selector + no filtering | `.query-text-line` + filter accessibility |
| Theme complexity | Auto-follow unreliable | Simple boolean toggle |
| Text readability | Faint on glass | Font-weight + shadow + contrast |
| Scroll jumping | Observer reconnect too early | State tracking + disconnect/reconnect |
| Performance lag | Inefficient rendering | rAF, DocumentFragment, caching |
| Hover preview not showing | `overflow: hidden` clip | `overflow: visible` + opaque background |
| Scroll jump back | Observer fires during scroll | `isScrollingTo` flag blocks updates |
| Preview tooltip edge clipping | Missing `box-sizing` + async `img.onload` | `box-sizing`, `updatePreviewPosition()` clamping, `img.onload` recalculation |
| Message timestamps ineffective | Gemini DOM lacks timestamps | Auto-stamp `dataset.gcnTime`, improve `formatTime`, add 30s auto-refresh |
| Streaming lag & fixed shortcuts | `MutationObserver` thrashed on AI output | Add `background.js` Manifest V3 commands + fast-skip `model-response` |
| Collapsed search bar overflow | Search bar not hidden under `.gcn-collapsed` | Added `display: none !important` + auto-close search in `togglePanel()` |
| Dark mode preview black text | Text inherited black color on dark background | Explicit `color: #FFFFFF` on `#gcn-preview[data-gcn-theme="dark"]` |
| Dark mode keyboard btn background | `.gcn-help-btn` omitted from dark CSS selectors | Added `.gcn-help-btn` to dark mode header button selectors |
| Dark mode shortcuts modal faint text | Scoped `:root` light variables used on dark modal | Explicit high-contrast white & gold text rules |
| Collapsed layout & title retention | Vertical icons + title cleared in JS & hidden in CSS | Preserved title, forced horizontal icon row, compact 80px container |
| Server timestamp network interception | Gemini DOM omits timestamps; data exists in RPCs | Injected main-world `fetch`/`XHR` interceptor parsing `/batchexecute` Unix timestamps |
| Historical messages "Just now" bug | Past messages stamped with `Date.now()` on load | Stop auto-stamping `Date.now()` on historical turns; add `scanPageInlineScripts()` |
| Sidebar modules & multi-language fix | Hardcoded 'delete', missing content.css, broken collapsed CSS | Multi-lang delete keywords, UI UX Pro Max modals, sync theme & restore 80px collapsed panel |
| Direct native menu & row injection | Gemini native 3-dots menu lacked custom options | Injected `Move to Folder` into 3-dots menu & injected folder badges onto native sidebar rows |
| Native menu click no-response bug | Missing `showFolderSelector()` + missing batch item | Implemented `showFolderSelector`, added `+ New Folder & Archive`, and injected `Batch Select` |
| Misplaced right header buttons | Sidebar buttons placed in right-side Trace panel | Removed sidebar buttons from right header; kept right panel focused strictly on Trace navigation |
| Custom folder name input flow | Need immediate user input for folder names | Auto-open input modal if no folders exist; add `Type new folder name` option |
| 100% Codebase English Standardization | Non-English strings in code files | Converted all UI labels, dialogs, toasts, comments, and buttons to 100% Crisp English |
| SPA conversation switch blank list | Slow 1s URL polling & stale `messageHash` cache | Intercept History API, embed `location.href` in hash, and re-bind new conversation DOM |
| Pixel-perfect native menu alignment | Misaligned custom items & confusing emojis | Replaced emojis with line-art SVGs & matched 48px height, 16px padding, 14px icon gap |
| Trailing ellipsis dots removal | Unnecessary `...` in menu labels | Removed trailing `...` from `Move to Folder` and `Batch Select` |
| Modal redesign & batch DOM fix | Syntax error in sidebar.css & outdated item selectors | Redesigned modal with 380px width & gold gradient button; updated DOM matchers for `conversation-item-viewer` |
| Reference Open-Source Integration | Need robust floating bar & dual-strategy DOM matcher | Integrated reference architectures: dual menu/anchor DOM matcher & bottom floating action bar |
| Silent Batch Deletion & No Flashing | Native menus flashed during automated deletion | Added `window.GTBatchDelete?.isActive()` check + `#gt-hide-batch-menus` (`opacity: 0 !important`) |
| Progress Bar Pre-Execution Hiding | `css/sidebar.css` forced `display: flex !important` | Switched to `.gt-batch-progress.active` class activated only during `startBatchDelete()` |
| Native Sidebar Folder Tree Engine | Render native tree directly in Gemini sidebar DOM | Built `#gt-folders-panel` accordion tree with sub-item links, drag & drop, and glassmorphism styling |
| Folder Moving Thread Freeze Fix | `MutationObserver` reentrant loop on badge update | Added `isUpdatingDOM` guard flag in `setupNativeMenuObserver()` and `addToFolder()` |
| Timestamp Mismatch Fix | Script scraper matched static Google 2020 constants | Updated extraction bounds to year 2025+, filtering Google library constants |
| Theme Desync: Folders Section | CSS used transparent backgrounds inside Gemini's white sidebar; stale `#gt-folders-panel` ID in JS | Opaque `#1C1B1F` backgrounds for ALL dark mode elements; target `#gt-folders-section` in `content.js`; add `GTFolders.syncTheme()` API |
| Folder Auto-Collapse on Item Click | Click event on child conversation item bubbled up to parent folder container | Added `e.stopPropagation()` in `.gt-folder-conv` click/keydown handlers & added guard check in `.gt-folder-row` click handler |
| Architecture & Performance Optimization | MutationObserver thrashing, layout reflows, code duplication & memory leaks | Created `modules/utils.js` (`window.GTUtils`), fast short-circuit mutation filters, cached DOM queries, cleaned event listener leaks, and debounced storage operations |
| Gemini Native Sidebar Loading Freeze | Broad MutationObserver on `document.body` caused infinite render feedback loop | Implemented `mutationTouchesSidebar()` filter, loading state guard, and high-contrast theme variables in `tokens.css` |
| Render Cycle Decoupling & Anchor Caching | Menu injection in render cycle, uncached DOM queries, multiple timers | Decoupled menu injection, added anchor caching (200ms TTL), merged observers, microtask guard reset |
| Stale DOM Reference in Prompt Trace Navigation | Click handler closures captured stale DOM elements; IntersectionObserver not rebuilt | Resolve element at click time with DOM containment check & live fallback query; rebuild IntersectionObserver on new message |
| Performance & Fluency Optimizations (12 items) | Multi-timer polling, full list rebuilds, GPU compositing layer overhead | Relaxed polling, incremental diff-and-patch nav list, removed `saturate()` & `will-change`, single-pass `escapeHtml` |
| Cross-Browser Compatibility (Chrome, Edge, Firefox) | Firefox MV3 service worker / storage promise differences | Manifest V3 dual background config, globalThis polyfill in `browser-polyfill.js`, clipboard fallback, Firefox scrollbars |
| Theme Switch Visual Residue in Folders | Light mode `!important` rules beat dark mode rules; un-synced child nodes; transition lag | Symmetric `!important` in dark mode rules; full DOM tree `syncTheme()`; removed base background transition lag |
| Auto-Scroll & Focus on New Prompt | Gemini native SPA & Trace did not jump to newly sent user query when scrolled up | Detect `freshMessages.length > prevCount` in `MutationObserver` & trigger `scrollToMessage(newElement, newIndex)` |
| Historical Conversation Load Earlier Button | Gemini native SPA only renders a subset of recent turns in DOM | Add `.gcn-load-earlier-btn` header button in Trace to cleanly trigger Gemini's top history lazy loading |
| Conversation ID Resolution Failure | 3-dots button parent DOM traversal missed sibling anchor tags | Add `closest('conversation-item-viewer, ...')` matching & `location.href` fallback in `resolveTriggerConvId` |
| Dark Mode Native Menu Item Contrast | `.gt-native-menu-item` forced hardcoded `#1F1F1F` dark text on dark menu background | Use `var(--mat-menu-item-label-text-color, inherit)` & add high-contrast `#E3E3E3` dark theme selectors |
| Load Earlier Button on Short Chats | `updateLoadEarlierButton()` checked `messages.length > 0` unconditionally | Added `MIN_VIRTUAL_THRESHOLD = 8` filter so button only renders on long conversations (>= 8 turns) |

---

*Last updated: 2026-07-28 (v1.0.0)*

---

*Last updated: 2026-07-28 (v1.0.0)*

---

*Last updated: 2026-07-28 (v1.0.0)*