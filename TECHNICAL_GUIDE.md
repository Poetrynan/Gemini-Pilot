# Gemini Pilot - 技术原理与完整学习指南

**版本：** 1.0.0
**日期：** 2026-07-28

---

## 目录

1. [项目本质](#1-项目本质)
2. [核心原理：浏览器扩展如何"增强"网页](#2-核心原理浏览器扩展如何增强网页)
3. [Trace 导航原理——如何给 Gemini 添加不存在的导航](#3-trace-导航原理如何给-gemini-添加不存在的导航)
4. [批量删除原理——如何模拟用户操作](#4-批量删除原理如何模拟用户操作)
5. [分组管理原理——如何给 Gemini 添加不存在的分组](#5-分组管理原理如何给-gemini-添加不存在的分组)
6. [Design Tokens——统一的设计系统](#6-design-tokens统一的设计系统)
7. [跨浏览器兼容层](#7-跨浏览器兼容层)
8. [需要学习的知识体系（完整讲授）](#8-需要学习的知识体系完整讲授)
9. [学习路径](#9-学习路径)
10. [常见问题](#10-常见问题)

---

## 1. 项目本质

### 一句话总结

> **浏览器扩展 = 获得向任何网页"注入"HTML/CSS/JS 的能力。** 我们不需要修改 Gemini 的源代码，只需要通过浏览器提供的"钩子"，就能在 Gemini 页面上添加原本不存在的功能。

### 对比理解

| 方式 | 说明 | 本项目是否使用 |
|------|------|---------------|
| 修改 Gemini 源码 | 直接改 Google 的代码 | ❌ 不可能 |
| 代理服务器 | 拦截并修改网络请求 | ❌ 太复杂 |
| **浏览器扩展** | 向页面注入自定义代码 | ✅ 本项目方案 |

### 架构示意图

```
┌─────────────────────────────────────────────────────────────┐
│                    Gemini 网页 (Google 提供)                  │
│                                                             │
│   原始 UI:  聊天框 + 输入框 + 侧边栏                          │
│             ❌ 没有导航面板                                    │
│             ❌ 没有批量删除                                    │
│             ❌ 没有分组功能                                    │
└─────────────────────────────────────────────────────────────┘
                              ↑
                      ┌───────┴───────┐
                      │  浏览器扩展注入  │
                      │  (我们的代码)   │
                      └───────┬───────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   用户实际看到的界面                            │
│                                                             │
│   Gemini 原始 UI  +  ✅ 我们的导航面板（右侧）                 │
│                  ✅ 我们的批量删除（侧边栏）                    │
│                  ✅ 我们的分组文件夹（侧边栏顶部）              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 核心原理：浏览器扩展如何"增强"网页

### 2.1 Content Script（内容脚本）机制

浏览器扩展通过 **Content Script** 向指定网页注入代码。这是浏览器扩展最核心的能力。

```json
// manifest.json
{
  "manifest_version": 3,
  "name": "Gemini Pilot",
  "version": "1.0.0",
  "content_scripts": [{
    "matches": ["https://gemini.google.com/*"],
    "js": [
      "browser-polyfill.js",
      "modules/utils.js",
      "modules/batch-delete.js",
      "modules/folders.js",
      "modules/integration.js",
      "content.js"
    ],
    "css": [
      "css/tokens.css",
      "css/panel.css",
      "css/sidebar.css",
      "css/folders.css"
    ],
    "run_at": "document_idle"
  }]
}
```

**这段配置的含义：**

| 字段 | 含义 |
|------|------|
| `matches` | URL 匹配规则，当用户访问 `gemini.google.com` 时触发 |
| `js` | 要注入的 JavaScript 文件列表，按顺序执行 |
| `css` | 要注入的 CSS 样式文件列表 |
| `run_at` | 执行时机，`document_idle` 表示页面加载完成后执行 |

### 2.2 执行流程

```
用户打开 Gemini 页面
        ↓
浏览器发现 URL 匹配 gemini.google.com
        ↓
自动加载 manifest.json 中声明的所有 JS 和 CSS
        ↓
各模块按顺序执行：
        │
        ├── browser-polyfill.js → 统一 Chrome/Firefox API 差异
        ├── modules/utils.js → 注册全局工具函数 (window.GTUtils)
        ├── modules/batch-delete.js → 注册批量删除 API (window.GTBatchDelete)
        ├── modules/folders.js → 注册分组管理 API (window.GTFolders)
        ├── modules/integration.js → 连接各模块的集成层
        ├── content.js → 创建 Trace 导航面板，整合所有功能
        ↓
用户看到 Gemini 原始界面 + 我们的增强功能
```

### 2.3 为什么 Content Script 不会和页面 JS 冲突？

Content Script 运行在**独立的 JavaScript 环境**中：
- ✅ 可以访问和修改页面的 DOM
- ❌ **不能**访问页面的 JavaScript 变量
- ❌ **不能**被页面的 JavaScript 访问

这就像两个平行世界：我们的代码能看到页面，但页面看不到我们。

---

## 3. Trace 导航原理——如何给 Gemini 添加不存在的导航

### 3.1 核心思想

Gemini 的每条消息都有固定的 DOM 结构。我们通过 CSS 选择器找到这些消息，提取文本内容，然后**动态创建**一个导航面板。

### 3.2 Gemini 消息的 DOM 结构

```html
<user-query>
  <div class="query-text gds-body-l">
    <span class="cdk-visually-hidden screen-reader-user-query-label">
      你说
    </span>
    <p class="query-text-line">实际的用户消息内容</p>
  </div>
</user-query>
```

**DOM 结构说明：**
- `<user-query>` - 每条用户消息的根元素
- `.query-text-line` - 实际的消息文本（我们要提取的）
- `.cdk-visually-hidden` - 无障碍标签（视觉隐藏，但 DOM 中存在）

### 3.3 读取消息（DOM 查询）

```javascript
// 找到所有用户消息
const messages = document.querySelectorAll('user-query');

// 提取文本内容（排除无障碍标签）
messages.forEach(msg => {
  const textEl = msg.querySelector('.query-text-line');
  const text = textEl.textContent.trim();
});
```

**知识点：`querySelector` 和 `querySelectorAll`**

```javascript
// querySelector - 返回第一个匹配的元素
document.querySelector('user-query');           // 第一条消息
document.querySelector('.query-text-line');     // 第一个文本行

// querySelectorAll - 返回所有匹配的元素（NodeList）
document.querySelectorAll('user-query');        // 所有消息
document.querySelectorAll('.query-text-line');  // 所有文本行

// 在特定元素内查询
msg.querySelector('.query-text-line');          // 在某条消息内查找
```

### 3.4 创建导航面板（DOM 创建）

```javascript
// 创建面板容器
const panel = document.createElement('div');
panel.id = 'gcn-panel';

// 创建消息列表
const list = document.createElement('div');
list.className = 'gcn-message-list';

// 为每条消息创建导航项
messages.forEach((msg, idx) => {
  const item = document.createElement('div');
  item.className = 'gcn-nav-item';
  item.innerHTML = `
    <span class="gcn-nav-index">${idx + 1}</span>
    <span class="gcn-nav-text">${text}</span>
  `;
  list.appendChild(item);
});

// 插入到页面
panel.appendChild(list);
document.body.appendChild(panel);
```

**知识点：DOM 创建 API**

```javascript
// 创建元素
document.createElement('div');

// 设置属性
element.id = 'gcn-panel';
element.className = 'gcn-nav-item';
element.innerHTML = '<span>文本</span>';
element.textContent = '纯文本';  // 自动转义 HTML

// 插入到 DOM
parent.appendChild(child);        // 添加到末尾
parent.insertBefore(new, ref);    // 插入到 ref 之前

// 事件监听
element.addEventListener('click', handler);
```

### 3.5 点击跳转（滚动定位）

```javascript
item.addEventListener('click', () => {
  msg.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
});
```

**知识点：`scrollIntoView`**

```javascript
// 基本用法
element.scrollIntoView();  // 立即滚动

// 平滑滚动
element.scrollIntoView({
  behavior: 'smooth',  // 平滑动画
  block: 'start',      // 元素顶部对齐视口顶部
  inline: 'nearest'    // 水平方向最近位置
});
```

### 3.6 滚动追踪（IntersectionObserver）

监听哪条消息在可视区域内，自动高亮对应的导航项：

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // 这条消息进入了可视区域
      const idx = Array.from(messages).indexOf(entry.target);
      // 更新导航面板的高亮
      updateActiveNavItem(idx);
    }
  });
}, {
  root: scrollContainer,      // 滚动容器
  rootMargin: '-100px 0px -50% 0px',  // 扩展检测区域
  threshold: 0.1             // 10% 可见时触发
});

// 开始观察所有消息
messages.forEach(msg => observer.observe(msg));
```

**知识点：IntersectionObserver 详解**

```javascript
// 创建观察器
const observer = new IntersectionObserver(callback, options);

// callback 接收 entries 数组
function callback(entries) {
  entries.forEach(entry => {
    entry.target;        // 被观察的元素
    entry.isIntersecting; // 是否在可视区域
    entry.intersectionRatio; // 可见比例 (0-1)
    entry.boundingBoundingClientRect; // 元素位置
  });
}

// options 配置
{
  root: element,     // 滚动容器（默认是视口）
  rootMargin: '0px', // 扩展/收缩检测区域（CSS margin 语法）
  threshold: 0.1    // 触发阈值（0-1，或数组）
}

// 控制观察
observer.observe(element);     // 开始观察
observer.unobserve(element);   // 停止观察
observer.disconnect();          // 停止所有观察
```

### 3.7 监听新消息（MutationObserver）

当用户发送新消息时，自动更新导航列表：

```javascript
const debouncedUpdate = window.GTUtils.debounce(() => {
  const prevCount = userMessages.length;
  const freshMessages = getUserMessages(true);
  renderMessageList();
  setupIntersectionObserver();

  // 当检测到用户发送了新 Prompt 时，自动定位并滚动至最新 Prompt
  if (prevCount > 0 && freshMessages.length > prevCount) {
    const newIndex = freshMessages.length - 1;
    const newElement = freshMessages[newIndex];
    if (newElement) {
      scrollToMessage(newElement, newIndex);
    }
  }
}, 200);

const mutationObserver = new MutationObserver((mutations) => {
  let shouldUpdate = false;
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
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
  if (shouldUpdate) debouncedUpdate();
});

mutationObserver.observe(scrollContainer, {
  childList: true,   // 监听子节点变化
  subtree: true      // 监听所有后代节点
});
```

### 3.8 历史对话按需加载（Load Earlier Turns）

Gemini 对长对话（>= 8 轮）采用了 DOM 虚拟化与按需加载机制。插件在 Trace 面板顶部动态维护一个 `.gcn-load-earlier-btn` 按钮（仅对 8+ 轮长对话生效）：

```javascript
function updateLoadEarlierButton() {
  if (!listContainer) return;
  let loadBtn = listContainer.querySelector('.gcn-load-earlier-btn');
  const messages = getUserMessages();
  
  // Gemini 仅在长对话 (>= 8 轮) 中开启 DOM 历史虚拟化
  const MIN_VIRTUAL_THRESHOLD = 8;

  if (messages.length >= MIN_VIRTUAL_THRESHOLD) {
    if (!loadBtn) {
      loadBtn = document.createElement('button');
      loadBtn.className = 'gcn-load-earlier-btn';
      loadBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <path d="M8 12V4M4 8l4-4 4 4"/>
        </svg>
        <span>Load Earlier Turns</span>
      `;
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgs = getUserMessages();
        if (msgs.length > 0 && msgs[0]) {
          msgs[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      listContainer.insertBefore(loadBtn, listContainer.firstChild);
    }
  } else if (loadBtn) {
    loadBtn.remove();
  }
}
```

**知识点：MutationObserver 详解**

```javascript
// 创建观察器
const observer = new MutationObserver(callback);

// callback 接收 mutations 数组
function callback(mutations) {
  mutations.forEach(mutation => {
    mutation.type;              // 变化类型
    mutation.target;            // 发生变化的节点
    mutation.addedNodes;        // 新增的节点
    mutation.removedNodes;      // 删除的节点
    mutation.attributeName;     // 变化的属性名
    mutation.oldValue;          // 变化前的值
  });
}

// options 配置
{
  childList: true,           // 监听子节点变化
  subtree: true,             // 监听所有后代
  attributes: true,          // 监听属性变化
  attributeFilter: ['class'], // 只监听特定属性
  characterData: false,      // 不监听文本内容变化
  oldValue: true             // 记录旧值
}

// 控制观察
observer.observe(target, options);  // 开始观察
observer.disconnect();              // 停止观察
observer.takeRecords();             // 获取待处理的变动记录
```

### 3.8 性能优化：DocumentFragment

批量插入 DOM 时使用 DocumentFragment 减少重排：

```javascript
// 使用 DocumentFragment 进行批量插入
const fragment = document.createDocumentFragment();

messages.forEach((msg, idx) => {
  const item = document.createElement('div');
  // ... 创建导航项 ...
  fragment.appendChild(item);  // 先添加到片段（不触发重排）
});

listContainer.appendChild(fragment);  // 一次性插入（只触发一次重排）
```

**知识点：DocumentFragment**

```javascript
// DocumentFragment 是一个轻量的文档容器
// 它的变化不会触发主文档的重排（reflow）
const fragment = document.createDocumentFragment();

// 批量添加子元素
for (let i = 0; i < 100; i++) {
  const div = document.createElement('div');
  fragment.appendChild(div);
}

// 一次性插入到 DOM（只触发一次重排）
document.body.appendChild(fragment);
```

---

## 4. 批量删除原理——如何模拟用户操作

### 4.1 核心思想

Gemini 侧边栏的每条对话都有"更多选项"按钮（三个点图标）。点击后会弹出菜单，里面有"删除"选项。批量删除就是**自动模拟这个点击流程**。

### 4.2 侧边栏 DOM 结构

```
<aside> 或 <nav> ← 侧边栏容器
  <infinite-scroller> ← 滚动容器
    <li> ← 每条对话
      <a href="/app/对话ID"> ← 对话链接
      <button aria-label="More options"> ← 菜单按钮
```

### 4.3 删除流程

```
用户勾选对话 → 点击"删除选中" → 输入确认 →
逐条执行：点击菜单按钮 → 点击 delete → 确认 delete →
显示进度 → 完成提示
```

### 4.4 关键代码

```javascript
async function deleteConversation(conv) {
  // 1. 找到菜单按钮
  const menuBtn = conv.querySelector(
    'button[aria-label*="options" i], button[aria-haspopup="menu"]'
  );

  // 2. 点击菜单按钮
  menuBtn.click();

  // 3. 等待菜单出现（轮询检测）
  const menu = await waitFor(() => {
    const menus = document.querySelectorAll('[role="menu"]');
    return Array.from(menus).find(m => isVisible(m));
  }, 3000, 200);

  // 4. 找到并点击 "Delete" 选项
  const deleteItem = Array.from(
    menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button')
  ).find(item => item.textContent.trim().toLowerCase() === 'delete');
  deleteItem.click();

  // 5. 等待确认对话框并点击确认
  await delay(500);
  const confirmBtn = await waitFor(() => {
    const buttons = document.querySelectorAll('button');
    return Array.from(buttons).find(b =>
      b.textContent.trim().toLowerCase() === 'delete' &&
      !menu.contains(b) &&
      isVisible(b)
    );
  }, 3000, 200);
  confirmBtn.click();
}
```

### 4.5 辅助函数

```javascript
// 等待元素出现（轮询）
function waitFor(selectorFn, timeout = 3000, interval = 200) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function check() {
      const result = selectorFn();
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - startTime >= timeout) {
        reject(new Error('Timeout'));
        return;
      }
      setTimeout(check, interval);
    }

    check();
  });
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 检测元素是否可见
function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
```

**知识点：async/await 和 Promise**

```javascript
// Promise - 异步操作的基础
const promise = new Promise((resolve, reject) => {
  setTimeout(() => {
    if (成功) {
      resolve('结果');
    } else {
      reject(new Error('失败'));
    }
  }, 1000);
});

// async/await - Promise 的语法糖
async function doSomething() {
  const result = await promise;  // 等待 Promise 完成
  console.log(result);  // '完成'
}

// 错误处理
async function doSomething() {
  try {
    const result = await promise;
  } catch (error) {
    console.error('出错了:', error);
  }
}
```

---

## 5. 分组管理原理——如何给 Gemini 添加不存在的分组

### 5.1 核心思想

分组功能是最复杂的。我们的方案是：**在 Gemini 侧边栏顶部注入一个"文件夹"区域**，用户可以把对话拖拽到文件夹中。分组数据存储在 `chrome.storage.local` 中。

### 5.2 侧边栏发现（Anchor Discovery）

这是分组功能的核心难点。Gemini 的侧边栏 DOM 结构可能会变化，所以我们使用**多种选择器**来定位：

```javascript
function getConversationAnchors() {
  const selectors = [
    'aside a[href*="/app/"]',
    'nav a[href*="/app/"]',
    '[aria-label*="history" i] a[href*="/app/"]',
    '[class*="conversation"] a[href*="/app/"]',
    '[class*="history"] a[href*="/app/"]'
  ];

  const seen = new Set();
  const anchors = [];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!isGeminiConversationHref(href)) return;
      const id = getConversationIdFromHref(href);
      if (!id || seen.has(id)) return;
      seen.add(id);
      anchors.push(a);
    });
  });

  return anchors;
}
```

**知识点：CSS 选择器**

```javascript
// 基本选择器
'div'                    // 标签选择器 - 选择所有 <div>
'.class'                 // 类选择器 - 选择 class="class" 的元素
'#id'                    // ID 选择器 - 选择 id="id" 的元素

// 属性选择器
'[href]'                 // 有 href 属性
[href*="/app/"]          // href 包含 "/app/"
[href^="/app/"]          // href 以 "/app/" 开头
[href$=".png"]           // href 以 ".png" 结尾
[aria-label*="options" i] // aria-label 包含 "options"（i = 不区分大小写）

// 组合选择器
'aside a[href*="/app/"]'  // aside 内的 a 标签（后代选择器）
'nav > a'                 // nav 的直接子元素 a（子选择器）
'a + b'                   // a 后面的第一个 b（相邻兄弟）
'a ~ b'                   // a 后面的所有 b（通用兄弟）

// 伪类选择器
:first-child              // 第一个子元素
:last-child               // 最后一个子元素
:nth-child(2n)            // 偶数个子元素
:not(.exclude)            // 排除 .exclude
:hover, :focus, :active   // 状态伪类
```

### 5.3 文件夹区域注入

```javascript
function ensureSection() {
  const section = createEl('div', {
    id: 'gt-folders-section',
    class: 'gt-folders-section'
  }, [
    createEl('div', { class: 'gt-folders-header' }, [
      createEl('span', { text: 'Folders' }),
      createEl('button', { class: 'gt-folders-new-btn', text: '+ New' })
    ]),
    createEl('div', { class: 'gt-folders-list' })
  ]);

  return section;
}

// 将文件夹区域插入到侧边栏顶部
function placeSection(sidebarRoot, section) {
  let firstNativeRow = null;
  for (const child of sidebarRoot.children) {
    if (child.querySelector && child.querySelector('a[href*="/app/"]')) {
      firstNativeRow = child;
      break;
    }
  }
  if (firstNativeRow) {
    sidebarRoot.insertBefore(section, firstNativeRow);
  }
}
```

### 5.4 拖拽分组（HTML5 Drag & Drop）

```javascript
// 绑定拖拽源（原生对话行）
row.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', convId);
  row.classList.add('gt-dragging');
});

