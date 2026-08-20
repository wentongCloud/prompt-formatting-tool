// JSON 层：严格解析 + 转义剥层 + jsonrepair 兜底修复 + 格式化。
// 依赖 escape.js 的转义原语。

import { jsonrepair } from 'jsonrepair';
import { JSON_ESCAPE, JSON_INDENT, MAX_JSON_DECODE_ROUNDS, decodeJsonString, unwrapEscapeLayer } from './escape.js';

export function isJsonLike(value) {
  return typeof value === 'object' ? value !== null : /^[\[{]/.test(value);
}

export function isObject(value) {
  return typeof value === 'object' && value !== null;
}

// 去噪：剥掉包裹整个文档的外层引号（复制噪声，内层引号可能未转义）
export function stripWrappingQuotes(text) {
  let current = text;
  while (current.length >= 2 && current.startsWith('"') && current.endsWith('"')) {
    const inner = current.slice(1, -1).trim();
    if (inner === current) break;
    current = inner;
  }
  return current;
}

// 逐层剥开引号包裹与叠加转义，任一层出现完整 JSON 结构即认定
export function parseJsonDocument(input) {
  let current = stripWrappingQuotes(input);
  for (let round = 0; round <= MAX_JSON_DECODE_ROUNDS; round += 1) {
    const parsed = parseJsonLayers(current);
    if (parsed !== undefined) {
      if (isObject(parsed)) return parsed;
      if (typeof parsed !== 'string') return undefined;
      current = parsed.trim();
    } else {
      if (typeof current !== 'string' || !JSON_ESCAPE.test(current)) return undefined;
      const decoded = decodeJsonString(current);
      if (decoded === current) return undefined;
      current = decoded.trim();
    }
    // 剥开后必须仍像 JSON（含尚未剥完的引号字面量），否则放弃
    if (!isJsonLike(current) && !current.startsWith('"')) return undefined;
  }
  return undefined;
}

// 健壮的 JSON 解析：先严格解析，失败则逐层剥开转义后重试；
// 剥到无转义层仍不合法时，用成熟的 jsonrepair 兜底修复畸形 JSON
// （无引号键名/单引号/注释/尾随逗号/截断等，能力对齐 svelte-jsoneditor）
export function parseJsonLayers(input) {
  let current = input;
  for (let round = 0; round <= MAX_JSON_DECODE_ROUNDS; round += 1) {
    try {
      return JSON.parse(current);
    } catch {
      // 严格解析失败：继续剥转义层，无层可剥时落到修复兜底
    }
    const unwrapped = unwrapEscapeLayer(current);
    if (unwrapped === undefined) return repairJsonLike(current);
    current = unwrapped;
  }
  return repairJsonLike(current);
}

// 严格解析失败时的兜底：仅对形态像 JSON 的文本修复。jsonrepair 过于激进
// （会把普通句子包成字符串、把 Markdown 误判成数组），故只在以 { 或 [ 开头时
// 触发；对象形态额外要求含键值冒号，使 `{incomplete` 这类散文保持 prompt
function repairJsonLike(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (!isJsonLike(trimmed)) return undefined;
  if (trimmed[0] === '{' && !trimmed.includes(':')) return undefined;
  try {
    return JSON.parse(jsonrepair(trimmed));
  } catch {
    return undefined;
  }
}

export function isParsableJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function formatJson(input) {
  try {
    return JSON.stringify(JSON.parse(input), null, JSON_INDENT);
  } catch {
    return input;
  }
}
