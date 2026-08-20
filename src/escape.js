// 转义原语层：JSON 转义表、配对解码/编码、门禁直通编码、引号感知扫描。
// 无内部依赖，供 json / toon / compress / transform 各层共用。

const JSON_ESCAPE = /\\["\\/bfnrtu]/;
const MAX_JSON_DECODE_ROUNDS = 3;
const JSON_INDENT = '\t';
// 与 JSON 标准对齐的完整转义表，TOON/JSON/Prompt 共用
const ESCAPE_MAP = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
// 结构性转义子集：整段文本被均匀转义时，引号外最常见的换行/制表/引号转义。
// 刻意小于 JSON_ESCAPE（不含 \\ \b \f \/ \u），用于判定「整体是否包着一层转义」，
// 避免把值内的字面转义误判为结构性转义。
const STRUCTURAL_ESCAPE = /[nrt"]/;
// 输入法/复制噪声引号：全角双引号 U+FF02、全角撇号 U+FF07，TOON 与压缩去噪共用
const FULLWIDTH_QUOTES = /[\uff02\uff07]/gu;

export function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    // 非严格输入：按 Prompt 文本语义配对解码一层，由调用方决定后续处理
    return decodeEscapeLayer(value, true);
  }
}

// 判定 input[start..start+5] 是否为合法 \uXXXX（start 指向反斜杠）
function isUnicodeEscape(input, start) {
  return input[start + 1] === 'u' && /^[0-9a-fA-F]{4}$/.test(input.slice(start + 2, start + 6));
}

// 解码 \uXXXX 为字符，返回 { value, end }（end 为最后一个十六进制位下标）；
// 非合法 \uXXXX 返回 null。decodeEscapeLayer / decodeToonEscape 共用单一实现
export function decodeUnicodeEscape(input, start) {
  if (!isUnicodeEscape(input, start)) return null;
  return { value: String.fromCharCode(parseInt(input.slice(start + 2, start + 6), 16)), end: start + 5 };
}

// 统一的配对转义解码器：从左到右每次消费一个 \X（\uXXXX 消费 6 字符），
// 从机制上保证 \\ 与 \" 的配对关系正确；未识别序列成对保留原样。
// foldLineBreaks 开启时（Prompt 文本语义），任意长度的反斜杠串后跟 n/r
// 一律折叠为单个换行/回车，兼容日志中的多层转义
export function decodeEscapeLayer(str, foldLineBreaks) {
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (foldLineBreaks) {
      let run = 1;
      while (str[i + run] === '\\') run += 1;
      const after = str[i + run];
      if (after === 'n' || after === 'r') {
        out += after === 'n' ? '\n' : '\r';
        i += run;
        continue;
      }
    }
    const next = str[i + 1];
    const unicode = decodeUnicodeEscape(str, i);
    if (unicode !== null) {
      out += unicode.value;
      i = unicode.end;
      continue;
    }
    if (next in ESCAPE_MAP) {
      out += ESCAPE_MAP[next];
      i += 1;
      continue;
    }
    if (next === undefined) {
      out += ch;
      continue;
    }
    out += ch + next;
    i += 1;
  }
  return out;
}

// 恰好编码一层 JSON 字符串转义，与 decodeEscapeLayer 互逆
export function encodeEscapeLayer(text) {
  return JSON.stringify(text).slice(1, -1);
}

// 门禁直通编码：文本已含合法转义（\" \\ \n \r \b \f \uXXXX）时原样保护、
// 绝不二次转义（规格门禁），仅把真实控制字符归一为单行转义；
// 未含转义时按完整转义表恰好编码一层。字面 \t 不视为已有转义：
// Windows 路径/正则（C:\tmp、\d+）远比转义 Tab 常见，其反斜杠按表转义
// 门禁保护的单字符转义（\" \\ \n \r \b \f；刻意排除 \t），与下方 GATED_ESCAPE 正则保持同步
const GATED_SINGLE_ESCAPES = '"\\nrbf';
const GATED_ESCAPE = /\\(?:["\\nrbf]|u[0-9a-fA-F]{4})/;
export function gateEncode(text) {
  const gated = GATED_ESCAPE.test(text);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      const protectedSeq = gated && next !== undefined
        && (isUnicodeEscape(text, i) || GATED_SINGLE_ESCAPES.includes(next));
      if (protectedSeq) {
        out += next === 'u' ? text.slice(i, i + 6) : ch + next;
        i += next === 'u' ? 5 : 1;
        continue;
      }
      out += '\\\\';
      continue;
    }
    if (ch === '"') { out += gated ? '"' : '\\"'; continue; }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    if (ch === '\b') { out += '\\b'; continue; }
    if (ch === '\f') { out += '\\f'; continue; }
    const code = ch.charCodeAt(0);
    if (code < 0x20) { out += `\\u${code.toString(16).padStart(4, '0')}`; continue; }
    out += ch;
  }
  return out;
}

// 将 Prompt 文本中叠加的转义层逐层剥掉，直到不再变化（显示语义：越剥越可读）
export function decodeToStableText(input) {
  let current = input;
  for (let round = 0; round <= MAX_JSON_DECODE_ROUNDS; round += 1) {
    if (!JSON_ESCAPE.test(current)) break;
    const decoded = decodeEscapeLayer(current, true);
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

// 剥一层转义：优先均匀剥层（整段按 JSON 字符串规则解一层，
// 多层转义日志的标准形态），退化为只还原结构引号（兼容非均匀日志）
export function unwrapEscapeLayer(text) {
  if (typeof text !== 'string' || !JSON_ESCAPE.test(text)) return undefined;
  const uniform = decodeEscapeLayer(text, false);
  if (uniform !== text) return uniform;
  const quotesOnly = unescapeQuotesOnly(text);
  return quotesOnly !== text ? quotesOnly : undefined;
}

// 仅将 \" 还原为引号，其余转义序列原样保留（非均匀转义日志的退化剥层）
function unescapeQuotesOnly(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      out += text[i + 1] === '"' ? '"' : ch + text[i + 1];
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// 配对扫描引号外字符：引号内 \X 成对跳过，visit 返回 false 提前终止
export function forEachOutsideChar(text, visit) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (visit(char, index) === false) return;
  }
}

// 字符串外存在 \" \n 等结构性转义：判定整体包着一层均匀转义，应先解码
// （转义只在引号值内时返回 false，交由值级处理，避免误剥）
export function hasStructuralEscapes(text) {
  let found = false;
  forEachOutsideChar(text, (char, index) => {
    if (char === '\\' && STRUCTURAL_ESCAPE.test(text[index + 1] || '')) {
      found = true;
      return false;
    }
  });
  return found;
}

// 通用：保留输入首尾空白（各格式化/压缩入口共享）
export function preserveEdgeWhitespace(input, formatted) {
  return `${input.match(/^\s*/)[0]}${formatted}${input.match(/\s*$/)[0]}`;
}

export { ESCAPE_MAP, FULLWIDTH_QUOTES, JSON_ESCAPE, JSON_INDENT, MAX_JSON_DECODE_ROUNDS, STRUCTURAL_ESCAPE };