row.addEventListener('dragend', () => {
  row.classList.remove('gt-dragging');
});

// 绑定拖拽目标（文件夹行）
folderRow.addEventListener('dragover', (e) => {
  e.preventDefault();  // 必须阻止默认行为才能触发 drop
  e.dataTransfer.dropEffect = 'move';
  folderRow.classList.add('gt-drag-over');
});

folderRow.addEventListener('dragleave', () => {
  folderRow.classList.remove('gt-drag-over');
});

folderRow.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  folderRow.classList.remove('gt-drag-over');
  const convId = e.dataTransfer.getData('text/plain');
  assign(convId, folderId);  // 将对话分配到文件夹
});
```

### 5.5 原生三点菜单注入与对话 ID 动态解析

插件监控 Gemini 的浮动 Material 3 弹出菜单（`[role="menu"]`），并动态注入 `Move to Folder` 与 `Batch Select` 自定义选项。

为了保证 100% 正确抓取目标对话 ID 并消除事件闭包竞争，插件采用了**多重节点动态解析 (`getConvIdFromNode`)** 与 **延迟防竞争武装**：

```javascript
function getConvIdFromNode(node) {
  if (!node) return null;
  const boundRow = node.closest && node.closest('[data-gt-conv-id]');
  if (boundRow && boundRow.dataset && boundRow.dataset.gtConvId) return boundRow.dataset.gtConvId;

  const itemContainer = node.closest && node.closest('conversation-item-viewer, li, [role="listitem"], [data-test-id*="conversation"], .gt-folder-conv-item');
  if (itemContainer) {
    if (itemContainer.dataset && itemContainer.dataset.gtConvId) return itemContainer.dataset.gtConvId;
    const anchor = itemContainer.querySelector('a[href*="/app/"]');
    if (anchor) return getConversationIdFromHref(anchor.getAttribute('href') || '');
  }

  let curr = node.parentElement;
  while (curr && curr !== document.body) {
    if (curr.dataset && curr.dataset.gtConvId) return curr.dataset.gtConvId;
    const anchors = curr.querySelectorAll('a[href*="/app/"]');
    if (anchors.length >= 1) return getConversationIdFromHref(anchors[0].getAttribute('href') || '');
    curr = curr.parentElement;
  }
  return null;
}

