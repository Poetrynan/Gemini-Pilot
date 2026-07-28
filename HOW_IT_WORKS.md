# Gemini Pilot - 技术原理与学习指南

**版本：** 1.0.0（模块化毛玻璃引擎 + Approach A 分组）
**日期：** 2026-07-28

---

## 1. 项目概览与架构愿景

**Gemini Pilot** 是 Google Gemini（`gemini.google.com`）的浏览器扩展，为用户提供两大核心工具：

```
┌──────────────────────────────────────────┐      ┌──────────────────────────────────────────┐
│ Gemini 左侧边栏（全局历史记录）              │      │ Gemini Pilot 右侧面板（对话轮次导航）       │
│                                          │      │                                          │
│ ├─ 📁 分组文件夹（顶部区域）               │      │ ├─ ⌨️  键盘快捷键速查表                    │
│ ├─ 📁 移动到文件夹                        │      │ ├─ 🔍  实时对话轮次搜索                    │
│ ├─ ☑️  批量删除                          │      │ ├─ 📥  导出会话（Markdown / JSON）         │
│ ├─ 🗑️  多语言批量删除                     │      │ └─ ☀️/🌙 毛玻璃主题切换与折叠              │
└──────────────────────────────────────────┘      └──────────────────────────────────────────┘
```

- **右侧导航面板（`#gcn-panel`）**：严格用于**单会话对话轮次导航**、实时搜索、会话导出和键盘遍历。
- **左侧边栏子模块（`modules/folders.js`、`modules/batch-delete.js`）**：注入"移动到文件夹"和"批量删除"到 Gemini 原生三点菜单，在对话列表顶部渲染分组区域，支持多语言批量删除。

---

## 2. 核心技术组件

### 2.1 时间戳功能（v3 中已移除）

> 时间戳功能（主世界 `/batchexecute` RPC 拦截 + 内联 `AF_initDataCallback` 脚本抓取）在 v3 中**已移除**。原因是会话级别的时间戳与每条消息的映射不一致（除第一条消息外，其余都回退到"刚刚"），且额外复杂度不值得。Trace 面板现在只显示提示文本，不带时间戳。

### 2.1b Approach A 分组——自包含顶部区域（`modules/folders.js`）

扩展不再移动 Gemini 的原生行，而是在侧边栏**顶部**注入**一个**自包含的 `#gt-folders-section`，从 `chrome.storage.local['gtFoldersState']` 渲染文件夹及其对话。

- **挂载**：`findSidebarRoot(anchors)` 找到包含置顶和最近对话锚点的最高层祖先；`placeSection()` 将区域插入到所有原生行（包括置顶）之上。
- **分配**：右键原生行 → "移动到文件夹"；原生三点菜单中的"移动到文件夹"项；或将原生行拖拽到文件夹行上。
- **原地打开与事件保护**：点击文件夹内的对话会调用原生 `<a>` 标签，使 Gemini 的 Angular Router 无需完整重载即可导航。`.gt-folder-conv` 的点击/keydown 处理程序中的 `e.stopPropagation()` 防止点击事件冒泡到父级 `.gt-folder-row` 导致意外自动折叠。
- **弹性**：800ms 折叠状态轮询器在侧边栏/最近对话折叠-展开后确定性地重建区域；稳定状态下零 DOM 变化（无观察器循环）。

### 2.2 原生三点弹出菜单观察器（`setupNativeMenuObserver`）

- 监听 `document.body` 中的 Gemini 浮动 Material 弹出菜单（`[role="menu"]`、`.mat-mdc-menu-panel`）。
- 注入原生样式项：
  - `移动到文件夹`：打开自定义文件夹选择器下拉框 / 自定义名称输入模态框。
  - `批量删除`：激活侧边栏选择模式，带多选复选框 `[ ]`。
- 强制像素级 Material 3 对齐：`height: 48px`、`padding: 0 16px`、线条艺术 20x20 SVG 轮廓图标（`stroke-width: 1.8px`）。

### 2.3 即时 SPA 路由检测（0ms 延迟）

- 重写 `history.pushState` 和 `history.replaceState` 并监听 `popstate` 事件。
- 在 `messageHash` 中嵌入 `location.href`（`${messages.length}_${firstText}_${location.href}`），以在对话间导航时强制哈希失效，消除空白面板错误。
- 执行 350ms 重试循环（`rebindTimer`），在 Gemini 完成渲染新 `<user-query>` DOM 元素的瞬间重新绑定。

