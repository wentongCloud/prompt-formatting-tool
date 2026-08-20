// 入口与编排层：类型探测、输入清洗、prompt 格式化、压缩。
// 具体实现分布在 escape.js / json.js / html.js / toon.js。

import {
  FULLWIDTH_QUOTES, JSON_ESCAPE, JSON_INDENT, MAX_JSON_DECODE_ROUNDS,
  decodeEscapeLayer, decodeJsonString, decodeToStableText, encodeEscapeLayer,
  gateEncode, hasStructuralEscapes, preserveEdgeWhitespace,
} from './escape.js';
import {
  isJsonLike, isObject, isParsableJson, parseJsonDocument, parseJsonLayers,
  stripWrappingQuotes, formatJson,
} from './json.js';
import { collapseAllWhitespace, formatHtml } from './html.js';
import { TOON_HEADER, formatToon } from './toon.js';

const CONTENT_PREFIX = /^\s*[,{]?\s*"content"\s*:\s*/;
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;
// 非 CJK 文本按 UTF-8 字节 / 4 估算 token 数
const BYTES_PER_TOKEN = 4;
const TEXT_ENCODER = new TextEncoder();

export function estimateTokens(input) {
  if (!input) return 0;
  // CJK 按 1 字符 ≈ 1 token 单独计权，其余按 UTF-8 字节 / BYTES_PER_TOKEN 估算
  const cjk = input.match(CJK_CHAR);
  const cjkCount = cjk ? cjk.length : 0;
  const restBytes = TEXT_ENCODER.encode(cjkCount ? input.replace(CJK_CHAR, '') : input).length;
  return Math.ceil(cjkCount + restBytes / BYTES_PER_TOKEN);
}

export function detectInputType(input) {
  const trimmed = input.trim();
  if (!trimmed) return 'prompt';
  // JSON 探测：不依赖固定形态的正则，而是剥开引号包裹/叠加转义后
  // 以标准 JSON.parse 严格校验，兼容对象、数组及多层转义的 JSON 文本
  if (parseJsonDocument(trimmed) !== undefined) return 'json';
  // HTML：任何以标签/注释/doctype 开头的文本，不枚举具体形态
  if (trimmed.startsWith('<')) return 'html';
  if (TOON_HEADER.test(trimmed)) return 'toon';
  return 'prompt';
}

export function formatInput(input, type = detectInputType(input)) {
  if (type === 'json') return formatJsonInput(input);
  if (type === 'html') return formatHtmlInput(input);
  if (type === 'toon') return formatToon(input);
  return formatPrompt(input);
}

export function cleanPromptInput(input) {
  const text = input.trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.content === 'string') return parsed.content;
    if (typeof parsed === 'string') return parsed;
  } catch {
    // The input may be a JSON fragment rather than a complete JSON value.
  }

  // 非包装碎片时原样返回（含边缘空白，由调用方保留）；
  // 命中包装碎片时返回解码后的内容
  if (!CONTENT_PREFIX.test(text)) return input;

  let value = text.replace(CONTENT_PREFIX, '');
  value = value.replace(/^"/, '');
  value = value.replace(/"\s*,?\s*}?\s*$/, '');
  return decodeJsonString(value);
}

export function formatPrompt(input) {
  const cleaned = cleanPromptInput(input);

  // Complete JSON documents must be formatted before their string values are
  // decoded. Otherwise an escaped newline inside a value makes the JSON invalid.
  const jsonDocument = formatJsonDocument(cleaned);
  if (jsonDocument !== null) return jsonDocument;

  return formatStructuredContent(cleaned);
}

function formatJsonDocument(input) {
  // 与检测/压缩侧对齐：手动锁定 Prompt 类型时也能剥掉未转义的外层引号包裹
  const trimmed = stripWrappingQuotes(input.trim());
  if (!isJsonLike(trimmed)) return null;

  const parsed = parseJsonLayers(trimmed);
  if (!isObject(parsed)) return null;
  return preserveEdgeWhitespace(input, JSON.stringify(parsed, null, JSON_INDENT));
}

// 局部构造：带 g 标志的正则共享会引入 lastIndex 隐式状态；
// 语言可选（裸 ``` 围栏按 Markdown 语义同样是代码块），\n? 兼容单行围栏
function fencedBlockRegex() {
  return /```([a-zA-Z0-9_-]*)[ \t]*\n?([\s\S]*?)```/gi;
}

function formatStructuredContent(input) {
  // fenced 代码块内容自足：内容可解析时直接格式化，不参与外层转义解码；
  // 匹配不到或内容不可解析，说明整体还包着一层转义（压缩产物），
  // 用与编码互逆的严格解码剥掉后重试
  let source = input;
  for (let round = 0; round <= MAX_JSON_DECODE_ROUNDS; round += 1) {
    const fenced = formatFencedBlocks(source);
    if (fenced !== null) return fenced;
    // 围栏外仍有转义说明整体还包着一层（压缩产物），剥层重试
    if (!JSON_ESCAPE.test(stripFencedBlocks(source))) break;
    const decoded = decodeEscapeLayer(source, false);
    if (decoded === source) break;
    source = decoded;
  }

  const decoded = decodeToStableText(input);
  const trimmed = decoded.trim();
  const formatted = isJsonLike(trimmed)
    ? formatJson(trimmed)
    : trimmed.startsWith('<') ? formatHtml(trimmed) : collapsePromptWhitespace(trimmed);

  return formatted === input ? input : preserveEdgeWhitespace(input, formatted);
}

// 规格 1c/1d：纯文本格式化同压缩侧折叠 ≥2 个连续空格/Tab 为单空格；
// fenced 段自足不参与，保留行首缩进与行尾空白（Markdown 缩进代码块/硬换行语义）
function collapsePromptWhitespace(text) {
  return splitFencedParts(text).map((part) => (part.fenced
    ? part.text
    : part.text.split('\n').map((line) => {
      const lead = line.match(/^[ \t]*/)[0];
      const rest = line.slice(lead.length);
      const trail = rest.match(/[ \t]*$/)[0];
      const body = rest.slice(0, rest.length - trail.length).replace(/[ \t]{2,}/g, ' ');
      return lead + body + trail;
    }).join('\n'))).join('');
}

// 格式化 fenced 代码块；未匹配到任何块或 JSON 块内容不可解析时返回 null
function formatFencedBlocks(input) {
  let found = false;
  let formatted = true;
  const result = input.replace(fencedBlockRegex(), (match, language, content) => {
    found = true;
    const lang = (language || '').toLowerCase();
    const trimmedContent = content.trim();
    if (lang === 'json' && !isParsableJson(trimmedContent)) {
      formatted = false;
      return match;
    }
    if (lang !== 'json' && lang !== 'html' && lang !== 'xml') return match;
    const pretty = lang === 'json' ? formatJson(trimmedContent) : formatHtml(trimmedContent);
    return `\`\`\`${language}\n${pretty}\n\`\`\``;
  });
  // 围栏外仍带转义：整体还包着一层，交由剥层重试，不提前返回
  if (found && formatted && JSON_ESCAPE.test(stripFencedBlocks(input))) return null;
  return found && formatted ? result : null;
}

function stripFencedBlocks(text) {
  return text.replace(fencedBlockRegex(), '');
}

function formatJsonInput(input) {
  const parsed = parseJsonDocument(input.trim());
  if (!isObject(parsed)) return input;
  return preserveEdgeWhitespace(input, JSON.stringify(parsed, null, JSON_INDENT));
}

function formatHtmlInput(input) {
  const trimmed = input.trim();
  const formatted = formatHtml(trimmed);
  return formatted === trimmed ? input : preserveEdgeWhitespace(input, formatted);
}

export function compressPrompt(input) {
  // CR/CRLF 归一为 LF（有意设计，README 已标注）；随后与格式化侧对齐去噪
  const normalized = (input || '').replace(/\r\n?/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) return preserveEdgeWhitespace(input || '', '');

  const parsed = parseJsonDocument(trimmed);
  if (isObject(parsed)) {
    const compact = JSON.stringify(compactJsonValue(parsed));
    return preserveEdgeWhitespace(normalized, encodeEscapeLayer(compact));
  }

  // 去噪与格式化侧对齐：剥离 "content": " 包装碎片与外层引号
  const cleaned = cleanPromptInput(trimmed).trim();
  // TOON 是引号感知的结构化文本：仅当引号外存在结构性转义才严格剥一层，
  // 再盲重编码一层（与 formatToon 的剥层对称），值内字面转义由引号配对保护
  if (TOON_HEADER.test(cleaned)) {
    const peeled = hasStructuralEscapes(cleaned)
      ? decodeEscapeLayer(cleaned, false)
      : cleaned;
    return preserveEdgeWhitespace(normalized, encodeEscapeLayer(collapseInlineWhitespace(peeled)));
  }
  return preserveEdgeWhitespace(normalized, compressPlainText(cleaned));
}

// 文本路径的去噪与编码：先去噪折叠得到纯文本形态做整体 HTML 判定；
// 非 HTML 按段编码——非 fenced 段门禁直通（不先解码，避免 C:\tmp 类字面 \t 被误当 Tab），
// fenced 段盲加一层转义（与格式化侧剥层对称，保住块内自身转义）
function compressPlainText(input) {
  const parts = splitFencedParts(input);
  const plain = parts.map((part) => (!part.fenced
    ? collapseInlineWhitespace(normalizeCopyNoise(part.text))
    : `\`\`\`${part.language}\n${collapseFencedContent(part)}\n\`\`\``)).join('');
  if (detectInputType(plain) === 'html') return gateEncode(collapseAllWhitespace(plain));
  return parts.map((part) => (!part.fenced
    ? gateEncode(collapseInlineWhitespace(normalizeCopyNoise(part.text)))
    : encodeEscapeLayer(`\`\`\`${part.language}\n${collapseFencedContent(part)}\n\`\`\``))).join('');
}

function splitFencedParts(input) {
  const parts = [];
  let lastIndex = 0;
  const blockRegex = fencedBlockRegex();
  let match = blockRegex.exec(input);
  while (match !== null) {
    parts.push({ fenced: false, text: input.slice(lastIndex, match.index) });
    parts.push({ fenced: true, language: (match[1] || '').toLowerCase(), text: match[2] });
    lastIndex = blockRegex.lastIndex;
    match = blockRegex.exec(input);
  }
  parts.push({ fenced: false, text: input.slice(lastIndex) });
  return parts;
}

// fenced 内容自足（与格式化侧对称）：json/html/xml 压缩排版，
// 其余语言（含裸围栏）原样保留仅盲加一层转义
function collapseFencedContent(part) {
  const trimmed = part.text.trim();
  if (part.language === 'json' && isParsableJson(trimmed)) {
    return JSON.stringify(JSON.parse(trimmed));
  }
  if (part.language === 'json') return collapseInlineWhitespace(trimmed);
  if (part.language === 'html' || part.language === 'xml') return collapseAllWhitespace(trimmed);
  return part.text.replace(/^\n+|\n+$/g, '');
}

// 压缩时折叠 JSON 值内的空白：连续空格/Tab 折为单空格，行首尾去白
function compactJsonValue(value) {
  if (typeof value === 'string') return collapseInlineWhitespace(normalizeCopyNoise(value));
  if (Array.isArray(value)) return value.map(compactJsonValue);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactJsonValue(item)]));
  }
  return value;
}

// 逐行折叠：≥2 个连续空格/Tab 折为单空格（单个 Tab 保留，按转义表输出 \t），
// 去除行首尾空白，保留换行结构
function collapseInlineWhitespace(text) {
  return text.split('\n').map((line) => line.replace(/[ \t]{2,}/g, ' ').trim()).join('\n');
}

// 压缩去噪：HTML 换行标签统一为换行；删除输入法混入的全角引号
function normalizeCopyNoise(text) {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(FULLWIDTH_QUOTES, '');
}

export { formatToon };