function resolveTriggerConvId(trigger, menu) {
  if (trigger) {
    const id = getConvIdFromNode(trigger);
    if (id) return id;
  }
  if (menu) {
    const liveTrigger = getTriggerForMenu(menu);
    if (liveTrigger) {
      const id = getConvIdFromNode(liveTrigger);
      if (id) return id;
    }
  }
  const expandedTrigger = document.querySelector('[aria-expanded="true"]');
  if (expandedTrigger) {
    const id = getConvIdFromNode(expandedTrigger);
    if (id) return id;
  }
  return getConversationIdFromHref(location.href);
}
```

**知识点：HTML5 Drag & Drop API**

```javascript
// 拖拽源（被拖动的元素）
element.setAttribute('draggable', 'true');

element.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', '数据');  // 设置拖拽数据
  e.dataTransfer.effectAllowed = 'move';         // 允许的操作
});

element.addEventListener('dragend', () => {
  // 拖拽结束
});

// 拖拽目标（放置区域）
element.addEventListener('dragover', (e) => {
  e.preventDefault();  // 必须阻止默认行为
  e.dataTransfer.dropEffect = 'move';
});

element.addEventListener('dragleave', () => {
  // 拖拽离开
});

element.addEventListener('drop', (e) => {
  e.preventDefault();
  const data = e.dataTransfer.getData('text/plain');  // 获取拖拽数据
  // 处理放置
});
```

### 5.5 数据持久化（chrome.storage）

```javascript
// 数据结构
const state = {
  folders: [
    { id: 'folder_1', name: '工作相关', collapsed: false, color: '#4285F4' }
  ],
  assignments: {
    'conv_id_1': 'folder_1',
    'conv_id_2': 'folder_1'
  },
  conversations: {
    'conv_id_1': {
      id: 'conv_id_1',
      title: '关于深度学习的讨论',
      href: '/app/conv_id_1',
      lastSeenAt: 1721980000000
    }
  }
};

