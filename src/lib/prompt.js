/**
 * Prompt 文本处理核心逻辑
 *
 * - sanitizeInput  : 清理粘贴进来的 JSON 包装碎片（如 `"content": "` 前缀、`",` 后缀）
 * - formatPrompt   : 行文本(带转义) → 可读的多行 Markdown（反转义）
 * - compressPrompt : 多行 Markdown → 单行行文本（JSON 安全转义，formatPrompt 的逆操作）
 */

/** 可识别的 JSON 包装前缀，例如 `"content": "` / `"text":"` */
const LEADING_WRAPPER = /^\s*\{?\s*"(?:content|text|value|prompt)"\s*:\s*"/i;

/**
 * 自动过滤粘贴内容中的 JSON 包装碎片
 * @param {string} raw 原始粘贴/输入文本
 * @returns {string} 清理后的文本
 */
export function sanitizeInput(raw) {
  if (!raw) return '';
  let text = raw.replace(/^\uFEFF/, ''); // 去掉 BOM

  const hasLeading = LEADING_WRAPPER.test(text);
  if (hasLeading) {
    text = text.replace(LEADING_WRAPPER, '');
    // 与头部包装配对地清理尾部：`",` / `"}` / 单独的 `"`
    text = text.replace(/"\s*[,}]*\s*$/, '');
  } else {
    // 仅尾部带 JSON 续接特征（`",` 或 `"},`）时清理，避免误伤正常 Markdown 末尾的引号
    text = text.replace(/"\s*,\s*\}?\s*$/, '');
  }
  return text;
}

/**
 * 行文本 → 格式化 Markdown（反转义）
 * 优先走 JSON.parse 以覆盖全部标准转义；失败时退回逐字符手工反转义，
 * 以容忍内容中存在的裸换行、裸引号等非严格 JSON 场景。
 * @param {string} raw 输入文本（允许带 JSON 包装碎片）
 * @returns {string} 反转义后的多行文本
 */
export function formatPrompt(raw) {
  const cleaned = sanitizeInput(raw);
  try {
    return JSON.parse(`"${cleaned}"`);
  } catch {
    return manualUnescape(cleaned);
  }
}

/**
 * 多行 Markdown → 单行行文本（formatPrompt 的逆操作）
 *
 * 完整转义清单（JSON 字符串必须转义的部分）：
 *   \  → \\      "  → \"
 *   换行 → \n    回车 → \r
 *   Tab → \t     退格 → \b    换页 → \f
 *   其余控制字符 (U+0000–U+001F) → \uXXXX
 * 注意：`/` 在 JSON 中无需转义（`\/` 合法但非必需），因此不做处理；
 * Unicode 字符保持原样输出，避免破坏可读性。
 *
 * @param {string} raw 多行文本
 * @returns {string} 单行转义文本（不含首尾引号）
 */
export function compressPrompt(raw) {
  const normalized = (raw || '').replace(/\r\n?/g, '\n'); // 统一换行符
  return JSON.stringify(normalized).slice(1, -1); // 去掉 JSON.stringify 附加的首尾引号
}

/** 逐字符反转义，容忍非严格 JSON 输入 */
function manualUnescape(str) {
  const map = {
    n: '\n',
    t: '\t',
    r: '\r',
    b: '\b',
    f: '\f',
    '"': '"',
    "'": "'",
    '\\': '\\',
    '/': '/',
  };
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(str.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(str.slice(i + 2, i + 6), 16));
        i += 5;
        continue;
      }
      if (next in map) {
        out += map[next];
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}
