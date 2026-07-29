<div align="center">

# ✨ Gemini Pilot

**Google Gemini (`gemini.google.com`) 终极效率增强工具箱**

[![Stars](https://img.shields.io/github/stars/Poetrynan/Gemini-Pilot?style=for-the-badge&logo=github&color=EA4335&v=1.0.1)](https://github.com/Poetrynan/Gemini-Pilot/stargazers)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browsers](https://img.shields.io/badge/Browsers-Chrome%20%7C%20Edge%20%7C%20Firefox-34A853?style=for-the-badge&logo=firefox&logoColor=white)](#-安装说明)
[![License](https://img.shields.io/badge/License-MIT-FBBC05?style=for-the-badge)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-34A853?style=for-the-badge)](#-隐私与安全)

*将 Google Gemini 打造为高结构的 AI 工作空间，提供单会话 Prompt 大纲定位、原生侧边栏文件夹分组、多语言批量删除与 60fps 奶白毛玻璃 UI。*

[English](README.md) | **中文版**

[核心功能](#-核心功能) • [安装说明](#-安装说明) • [快捷键指南](#-快捷键指南) • [架构原理](#-系统架构) • [隐私安全](#-隐私与安全)

---

</div>

## 🌟 核心功能

<table>
  <tr>
    <td width="50%">
      <h3>📍 Prompt 对话大纲导航 (Trace)</h3>
      <ul>
        <li><b>会话大纲提取</b>：自动提取右侧对话轮次大纲，一键平滑跳转。</li>
        <li><b>悬停预览</b>：边缘自动钳制的浮动卡片，实时预览完整 Prompt 与上传图片。</li>
        <li><b>键盘遍历</b>：使用 <code>J</code> / <code>K</code> 快速移动焦点，按 <code>Enter</code> 快速跳转。</li>
        <li><b>实时搜索过滤</b>：输入关键词实时过滤 Prompt（按 <code>Ctrl+F</code> 或 <code>/</code> 唤醒）。</li>
        <li><b>一键导出</b>：支持将完整对话导出来为 <b>Markdown (.md)</b> 或 <b>JSON (.json)</b> 格式。</li>
      </ul>
    </td>
    <td width="50%">
      <h3>📁 原生侧边栏文件夹分组</h3>
      <ul>
        <li><b>侧边栏顶部注入</b>：自包含 <code>#gt-folders-section</code> 区域，不打乱原生 DOM 排序。</li>
        <li><b>拖拽归档</b>：按住侧边栏任意原生对话拖放到文件夹即可瞬间归档。</li>
        <li><b>原生三点菜单无缝注入</b>：注入 <code>Move to Folder</code> 与 <code>Batch Select</code> 选项。</li>
        <li><b>8 色主题调色盘</b>：自定义文件夹色彩标识。</li>
        <li><b>原地 SPA 切换</b>：文件夹内点击对话无缝跳转，无需刷新页面。</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>⚡ 多语言批量管理</h3>
      <ul>
        <li><b>多语言删除引擎</b>：支持中、英、日、德、法、西、意、韩、俄等多语言原生删除动作识别。</li>
        <li><b>Shift+Click 连选</b>：按住 Shift 快捷连选连续范围内的多条对话。</li>
        <li><b>进度条模态框</b>：实时呈现删除进度，原生菜单全程无闪烁。</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🎨 奶白毛玻璃与高帧率引擎</h3>
      <ul>
        <li><b>日夜间主题无缝同步</b>：Trace 面板、对话框与文件夹区域 100% 随系统或手动切换（<code>Alt+T</code>）。</li>
        <li><b>增量 Patch 渲染</b>：DOM 节点复用，列表渲染零卡顿。</li>
        <li><b>CPU & GPU 优化</b>：空闲定时器唤醒降低 82%，背景模糊滤镜针对高帧率优化。</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🏗️ 系统架构

Gemini Pilot 通过向当前页面注入轻量级子模块增强 Google Gemini UI：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Google Gemini 网页 (Google)                      │
│                                                                         │
│  ┌──────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │
│  │ Gemini 左侧边栏      │  │ 中央对话聊天流     │  │ Gemini 顶部栏    │  │
│  │  ┌────────────────┐  │  │                    │  │                  │  │
│  │  │ Folders (顶部) │  │  │  user-query        │  │                  │  │
│  │  ├────────────────┤  │  │  model-response    │  │                  │  │
│  │  │ 原生历史记录   │  │  │                    │  │                  │  │
│  │  └────────────────┘  │  └────────────────────┘  └──────────────────┘  │
│  └──────────────────────┘  └────────────────────┘  └──────────────────┘  │
└──────────────────┬──────────────────────────────────────────┬───────────┘
                   │                                          │
      ┌────────────┴────────────┐                ┌────────────┴────────────┐
      │  左侧边栏增强子模块     │                │ 右侧 Trace 导航子模块   │
      │  (modules/folders.js &  │                │ (content.js &           │
      │   batch-delete.js)      │                │  content.css)           │
      └─────────────────────────┘                └─────────────────────────┘
```

---

## 🚀 安装说明

### 💙 Google Chrome 与 Microsoft Edge

1. 下载或 Clone 本仓库代码到本地；
2. 打开浏览器的扩展程序管理页面：
   - **Chrome**: 访问 `chrome://extensions/`
   - **Edge**: 访问 `edge://extensions/`
3. 开启右上角 **“开发者模式” (Developer mode)**；
4. 点击 **“加载已解压的扩展程序” (Load unpacked)**；
5. 选择包含 `manifest.json` 的项目根目录；
6. 打开 [https://gemini.google.com](https://gemini.google.com) 即可开始体验！

### 🦊 Mozilla Firefox

1. 打开 Firefox 并访问 `about:debugging#/runtime/this-firefox`；
2. 点击 **“载入临时附加组件...” (Load Temporary Add-on...)**；
3. 选择项目根目录下的 `manifest.json` 文件；
4. 打开 [https://gemini.google.com](https://gemini.google.com) 即可。

---

## ⌨️ 快捷键指南

按 <kbd>?</kbd> 可随时唤醒可视化的快捷键速查表：

| 快捷键 | 作用域 | 功能说明 |
| :--- | :--- | :--- |
| <kbd>J</kbd> / <kbd>↓</kbd> | Trace 面板 | 将焦点向下移动至下一个 Prompt 轮次 |
| <kbd>K</kbd> / <kbd>↑</kbd> | Trace 面板 | 将焦点向上移动至上一个 Prompt 轮次 |
| <kbd>Enter</kbd> | Trace 面板 | 平滑滚动聊天区域至当前选中的 Prompt 位置 |
| <kbd>/</kbd> 或 <kbd>Ctrl</kbd>+<kbd>F</kbd> | Trace 面板 | 聚焦到 Prompt 实时搜索与过滤输入框 |
| <kbd>?</kbd> 或 <kbd>Shift</kbd>+<kbd>/</kbd> | 全局 | 打开 / 关闭快捷键速查表模态框 |
| <kbd>Alt</kbd>+<kbd>N</kbd> | 全局 | 折叠或展开右侧 Trace 导航面板 |
| <kbd>Alt</kbd>+<kbd>T</kbd> | 全局 | 切换日间 / 夜间毛玻璃主题 |
| <kbd>Shift</kbd> + 点击 | 侧边栏 | 批量删除时连选连续范围内的多条对话 |
| <kbd>Escape</kbd> | 全局 | 清空搜索框或关闭当前遮罩 / 对话框 |

---

## 🛠️ 代码库目录结构

```
Gemini Pilot/
├── manifest.json          # 扩展清单文件 (Manifest V3)
├── background.js          # 后台 Service Worker 脚本
├── browser-polyfill.js    # WebExtension 通用 API 兼容层
├── content.js             # 主 Content Script（Trace 导航面板、Diff patch 渲染）
├── content.css            # 主 CSS 样式（设计系统、键帽与毛玻璃效果）
├── css/
│   ├── tokens.css         # 玻璃设计 Token（日夜间主题变量）
│   ├── panel.css          # Trace 导航面板与折叠状态样式
│   ├── sidebar.css        # 批量删除浮条与模态框样式
│   └── folders.css        # 文件夹分组、原生三点菜单与 Badge 样式
├── modules/
│   ├── utils.js           # 工具函数库 (GTUtils 命名空间、存储、转义)
│   ├── batch-delete.js    # 多语言批量删除引擎与选择逻辑
│   ├── folders.js         # 文件夹分组引擎：存储、拖拽与三点菜单观察器
│   └── integration.js     # 模块边界管理器（保持右侧面板纯洁性）
├── icons/                 # 扩展图标集 (16px, 32px, 48px, 128px)
├── README.md              # 英文 README 引导文档
└── README_CN.md           # 中文 README 引导文档
```

---

## 🔒 隐私与安全

- **100% 本地运行**：所有 DOM 解析、大纲提取、数据存储与导出生成均严格在您的浏览器本地完成。
- **零数据追踪 / 零上报**：绝不收集、记录或向任何远程服务器传输您的任何对话数据。
- **最小权限设计**：仅申请 `storage`、`activeTab` 和 `scripting` 本地功能所必需的最小权限。

---

## 📜 开源协议

本项目基于 **MIT License** 协议开源。详见 `LICENSE` 文件。