// 读取数据
async function loadState() {
  const result = await chrome.storage.local.get('gtFoldersState');
  state = normalizeState(result.gtFoldersState);
}

// 保存数据
async function saveFolders() {
  await chrome.storage.local.set({ gtFoldersState: state });
}
```

**知识点：chrome.storage API**

```javascript
// chrome.storage.local - 本地存储
chrome.storage.local.get('key', (result) => {
  console.log(result.key);
});
chrome.storage.local.set({ key: 'value' }, () => {
  console.log('保存成功');
});
chrome.storage.local.remove('key');
chrome.storage.local.clear();

// chrome.storage.sync - 同步存储（多端同步）
chrome.storage.sync.get('key', callback);
chrome.storage.sync.set({ key: 'value' }, callback);

// 存储限制
// local: 10MB
// sync: 100KB（每个项目 8KB，最多 512 项）
```

### 5.6 SPA 路由兼容

Gemini 是单页应用（SPA），页面切换不会重新加载。我们需要监听路由变化：

```javascript
// 路由监听
setInterval(() => {
  const routeKey = location.pathname + location.search;
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    scheduleRender();  // 重新渲染文件夹 UI
  }
}, 600);
```

**知识点：SPA 路由检测**

```javascript
// 方法 1: 轮询检测（本项目使用）
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    onRouteChange();
  }
}, 600);