### 2.4 性能与流式防御

- 在 `MutationObserver` 中快速跳过 `model-response` 节点，防止 AI 输出流式传输时的 CPU 抖动。
- 使用 `DocumentFragment` 和 `requestAnimationFrame` 进行批量 DOM 渲染。

### 2.5 主题同步（Trace 面板 + 分组区域）

- Trace 面板切换（`Alt+T` / 月亮按钮）在 `#gcn-panel` 上设置 `data-gcn-theme` 并持久化到 `localStorage['gcn-theme-dark']`。
- `content.js` 中的 `applyTheme()` 在 `#gt-folders-section` 和所有浮动覆盖层上设置 `data-gcn-theme`，然后调用 `window.GTFolders.syncTheme()`（用于即时非延迟主题更新）和 `window.GTFolders.refresh()`（用于下一帧完整渲染）。
- **不透明深色表面**：`folders.css` 为 `#gt-folders-section[data-gcn-theme="dark"]` 及其所有子行/列表定义不透明的 `#1C1B1F` 背景，消除 Gemini 原生白色侧边栏的背景渗透。
- `modules/folders.js` 中的 `isDark()` 使用 3 层检测器：扩展面板属性 → `localStorage` → Gemini 原生深色模式（计算 `<body>`/`<html>` 的背景亮度）。`MutationObserver` 加 800ms 翻转轮询提供回退，使分组区域跟随扩展切换和 Gemini 自身主题。

---

## 3. UI UX Pro Max 设计令牌

所有模态框、覆盖层和吐司提示都遵循 **UI UX Pro Max** 设计系统：
- **牛奶白玻璃**：`rgba(255, 255, 255, 0.78)` 背景 + `backdrop-filter: blur(20px)`。
- **深色黑曜石玻璃**：`rgba(28, 26, 24, 0.92)` 背景 + 高对比度 `#FFFFFF` 文本 + 琥珀金色强调（`#C4A97D`）。
- **触觉键帽（`<kbd>`）**：3D 凸起键帽样式 + `border-bottom: 2px solid`。

---

## 4. 如何给 Gemini 添加不存在的功能

### 4.1 Trace 导航——原理

**核心思想**：Gemini 的每条消息都有固定的 DOM 结构。我们通过 CSS 选择器找到这些消息，提取文本内容，然后**动态创建**一个导航面板。

**Gemini 消息的 DOM 结构：**
```html
<user-query>
  <div class="query-text gds-body-l">
    <span class="cdk-visually-hidden screen-reader-user-label">你说</span>
    <p class="query-text-line">实际的用户消息内容</p>
  </div>
</user-query>
```

**读取消息：**
```javascript
const messages = document.querySelectorAll('user-query');
messages.forEach(msg => {
  const textEl = msg.querySelector('.query-text-line');
  const text = textEl.textContent.trim();
});
```

**创建导航面板：**
```javascript
const panel = document.createElement('div');
panel.id = 'gcn-panel';
// ... 创建消息列表 ...
document.body.appendChild(panel);
```

**点击跳转：**
```javascript
msg.scrollIntoView({ behavior: 'smooth', block: 'start' });
```

**滚动追踪（IntersectionObserver）：**
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // 更新导航面板高亮
    }
  });
}, { root: scrollContainer, threshold: 0.1 });
messages.forEach(msg => observer.observe(msg));
```

### 4.2 批量删除——原理

**核心思想**：Gemini 侧边栏的每条对话都有"更多选项"按钮（三个点图标）。点击后弹出菜单，里面有"删除"选项。批量删除就是**自动模拟这个点击流程**。

**删除流程：**
```
用户勾选对话 → 点击"删除选中" → 输入确认 →
逐条执行：点击菜单按钮 → 点击 delete → 确认 delete →
显示进度 → 完成提示
```

**关键代码：**
```javascript
// 找到菜单按钮
const menuBtn = conv.querySelector('button[aria-label*="options" i]');
menuBtn.click();

// 等待菜单出现
const menu = await waitFor(() => document.querySelector('[role="menu"]'));

