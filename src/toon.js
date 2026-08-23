// TOON 格式化层：通用表头（name[N]{fields}: / name[N]: / name{fields}:）的
// 引号感知结构化排版。依赖 escape.js 的转义原语与引号扫描。

import {
  ESCAPE_MAP, FULLWIDTH_QUOTES, MAX_JSON_DECODE_ROUNDS, decodeUnicodeEscape,
  forEachOutsideChar, hasStructuralEscapes, preserveEdgeWhitespace, unwrapEscapeLayer,
} from './escape.js';

// 表头正则两式：TOON_HEADER 锚定整段开头（探测/单文档判定），
// TOON_HEADER_LINE 带 g 标志全局匹配（拼接文档切分）；两者结构须保持一致。
// 兼容 TOON 三种表头：name[N]{fields}:、name[N]:（无字段声明的数组）、name{fields}:（单对象）
export const TOON_HEADER = /^[^\s:{}]+\[\d+\](?:\{[^}]+\})?\s*:|^[^\s:{}]+\{[^}]+\}\s*:/;
// 切分用表头须顶格（后行断言锁定行首，名字不含空白）：
// 缩进或 - 项目符号开头的表头属于嵌套结构，无法命中，自然不作切分点
const TOON_HEADER_LINE = /(?<=^|\n)[^\s:{}]+\[\d+\](?:\{[^}]+\})?\s*:|(?<=^|\n)[^\s:{}]+\{[^}]+\}\s*:/g;

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

// 按表头出现位置切分拼接的多文档；候选表头的冒号必须在顶层（引号外、深度 0），
// 且表头须顶格（嵌套表头无法命中 TOON_HEADER_LINE，天然被排除）
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
  // 有行结构（剥层后的压缩产物）按行排版：CSV 行整行保留不拆逗号；
  // 无行结构的扁平输入沿用逗号逐项拆行的状态机排版
  const lines = body.includes('\n') ? formatToonLines(body) : flattenToonBody(body);
  return `${header}\n${lines.join('\n')}`;
}

// 行感知排版：源行即 TOON 行（表格行整行保留不按逗号拆分），按块栈缩进。
// 块栈以表头声明的长度计数：数据行由最内层块消费，计数耗尽逐层出栈；
// 新块表头先由耗尽规则处理——从而 items[N] 下多个并列 - fields[·]{·}: 块
// 保持同级缩进（上一块行数耗尽即出栈）；截断输入超出声明行数时，
// 块保持打开不再回退（可读性优先）
function formatToonLines(body) {
  const lines = [];
  let depth = 0;
  const stack = [];
  const popExhausted = () => {
    while (stack.length > 0 && stack[stack.length - 1].remaining <= 0) {
      stack.pop();
      depth = Math.max(0, depth - 1);
    }
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    popExhausted();
    let leadingCloses = 0;
    while (line[leadingCloses] === '}') leadingCloses += 1;
    depth = Math.max(0, depth - leadingCloses);
    lines.push(`${'  '.repeat(depth + 1)}${line}`);
    depth = Math.max(0, depth + netBraces(line) + leadingCloses);
    if (endsWithColon(line)) {
      stack.push({ remaining: parseBlockLength(line) });
      depth += 1;
    } else if (stack.length > 0 && stack[stack.length - 1].remaining !== Infinity) {
      stack[stack.length - 1].remaining -= 1;
    }
  }
  return lines;
}

// 块表头声明的元素/行数：只认表头自身的 [N]（字段声明 {·} 里的方括号不算）；
// 无 [N] 声明视为 1（单对象）；[ 后无数字视为无限长（不自动关闭）
function parseBlockLength(line) {
  const match = line.match(/\[(\d+)\](?:\{[^}]*\})?:$/);
  if (match) return Number(match[1]);
  return /\[(?:\{[^}]*\})?:$/.test(line) ? Infinity : 1;
}

// 引号外的花括号净增量（开减闭）
function netBraces(line) {
  let net = 0;
  forEachOutsideChar(line, (char) => {
    if (char === '{') net += 1;
    else if (char === '}') net -= 1;
  });
  return net;
}

// 行末（去空白后）是否以冒号结尾：块表头判定。直接看行末原始字符：
// 以引号值结尾的行（如 1:"Sensor"）末字符是引号不会误判，字段声明 {a:b} 内的冒号不在行末
function endsWithColon(line) {
  return line.endsWith(':');
}

// 扁平正文的状态机排版：逗号逐项拆行，{ 加深、} 收拢（原单文档排版行为）
function flattenToonBody(body) {
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
  return lines;
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