// 方法 2: 重写 history API
const originalPushState = history.pushState;
history.pushState = function(...args) {
  originalPushState.apply(this, args);
  window.dispatchEvent(new Event('pushstate'));
  window.dispatchEvent(new Event('locationchange'));
};

window.addEventListener('popstate', () => {
  window.dispatchEvent(new Event('locationchange'));
});

window.addEventListener('locationchange', () => {
  onRouteChange();
});
```

---

## 6. Design Tokens——统一的设计系统

### 6.1 什么是 Design Tokens？

Design Tokens 是设计系统中的**原子级变量**，用于统一颜色、间距、字体等视觉属性。

```css
:root {
  /* 颜色 */
  --gt-glass-bg: rgba(255, 255, 255, 0.72);
  --gt-text-primary: #1A1815;
  --gt-accent: #8B7355;

  /* 间距 */
  --gt-radius-sm: 6px;
  --gt-radius-md: 8px;
  --gt-radius-lg: 12px;

  /* 动画 */
  --gt-transition-fast: 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* 深色模式 */
[data-gt-theme="dark"] {
  --gt-glass-bg: rgba(26, 24, 28, 0.82);
  --gt-text-primary: #FFFFFF;
  --gt-accent: #C4A97D;
}
```

### 6.2 毛玻璃效果（Glassmorphism）

```css
.gt-panel {
  background: var(--gt-glass-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--gt-glass-border);
  border-radius: var(--gt-radius-xl);
  box-shadow: var(--gt-shadow-md);
}
```

**知识点：backdrop-filter**

```css
// backdrop-filter - 背景模糊效果
backdrop-filter: blur(20px);           // 模糊
backdrop-filter: blur(20px) saturate(180%);  // 模糊 + 饱和度
backdrop-filter: brightness(0.8);      // 亮度
backdrop-filter: contrast(1.2);        // 对比度

// 需要 -webkit- 前缀兼容 Safari
-webkit-backdrop-filter: blur(20px);
```

### 6.3 CSS 变量（Custom Properties）

```css
/* 定义变量 */
:root {
  --my-color: red;
}

/* 使用变量 */
.element {
  color: var(--my-color);           // red
  color: var(--my-color, blue);     // 如果 --my-color 不存在，使用 blue
}

/* 在 JS 中操作 */
element.style.setProperty('--my-color', 'blue');
getComputedStyle(element).getPropertyValue('--my-color');
```

---

## 7. 跨浏览器兼容层

### 7.1 问题与跨浏览器差异

Chrome / Edge 和 Firefox 的扩展 API 与运行环境存在差异：
- **Chrome / Edge (Chromium)**: 使用 `chrome.*`（回调风格），后台运行环境为 `ServiceWorker`（全局对象为 `self` / `globalThis`，不存在 `window`）。
- **Firefox (Gecko)**: 使用 `browser.*`（Promise 风格），前后台均原生支持 WebExtension Promise API。

若仅在 polyfill 中使用 `window.browser = ...`，在 Chrome/Edge 的 Service Worker 环境下会引发 `ReferenceError: window is not defined`。

### 7.2 解决方案：多上下文兼容 Polyfill

```javascript
// browser-polyfill.js
(function () {
  'use strict';

  // 1. 自动识别运行环境全局对象 (Window / ServiceWorker / Worker)
  const root = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));

  // 2. 原生支持 browser API 时直接返回 (如 Firefox)
  if (typeof root.browser !== 'undefined' && root.browser.runtime && root.browser.storage) {
    return;
  }

  if (typeof chrome === 'undefined') return;

  // 3. 统一挂载 Promise 封装对象
  root.browser = {
    runtime: {
      sendMessage: (message) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      }),
      onMessage: {
        addListener: (callback) => {
          chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            const res = callback(msg, sender);
            if (res instanceof Promise) {
              res.then(sendResponse).catch(err => sendResponse({ error: err ? err.message : String(err) }));
              return true; // 保持异步通道开启
            }
            return res;
          });
        }
      }
    },
    tabs: {
      query: (queryInfo) => new Promise((resolve, reject) => {
        chrome.tabs.query(queryInfo, (tabs) => {
          if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(tabs || []);
        });
      }),
      sendMessage: (tabId, message, options) => new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, options, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      })
    },
    storage: {
      local: {
        get: (keys) => new Promise((resolve, reject) => {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res || {});
          });
        }),
        set: (items) => new Promise((resolve, reject) => {
          chrome.storage.local.set(items, () => {
            if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        })
      }
    }
  };
})();
```

**知识点与适配策略：**
1. **Manifest V3 运行器配置**：在 `manifest.json` 中使用 `background: { service_worker: "background.js", scripts: ["browser-polyfill.js", "background.js"] }`，让 Chromium 运行 ServiceWorker 的同时允许 Firefox 加载 background scripts。
2. **`importScripts` 在 Worker 中引入**：`background.js` 头部包含 `if (typeof browser === 'undefined') try { importScripts('browser-polyfill.js'); } catch(e){}`，确保在 ServiceWorker 启动时先加载 polyfill。
3. **Firefox CSS 滚动条兼容**：在 CSS 中结合使用 `-webkit-scrollbar` 与 W3C 标准 `scrollbar-width: thin; scrollbar-color: ...`。
4. **剪贴板安全降级**：`copyPrompt` 在使用 `navigator.clipboard.writeText` 的同时使用 `document.execCommand('copy')` 作为备选方案。

---

## 8. 需要学习的知识体系（完整讲授）

### 8.1 HTML / CSS 基础

#### 8.1.1 DOM（文档对象模型）

DOM 是 HTML 文档的**树形结构表示**。浏览器把 HTML 解析成一棵树，每个元素是一个"节点"。

```html
<!-- HTML -->
<div id="parent">
  <span class="child">Hello</span>
  <span class="child">World</span>
