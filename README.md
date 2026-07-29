<div align="center">

# ✨ Gemini Pilot

**The Ultimate Productivity Suite for Google Gemini (`gemini.google.com`)**

[![Stars](https://img.shields.io/github/stars/Poetrynan/Gemini-Pilot?style=for-the-badge&logo=github&color=EA4335)](https://github.com/Poetrynan/Gemini-Pilot/stargazers)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browsers](https://img.shields.io/badge/Browsers-Chrome%20%7C%20Edge%20%7C%20Firefox-34A853?style=for-the-badge&logo=firefox&logoColor=white)](#-installation)
[![License](https://img.shields.io/badge/License-MIT-FBBC05?style=for-the-badge)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-34A853?style=for-the-badge)](#-privacy--security)

*Transform Google Gemini into a structured, high-performance AI workspace with single-session prompt outline navigation, native sidebar folder organization, multi-language bulk deletion, and 60fps Glassmorphism UI.*

**English** | [中文版](README_CN.md)

[Key Features](#-key-features) • [Installation](#-installation) • [Usage & Shortcuts](#-usage--shortcuts) • [Architecture](#-architecture) • [Privacy](#-privacy--security)

---

</div>

## 🌟 Key Features

<table>
  <tr>
    <td width="50%">
      <h3>📍 Prompt Turn Trace Navigation</h3>
      <ul>
        <li><b>Session Outline</b>: Automatically extracts every prompt turn into a jumpable outline on the right.</li>
        <li><b>Hover Preview</b>: View full prompt text and uploaded images in an edge-clamped tooltip.</li>
        <li><b>Keyboard Traversal</b>: Press <code>J</code> / <code>K</code> to navigate turns and <code>Enter</code> to jump.</li>
        <li><b>Live Search & Filter</b>: Instantly filter prompts by typing (<code>Ctrl+F</code> or <code>/</code>).</li>
        <li><b>One-Click Export</b>: Export entire chat sessions to clean <b>Markdown (.md)</b> or <b>JSON (.json)</b>.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>📁 Native Sidebar Folders (Approach A)</h3>
      <ul>
        <li><b>Top-of-Sidebar Injection</b>: Self-contained <code>#gt-folders-section</code> inserted at the top of Gemini's sidebar without reordering native DOM elements.</li>
        <li><b>Drag & Drop</b>: Drag any native chat row onto a folder to file it instantly.</li>
        <li><b>Native 3-Dots Menu Integration</b>: Hooks directly into Gemini's popup menus with <code>Move to Folder</code> and <code>Batch Select</code>.</li>
        <li><b>8-Color Palette</b>: Customize folder accents with curated HSL colors.</li>
        <li><b>In-App SPA Navigation</b>: Switch chats inside folders with zero full-page reloads.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>⚡ Multi-Language Bulk Management</h3>
      <ul>
        <li><b>Multi-Language Delete Engine</b>: Recognizes delete actions across English, Chinese, Japanese, German, French, Spanish, Italian, Korean, Russian, etc.</li>
        <li><b>Shift+Click Selection</b>: Select contiguous ranges of conversations effortlessly.</li>
        <li><b>Progress Bar Modal</b>: Live animated deletion status without native UI flashing.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🎨 Milk-White Glassmorphism & High Perf</h3>
      <ul>
        <li><b>Light & Dark Mode</b>: Synchronized 100% across Trace panel, dialogs, and sidebar folders (<code>Alt+T</code>).</li>
        <li><b>Incremental Diff-and-Patch</b>: Zero jank list rendering using DOM node reuse.</li>
        <li><b>CPU & GPU Optimized</b>: Idle timer wakeups reduced by 82%; background blur filter optimized for maximum FPS.</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🏗️ System Architecture

Gemini Pilot extends Google Gemini by injecting lightweight, non-destructive submodules into the active page DOM:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Google Gemini Web Page                           │
│                                                                         │
│  ┌──────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │
│  │ Gemini Left Sidebar  │  │ Central Chat Stream│  │ Gemini Header    │  │
│  │  ┌────────────────┐  │  │                    │  │                  │  │
│  │  │ Folders (Top)  │  │  │  user-query        │  │                  │  │
│  │  ├────────────────┤  │  │  model-response    │  │                  │  │
│  │  │ Native History │  │  │                    │  │                  │  │
│  │  └────────────────┘  │  └────────────────────┘  └──────────────────┘  │
│  └──────────────────────┘  └────────────────────┘  └──────────────────┘  │
└──────────────────┬──────────────────────────────────────────┬───────────┘
                   │                                          │
      ┌────────────┴────────────┐                ┌────────────┴────────────┐
      │  Left Sidebar Submodule │                │ Right Trace Submodule   │
      │  (modules/folders.js &  │                │ (content.js &           │
      │   batch-delete.js)      │                │  content.css)           │
      └─────────────────────────┘                └─────────────────────────┘
```

---

## 🚀 Installation

### 💙 Google Chrome & Microsoft Edge

1. Download or clone this repository to your local machine.
2. Open your browser's extensions management page:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Edge**: Navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the project directory containing `manifest.json`.
6. Open [https://gemini.google.com](https://gemini.google.com) and enjoy!

### 🦊 Mozilla Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select the `manifest.json` file inside the project directory.
4. Open [https://gemini.google.com](https://gemini.google.com).

---

## ⌨️ Usage & Keyboard Shortcuts

Gemini Pilot includes built-in keyboard navigation for power users. Press <kbd>?</kbd> on any Gemini page to open the visual Cheat Sheet modal.

| Shortcut | Scope | Action |
| :--- | :--- | :--- |
| <kbd>J</kbd> / <kbd>↓</kbd> | Trace Panel | Move focus down to the next prompt item |
| <kbd>K</kbd> / <kbd>↑</kbd> | Trace Panel | Move focus up to the previous prompt item |
| <kbd>Enter</kbd> | Trace Panel | Smoothly scroll the chat container to the focused prompt message |
| <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>F</kbd> | Trace Panel | Focus live prompt search & filter input |
| <kbd>?</kbd> or <kbd>Shift</kbd>+<kbd>/</kbd> | Global | Toggle Keyboard Shortcuts Cheat Sheet modal |
| <kbd>Alt</kbd>+<kbd>N</kbd> | Global | Collapse or expand the right-hand Trace navigation panel |
| <kbd>Alt</kbd>+<kbd>T</kbd> | Global | Toggle glassmorphism Light / Dark theme |
| <kbd>Shift</kbd> + Click | Sidebar | Select contiguous range of conversation items for batch deletion |
| <kbd>Escape</kbd> | Global | Clear search query or close active overlays / dialogs |

---

## 📄 Session Export Formats

### 1. Markdown (`.md`)
```markdown
# Gemini Chat Export

> Exported on 2026-07-28 14:30:00

---

## Message 1
Detailed explanation of loss function parameters...

---

## Message 2
How does the attention mechanism operate?

![Uploaded Image](https://...)
```

### 2. JSON (`.json`)
```json
{
  "title": "Gemini Chat Export",
  "exportedAt": "2026-07-28T14:30:00.000Z",
  "messageCount": 2,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "text": "Detailed explanation...",
      "images": []
    }
  ]
}
```

---

## 🛠️ Codebase Structure

```
Gemini Pilot/
├── manifest.json          # Extension config (Manifest V3, Chrome/Edge/Firefox)
├── background.js          # Service worker handling extension commands & polyfills
├── browser-polyfill.js    # Universal WebExtension API wrapper (Window & Worker scope)
├── content.js             # Primary content script (Trace panel, diff-and-patch render)
├── content.css            # Primary CSS (Glassmorphism design system & keycaps)
├── css/
│   ├── tokens.css         # Glass design tokens (Light & Dark theme variables)
│   ├── panel.css          # Trace navigation panel & collapsed state rules
│   ├── sidebar.css        # Batch delete floating bar & modal overlay styles
│   └── folders.css        # Folders section, native menu items, badges, dark styles
├── modules/
│   ├── utils.js           # Submodule utilities (GTUtils namespace, storage, escaping)
│   ├── batch-delete.js    # Multi-language bulk deletion engine & selection logic
│   ├── folders.js         # Folders section: storage, drag-and-drop, 3-dots observer
│   └── integration.js     # Module boundary manager (maintains right panel purity)
├── icons/                 # Extension icons (16px, 32px, 48px, 128px)
├── README.md              # English project documentation
└── README_CN.md           # Chinese project documentation
```

---

## ⚙️ Configuration

You can customize panel thresholds by editing the `CONFIG` object at the top of `content.js`:

```javascript
const CONFIG = {
  TRUNCATE_LENGTH: 45,        // Characters shown per nav item in Trace panel
  HIGHLIGHT_DURATION: 2000,   // Highlight animation pulse duration (ms)
  PANEL_WIDTH: 232,           // Panel expanded width (px)
};
```

---

## 🔒 Privacy & Security

- **100% Local Execution**: All DOM parsing, outline building, storage, and export generation happen strictly inside your browser.
- **Zero Telemetry / Tracking**: No data is ever collected, logged, or transmitted to any remote server.
- **Minimal Permissions**: Requests only `storage`, `activeTab`, and `scripting` permissions for local feature execution.



---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for details.