// 点击删除
const deleteItem = Array.from(menu.querySelectorAll('[role="menuitem"]'))
  .find(item => item.textContent.trim().toLowerCase() === 'delete');
deleteItem.click();

// 确认删除
const confirmBtn = Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim().toLowerCase() === 'delete' && isVisible(b));
confirmBtn.click();
```

### 4.3 分组管理——原理

**核心思想**：在 Gemini 侧边栏顶部注入一个"文件夹"区域，用户可以把对话拖拽到文件夹中。分组数据持久化在 `chrome.storage.local` 中（由于 `chrome.storage.sync` 存在 100KB 配额与 8KB 单项上限，采用 `chrome.storage.local` 优化容量限制，并在初始化时从旧版 `sync` 空间自动平滑迁移 `gtFoldersState`）。

**侧边栏发现（Anchor Discovery）：**
```javascript
function getConversationAnchors() {
  const selectors = [
    'aside a[href*="/app/"]',
    'nav a[href*="/app/"]',
    '[aria-label*="history" i] a[href*="/app/"]'
  ];
  // 多选择器 + 去重
}
```

**文件夹区域注入：**
```javascript
function ensureSection() {
  const section = createEl('div', { id: 'gt-folders-section' });
  // 插入到侧边栏顶部
  sidebarRoot.insertBefore(section, firstNativeRow);
}
```

**拖拽分组（HTML5 Drag & Drop）：**
```javascript
row.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', convId);
});
folderRow.addEventListener('drop', (e) => {
  const convId = e.dataTransfer.getData('text/plain');
  assign(convId, folderId);
});
```

**数据持久化（Local Storage 优化）：**
```javascript
await chrome.storage.local.set({ gtFoldersState: state });
```

---

## 5. 需要学习的知识体系

### 5.1 前端基础（必备）

| 知识点 | 本项目用途 | 重要程度 |
|--------|-----------|---------|
| DOM 结构理解 | 理解 Gemini 的 HTML 结构 | ⭐⭐⭐⭐⭐ |
| CSS 选择器 | 精准定位元素 | ⭐⭐⭐⭐⭐ |
| CSS 变量 | 主题切换 | ⭐⭐⭐⭐ |
| Flexbox / Grid | 面板布局 | ⭐⭐⭐⭐ |
| backdrop-filter | 毛玻璃效果 | ⭐⭐⭐ |
| DOM API | 读取/创建/修改元素 | ⭐⭐⭐⭐⭐ |
| querySelector | 查找元素 | ⭐⭐⭐⭐⭐ |
| addEventListener | 事件监听 | ⭐⭐⭐⭐⭐ |
| async/await | 异步操作 | ⭐⭐⭐⭐ |

### 5.2 浏览器扩展开发

| 概念 | 说明 | 本项目用途 |
|------|------|-----------|
| **Manifest** | 扩展的配置文件 | 声明权限、注入规则 |
| **Content Script** | 注入到网页的脚本 | 核心逻辑 |
| **Background Service Worker** | 后台服务 | 键盘快捷键 |
| **Permissions** | 权限声明 | 访问网站、存储 |

### 5.3 浏览器 API

| API | 本项目用途 |
|-----|-----------|
| `IntersectionObserver` | 检测哪条消息在可视区域 |
| `MutationObserver` | 监听新消息添加 |
| `chrome.storage.local` | 本地持久化存储（容量优化配额限制，支持 sync 数据自动迁移） |
| `element.scrollIntoView()` | 平滑滚动到目标 |
| `navigator.clipboard.writeText()` | 复制到剪贴板 |

---

## 6. 学习路径

### 第一阶段：前端基础（1-2 周）
- HTML / CSS 基础
- JavaScript (ES6+)
- DOM 操作 API

### 第二阶段：浏览器扩展（1 周）
- Manifest V3 规范
- Content Script 注入机制
- 扩展的加载与调试

### 第三阶段：进阶开发（2 周）
- IntersectionObserver / MutationObserver
- Storage API / Scroll API
- 性能优化技巧

### 第四阶段：项目实践（1-2 周）
- 分析 Gemini DOM 结构
- 实现导航面板、批量删除、分组管理

---

*维护团队：ZCode Development Team*
*最后更新：2026-07-28（与 BUGFIXES.md 和代码 v1.0.0 对齐）*