</div>
```

```
DOM 树:
div#parent
├── span.child (Hello)
└── span.child (World)
```

**节点类型：**
- `ELEMENT_NODE` (1) - 元素节点（如 `<div>`）
- `TEXT_NODE` (3) - 文本节点（如 "Hello"）
- `COMMENT_NODE` (8) - 注释节点
- `DOCUMENT_NODE` (9) - 文档节点

#### 8.1.2 CSS 选择器

```javascript
// 基本选择器
'div'                    // 标签选择器
'.class'                 // 类选择器
'#id'                    // ID 选择器

// 属性选择器
'[href]'                 // 有 href 属性
[href*="/app/"]          // href 包含 "/app/"
[href^="/app/"]          // href 以 "/app/" 开头
[href$=".png"]           // href 以 ".png" 结尾
[aria-label*="options" i] // aria-label 包含 "options"（不区分大小写）

// 组合选择器
'aside a[href*="/app/"]'  // aside 内的 a 标签（后代选择器）
'nav > a'                 // nav 的直接子元素 a（子选择器）
'a + b'                   // a 后面的第一个 b（相邻兄弟）
'a ~ b'                   // a 后面的所有 b（通用兄弟）

// 伪类选择器
:first-child, :last-child, :nth-child(n)
:hover, :focus, :active
:not(selector)
```

#### 8.1.3 CSS 变量（Custom Properties）

```css
/* 定义变量（通常在 :root 中） */
:root {
  --primary-color: #8B7355;
  --spacing-md: 16px;
}

