// TOON 格式化层：rows[·]{·}: 表格文档的引号感知结构化排版。
// 依赖 escape.js 的转义原语与引号扫描。

import {
  ESCAPE_MAP, FULLWIDTH_QUOTES, MAX_JSON_DECODE_ROUNDS, decodeUnicodeEscape,
  forEachOutsideChar, hasStructuralEscapes, preserveEdgeWhitespace, unwrapEscapeLayer,
} from './escape.js';

// 表头正则两式：TOON_HEADER 锚定整段开头（探测/单文档判定），
// TOON_HEADER_LINE 带 g 标志全局匹配（拼接文档切分）；两者结构须保持一致。
export const TOON_HEADER = /^[^\n:]+\[\d+\]\{[^\n{}]+\}\s*:/;
const TOON_HEADER_LINE = /[^\n:{}]*\[\d+\]\{[^\n{}]+\}\s*:/g;

export function formatToon(input) {
  const trimmed = input.trim();
  if (!TOON_HEADER.test(trimmed)) return input;
  // 与统一转义模型对齐：引号外存在结构性转义时逐层剥到无结构性转义
  // （严格单层解码，不用 fold 语义，避免误伤值内 \\n 等字面转义）；
  // 多个 rows[·]{·}: 文档拼接的输入逐段独立格式化
  const decoded = peelToonLayers(trimmed);
  const documents = splitToonDocuments(decoded);
  const formatted = documents.map(formatSingleToon).filter(Boolean);
  if (formatted.length === 0) return input;
  return preserveEdgeWhitespace(input, formatted.join('\n\n'));
}

// 循环剥层直到引号外不再有结构性转义；每层用与 encodeEscapeLayer 互逆的
// 严格单层解码，不用 fold 语义，值内 \\n 字面转义剥层后交由值级处理
function peelToonLayers(text) {
  let current = text;
  for (let round = 0; round <= MAX_JSON_DECODE_ROUNDS; round += 1) {
    if (!hasStructuralEscapes(current)) return current;
    const unwrapped = unwrapEscapeLayer(current);
    if (unwrapped === undefined || unwrapped === current) return current;
    current = unwrapped;
  }
  return current;
}

// 按表头出现位置切分拼接的多文档；候选表头的冒号必须在顶层（引号外、深度 0）
function splitToonDocuments(text) {
  const headers = [];
  TOON_HEADER_LINE.lastIndex = 0;
  let match;
  while ((match = TOON_HEADER_LINE.exec(text)) !== null) {
    const colon = match.index + match[0].length - 1;
    if (isTopLevel(text, colon)) headers.push(match.index);
  }
  if (headers.length <= 1) return [text];
  const documents = [];
  for (let i = 0; i < headers.length; i += 1) {
    const end = i + 1 < headers.length ? headers[i + 1] : text.length;
    documents.push(text.slice(i === 0 ? 0 : headers[i], end));
  }
  return documents.map((segment) => segment.trim()).filter(Boolean);
}

// 目标位置处于引号外且花括号深度 0
function isTopLevel(text, target) {
  let depth = 0;
  let hit = false;
  forEachOutsideChar(text, (char, index) => {
    if (index >= target) {
      hit = index === target;
      return false;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
  });
  return hit && depth === 0;
}

function formatSingleToon(document) {
  const colon = findUnquotedColon(document);
  if (colon === -1 || !TOON_HEADER.test(document)) return '';

  const header = document.slice(0, colon + 1).trimEnd();
  const body = governToonValues(document.slice(colon + 1).trim());
  const lines = [];
  let line = '  ';
  let depth = 0;
  let quote = null;
  let escaped = false;
  const flush = () => {
    if (line.trim()) lines.push(line.trimEnd());
    line = '  '.repeat(depth + 1);
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      line += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      line += char;
    } else if (char === '{') {
      line += char;
      depth += 1;
      flush();
    } else if (char === '}') {
      flush();
      depth = Math.max(0, depth - 1);
      line = `${'  '.repeat(depth + 1)}}`;
    } else if (char === ',') {
      line += char;
      const next = findNextNonWhitespace(body, index + 1);
      if (next !== '{') flush();
    } else if (/\s/.test(char)) {
      if (line.trim() && !line.endsWith(' ')) line += ' ';
    } else {
      line += char;
    }
  }
  flush();
  return `${header}\n${lines.join('\n')}`;
}

function findNextNonWhitespace(input, start) {
  for (let index = start; index < input.length; index += 1) {
    if (!/\s/.test(input[index])) return input[index];
  }
  return undefined;
}

function governToonValues(input) {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== '"') {
      output += char;
      continue;
    }

    let value = '';
    let closed = false;
    for (index += 1; index < input.length; index += 1) {
      const current = input[index];
      if (current === '"') {
        closed = true;
        break;
      }
      if (current === '\\' && index + 1 < input.length) {
        const escaped = decodeToonEscape(input, index);
        value += escaped.value;
        index = escaped.end;
      } else {
        value += current;
      }
    }
    if (!closed) return input;
    // 与 JSON 字符串转义规则一致，直接复用 JSON.stringify
    output += JSON.stringify(normalizeToonValue(value));
  }
  return output;
}

function normalizeToonValue(value) {
  // 有意行为（有损）：全角/弯引号在 TOON 单元格内无语义，直接去除；
  // 连续空白折叠为单空格，保留业务空格
  return value
    .replace(/[\u2018\u2019\u201c\u201d]/gu, '')
    .replace(FULLWIDTH_QUOTES, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function decodeToonEscape(input, start) {
  const next = input[start + 1];
  // 与顶层 ESCAPE_MAP 单一来源对齐，避免两份转义表不同步
  if (next in ESCAPE_MAP) return { value: ESCAPE_MAP[next], end: start + 1 };
  const unicode = decodeUnicodeEscape(input, start);
  if (unicode !== null) return unicode;
  return { value: `\\${next}`, end: start + 1 };
}

function findUnquotedColon(input) {
  let braceDepth = 0;
  let result = -1;
  forEachOutsideChar(input, (char, index) => {
    // 跳过字段声明 {a:b} 内部的冒号，只认顶层分隔冒号
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ':' && braceDepth === 0) {
      result = index;
      return false;
    }
  });
  return result;
}
