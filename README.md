# Prompt 格式化工具（Prompt Formatting Tool）

> 一款 Chrome 扩展 + Web 双形态的 Prompt 内容格式化 / 压缩工具：在「带转义的单行行文本」与「可读的多行 Markdown」之间一键双向转换。

![screenshot](docs/screenshot.png)

## ✨ 解决什么问题

从 API 请求日志、对话数据集或代码中复制出来的 prompt 通常是这样的单行转义文本：

```
"content": "Extract spare-part records.\n\n<input>\n```\nrows[7]{r,cells}:\n...\n```\n</input>",
```

难以阅读、难以编辑。本工具将其一键还原为格式化的 Markdown：

- **格式化**：行文本 → 多行 Markdown（反转义 `\n` `\"` `\\` 等）
- **压缩**：多行 Markdown → 单行行文本（JSON 安全转义，可直接嵌回 JSON）

## 🚀 功能特性

| 功能 | 说明 |
| --- | --- |
| 格式化 | 反转义 `\n \r \t \b \f \" \\ \/ \uXXXX`，折叠连续空格/Tab，还原为可读 Markdown |
| 压缩 | 格式化的逆操作，输出可直接嵌入 JSON 字符串的单行文本 |
| 压缩去噪 | 与格式化同型去噪（剥 `"content": "` 包装、外层引号）；≥2 个连续空格/Tab 折为单空格；`<br>`/`<br/>`/`<br />` 统一转 `\n`；删除全角引号 `＂` `＇` |
| 自动过滤 | 粘贴时自动剥离 `"content": "` 前缀、`",` 后缀等 JSON 包装碎片 |
| Markdown 高亮 | 右侧输出区语法高亮 + 行号显示 |
| 三栏布局 | 左输入 / 右输出 / 中间可拖拽调节宽度，高度自适应（页面高度 − 顶栏） |
| 一键复制 | 输出结果一键复制到剪贴板 |
| Ant Design | 全部组件 small 尺寸、light 主题、Ant Icons |

## 📦 安装与使用

### 方式一：Chrome 扩展

1. 克隆并构建：

   ```bash
   git clone https://github.com/wentongCloud/prompt-formatting-tool.git
   cd prompt-formatting-tool
   npm install
   npm run build
   ```

2. 打开 Chrome，访问 `chrome://extensions`，开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目中的 **`dist`** 目录
4. 点击浏览器工具栏中的插件图标，工具会在新标签页打开

> 修改源码后需重新 `npm run build`，并在扩展页面点击该扩展的刷新按钮（↻）。

### 方式二：Web 应用（本地开发）

```bash
npm install
npm run dev
```

浏览器访问 <http://localhost:5173>，支持热更新，适合开发调试。

## 🔧 转义规则

**压缩（Markdown → 行文本）完整转义清单：**

| 原字符 | 转义结果 | 原字符 | 转义结果 |
| --- | --- | --- | --- |
| `\` | `\\` | 换行 | `\n` |
| `"` | `\"` | 回车 | `\r` |
| Tab | `\t` | 退格 | `\b` |
| 换页 | `\f` | 其他控制字符 (U+0000–U+001F) | `\uXXXX` |

> 注：`/` 在 JSON 中无需转义（`\/` 合法但非必需），故不做处理；Unicode 字符保持原样，保证可读性。
> 压缩同时做空白规整（见「压缩去噪」）；CR/CRLF 先归一为 LF。
> 门禁：输入已含合法转义（`\"` `\\` `\n` `\r` `\b` `\f` `\uXXXX`）时原样保护、绝不二次转义，重复压缩不叠加层级。
> 字面 `\t` 不视为已有转义：Windows 路径/正则（`C:\tmp`、`\d+`）远比转义 Tab 常见，其反斜杠按表转义为 `\\t`；单个真实 Tab 则输出 `\t`。

**格式化（行文本 → Markdown）** 优先使用 `JSON.parse` 覆盖全部标准转义；
对包含裸换行、裸引号等非严格 JSON 输入，自动退回逐字符反转义，保证健壮性。

> 空白折叠：格式化与压缩均将 ≥2 个连续空格/Tab 折为单空格；格式化保留行首缩进与行尾空白（Markdown 缩进代码块/硬换行语义），fenced 代码块原样不参与。
> `<br>` 归一、全角引号删除与行首尾修剪仅发生在压缩侧。例外：HTML 按空白语义折叠标签间空白，但 `<pre>`/`<textarea>`/`<script>`/`<style>` 内容原样保留。

## 🗂 项目结构

```
├── public/                    # 静态资源（构建时原样拷贝至 dist）
│   ├── manifest.json          # Chrome 扩展清单（MV3）
│   ├── background.js          # Service Worker：点击图标打开工具页
│   ├── icons/                 # 扩展图标 16/32/48/128
│   └── _locales/              # 国际化文案（zh_CN / en）
├── src/
│   ├── main.jsx               # 入口 + 三栏布局 UI（Ant Design ConfigProvider）
│   ├── transform.js           # 编排层：类型探测 / cleanPromptInput / formatPrompt / compressPrompt
│   ├── escape.js              # 转义编解码：配对扫描状态机、门禁直通编码、空白保留
│   ├── json.js                # JSON：多层剥层解析、jsonrepair 兜底、格式化
│   ├── html.js                # HTML：prettier 式建树与单行收拢，空白敏感元素保值
│   ├── toon.js                # TOON：引号感知剥层、多文档切分、值级格式化
│   ├── transform.test.js      # 单元测试（node --test）
│   └── styles.css             # 布局样式
├── index.html
└── vite.config.js             # base: './' 适配 chrome-extension:// 加载
```

## 🧰 技术栈

- [React 18](https://react.dev/) + [Vite 5](https://vitejs.dev/)
- [Ant Design 5](https://ant.design/)（small 尺寸 / light 主题）
- [@ant-design/icons](https://ant.design/components/icon)
- [react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter)（Prism · Markdown 高亮 · 行号）
- Chrome Extension [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)，仅申请 `clipboardWrite`（用于一键复制输出内容）

## 🛠 可用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器（Web 形态） |
| `npm test` | 运行核心逻辑单元测试 |
| `npm run build` | 构建生产产物至 `dist/`（可直接加载为 Chrome 扩展） |
| `npm run preview` | 本地预览构建产物 |

## 📄 License

[Apache License 2.0](LICENSE) © Prompt Formatting Tool Contributors