/* 使用变量 */
.button {
  background: var(--primary-color);
  padding: var(--spacing-md);
}

/* 带默认值的变量 */
.button {
  color: var(--text-color, black);  /* 如果 --text-color 不存在，使用 black */
}

/* 变量可以计算 */
.element {
  width: calc(var(--base-width) * 2);
}
```

#### 8.1.4 Flexbox 布局

```css
.container {
  display: flex;
  flex-direction: row;      /* 主轴方向：row | column */
  justify-content: center;  /* 主轴对齐：flex-start | center | space-between */
  align-items: center;      /* 交叉轴对齐：flex-start | center | stretch */
  gap: 8px;                 /* 子元素间距 */
  flex-wrap: wrap;          /* 是否换行 */
}

.item {
  flex: 1;                  /* 占据剩余空间 */
  flex-shrink: 0;           /* 不收缩 */
  flex-basis: 100px;        /* 基础宽度 */
}
```

#### 8.1.5 CSS 动画

```css
/* transition - 过渡动画 */
.button {
  background: blue;
  transition: background 0.3s ease;
}
.button:hover {
  background: red;  /* 0.3秒内平滑过渡到红色 */
}

/* animation - 关键帧动画 */
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.element {
  animation: slideIn 0.3s ease-out;
}
```

### 8.2 JavaScript 基础

#### 8.2.1 DOM 操作

```javascript
// 查询元素
document.querySelector('#id');           // ID 选择器
document.querySelector('.class');        // 类选择器
document.querySelectorAll('.item');      // 所有匹配的元素

// 创建元素
const div = document.createElement('div');
div.id = 'my-div';
div.className = 'my-class';
div.textContent = '纯文本（自动转义 HTML）';
div.innerHTML = '<span>HTML 内容</span>';

// 插入元素
parent.appendChild(child);           // 添加到末尾
parent.insertBefore(new, ref);       // 插入到 ref 之前

// 事件监听
element.addEventListener('click', handler);
element.removeEventListener('click', handler);

// 事件委托（利用冒泡）
parent.addEventListener('click', (e) => {
  if (e.target.matches('.item')) {
    // 处理 .item 的点击
  }
});
```

#### 8.2.2 异步编程

```javascript
// Promise
const promise = new Promise((resolve, reject) => {
  setTimeout(() => {
    if (成功) resolve('结果');
    else reject(new Error('失败'));
  }, 1000);
});

promise
  .then(result => console.log(result))
  .catch(error => console.error(error));

// async/await
async function fetchData() {
  try {
    const result = await promise;
    return result;
  } catch (error) {
    console.error('出错了:', error);
  }
}

// 实用函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
```

#### 8.2.3 解构赋值和展开运算符

```javascript
// 数组解构
const [a, b, ...rest] = [1, 2, 3, 4, 5];

// 对象解构
const { name, age, ...others } = { name: 'Alice', age: 30, city: 'NYC' };

// 展开运算符
const arr = [1, 2, 3];
const newArr = [...arr, 4, 5];  // [1,2,3,4,5]

const obj = { a: 1, b: 2 };
const newObj = { ...obj, c: 3 };  // {a:1, b:2, c:3}
```

### 8.3 浏览器扩展开发

#### 8.3.1 Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "Gemini Pilot",
  "version": "1.0.0",
  "description": "...",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["https://gemini.google.com/*"],
  "content_scripts": [{
    "matches": ["https://gemini.google.com/*"],
    "js": ["content.js"],
    "css": ["styles.css"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js"
  },
  "commands": {
    "toggle-panel": {
      "suggested_key": { "default": "Alt+N" },
      "description": "切换面板"
    }
  }
}
```

#### 8.3.2 Content Script 生命周期

```
页面加载
   ↓
document_idle（页面空闲）
   ↓
content.js 执行
   ↓
创建 UI、绑定事件、开始监听
   ↓
用户交互 → 响应事件
   ↓
SPA 路由变化 → MutationObserver 检测 → 重新绑定
   ↓
扩展禁用/页面关闭 → 清理
```

### 8.4 浏览器 API

#### 8.4.1 IntersectionObserver

```javascript
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        console.log('可见:', entry.target);
      }
    });
  },
  {
    root: document.querySelector('.scroll-container'),
    rootMargin: '-100px 0px -50% 0px',
    threshold: 0.1
  }
);

observer.observe(element);
observer.unobserve(element);
observer.disconnect();
```

#### 8.4.2 MutationObserver

```javascript
const observer = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          console.log('新增元素:', node);
        }
      });
    }
  });
});

observer.observe(targetNode, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style']
});
```

#### 8.4.3 chrome.storage

```javascript
// local 存储
chrome.storage.local.get('key', (result) => {
  console.log(result.key);
});
chrome.storage.local.set({ key: 'value' }, () => {
  console.log('保存成功');
});

// sync 存储（多端同步）
chrome.storage.sync.get('key', callback);
chrome.storage.sync.set({ key: 'value' }, callback);

// Promise 封装
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}
```

---

## 9. 学习路径

### 第一阶段：前端基础（2-3 周）

```
HTML / CSS
├── DOM 树结构理解
├── CSS 选择器（重点！）
├── 盒模型与布局 (Flexbox / Grid)
├── CSS 变量与自定义属性
├── backdrop-filter 毛玻璃效果
└── CSS 动画 (transition / animation)

JavaScript (ES6+)
├── 变量、数据类型、函数
├── DOM 操作 API
├── 箭头函数、模板字符串、解构
├── 数组方法 (forEach, map, filter)
├── Promise / async-await
└── 模块化 (import / export)
```

### 第二阶段：浏览器扩展（1 周）

```
浏览器扩展基础
├── 什么是浏览器扩展
├── Manifest V3 规范
├── Content Script 注入机制
├── Background Service Worker
└── Chrome 开发者模式
```

### 第三阶段：进阶开发（2-3 周）

```
浏览器 API 深入
├── IntersectionObserver
├── MutationObserver
├── Storage API (local / sync)
├── Scroll API
├── Clipboard API
└── requestAnimationFrame

性能优化
├── DocumentFragment
├── 防抖与节流
├── DOM 缓存
└── CSS 动画优化
```

### 第四阶段：项目实践（2-3 周）

```
本项目实战
├── 分析 Gemini DOM 结构
├── 实现导航面板
├── 实现滚动追踪
├── 实现 hover 预览
├── 实现批量删除
├── 实现分组管理
└── 性能优化
```

---

## 10. 常见问题

### Q1: 扩展会被 Gemini 的更新影响吗？

**会。** 我们的扩展依赖 Gemini 的 DOM 结构。如果 Google 更新了这些，扩展可能会失效。

**应对策略：**
- 使用更稳定的选择器（如标签名 `user-query`）
- 提供 fallback 选择器（多种选择器尝试）
- 定期检查并更新

### Q2: 为什么不用 React/Vue 等框架？

本项目是浏览器扩展的 Content Script，特点：
- 需要轻量（不能打包大型框架）
- 运行在别人的页面上（不能有框架冲突）
- 直接使用 DOM API 最简单高效

### Q3: Content Script 和页面的 JS 会冲突吗？

**不会。** Content Script 运行在独立的 JavaScript 环境中：
- 可以访问页面的 DOM
- **不能**访问页面的 JavaScript 变量
- **不能**被页面的 JavaScript 访问

### Q4: 如何调试 Content Script？

1. 打开 `chrome://extensions/`
2. 找到扩展，点击 "检查视图" (Inspect views)
3. 在 DevTools 中可以看到 Content Script 的 Console

### Q5: 分组数据如何多端同步？

使用 `chrome.storage.sync` 而非 `chrome.storage.local`：
- `sync`：数据同步到用户的 Google 账号，多端可用
- `local`：数据只保存在本地

### Q6: 如何模拟点击 Gemini 的删除菜单？

Gemini 的菜单是动态渲染的，需要：
1. 点击菜单触发按钮
2. 等待菜单 DOM 渲染完成（使用 `waitFor` 轮询）
3. 找到菜单中的"删除"选项并点击
4. 等待确认对话框并点击确认

---

*维护团队：Development Team*
*最后更新：2026-07-28 (v1.0.0)*
