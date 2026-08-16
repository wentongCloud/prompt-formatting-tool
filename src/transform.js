const CONTENT_PREFIX = /^\s*[,{]?\s*"content"\s*:\s*/;
const TOON_HEADER = /^[^\n:]+\[\d+\]\{[^\n{}]+\}\s*:/;
const TEXT_ENCODER = new TextEncoder();

export function estimateTokens(input) {
  if (!input) return 0;
  return Math.ceil(TEXT_ENCODER.encode(input).length / 4);
}

export function detectInputType(input) {
  const trimmed = input.trim();
  if (!trimmed) return 'prompt';
  if (/^[\[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Continue with lightweight syntax checks.
    }
  }
  if (/^(?:<!doctype\s+html\b|<!--|<\/?[a-z][\s\S]*>)/i.test(trimmed)) return 'html';
  if (TOON_HEADER.test(trimmed)) return 'toon';
  if (/^[\[{]\\"/.test(trimmed)) {
    try {
      JSON.parse(decodeJsonString(trimmed));
      return 'json';
    } catch {
      // Treat malformed escaped JSON as a prompt.
    }
  }
  return 'prompt';
}

export function formatInput(input, type = detectInputType(input)) {
  if (type === 'json') return formatJsonInput(input);
  if (type === 'html') return formatHtmlInput(input);
  if (type === 'toon') return formatToon(input);
  return formatPrompt(input);
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return manualUnescape(value);
  }
}

// 逐字符反转义：正确处理 `\\n`（转义反斜杠+n）等连续转义场景，
// 并容忍裸换行、裸引号等非严格 JSON 输入
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

export function cleanPromptInput(input) {
  const text = input.trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.content === 'string') return parsed.content;
    if (typeof parsed === 'string') return parsed;
  } catch {
    // The input may be a JSON fragment rather than a complete JSON value.
  }

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

  const normalized = normalizeEscapedLineBreaks(cleaned);
  const decoded = /\\[nrt"\\]/.test(normalized) ? decodeJsonString(normalized) : normalized;
  return formatStructuredContent(decoded);
}

function formatJsonDocument(input) {
  const trimmed = input.trim();
  if (!/^[\[{]/.test(trimmed)) return null;

  try {
    const formatted = JSON.stringify(JSON.parse(trimmed), null, '\t');
    const leadingWhitespace = input.match(/^\s*/)[0];
    const trailingWhitespace = input.match(/\s*$/)[0];
    return `${leadingWhitespace}${formatted}${trailingWhitespace}`;
  } catch {
    return null;
  }
}

// Logs and copied request bodies may add more than one escaping layer to line
// breaks. Collapse only newline escapes here; a general repeated unescape would
// turn unrelated sequences such as `\\\\t` into tabs.
function normalizeEscapedLineBreaks(input) {
  return input.replace(/\\+(?=[nr])/g, '\\');
}

function formatStructuredContent(input) {
  const fenced = input.replace(/```(json|html|xml)\s*\n([\s\S]*?)```/gi, (match, language, content) => {
    const formatted = language.toLowerCase() === 'json'
      ? formatJson(content.trim())
      : formatHtml(content.trim());
    return `\`\`\`${language}\n${formatted}\n\`\`\``;
  });

  if (fenced !== input) return fenced;

  const trimmed = input.trim();
  const edgeWhitespace = input.match(/^\s*/)[0];
  const trailingWhitespace = input.match(/\s*$/)[0];
  const formatted = /^[\[{]/.test(trimmed)
    ? formatJson(trimmed)
    : /^<[^>]+>/.test(trimmed) ? formatHtml(trimmed) : trimmed;

  return formatted === trimmed ? input : `${edgeWhitespace}${formatted}${trailingWhitespace}`;
}

function formatJson(input) {
  try {
    return JSON.stringify(JSON.parse(input), null, '\t');
  } catch {
    return input;
  }
}

function formatJsonInput(input) {
  const trimmed = input.trim();
  const decoded = /^[\[{]\\"/.test(trimmed) ? decodeJsonString(trimmed) : trimmed;
  const formatted = formatJson(decoded);
  return formatted === decoded ? input : preserveEdgeWhitespace(input, formatted);
}

function formatHtmlInput(input) {
  const trimmed = input.trim();
  const formatted = formatHtml(trimmed);
  return formatted === trimmed ? input : preserveEdgeWhitespace(input, formatted);
}

function preserveEdgeWhitespace(input, formatted) {
  return `${input.match(/^\s*/)[0]}${formatted}${input.match(/\s*$/)[0]}`;
}

export function formatToon(input) {
  const trimmed = input.trim();
  const colon = findUnquotedColon(trimmed);
  if (colon === -1 || !TOON_HEADER.test(trimmed)) return input;

  const header = trimmed.slice(0, colon + 1).trimEnd();
  const body = governToonValues(trimmed.slice(colon + 1).trim());
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
  return preserveEdgeWhitespace(input, `${header}\n${lines.join('\n')}`);
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
    output += `"${escapeToonString(normalizeToonValue(value))}"`;
  }
  return output;
}

function normalizeToonValue(value) {
  return value
    .replace(/[\u2018\u2019\u201c\u201d\uff02\uff07]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function decodeToonEscape(input, start) {
  const next = input[start + 1];
  const escapes = { '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' };
  if (next in escapes) return { value: escapes[next], end: start + 1 };
  const unicode = input.slice(start + 1, start + 6);
  if (/^u[0-9a-fA-F]{4}$/.test(unicode)) {
    return { value: String.fromCharCode(parseInt(unicode.slice(1), 16)), end: start + 5 };
  }
  return { value: `\\${next}`, end: start + 1 };
}

function escapeToonString(value) {
  let output = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === '\\') output += '\\\\';
    else if (char === '"') output += '\\"';
    else if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else if (code <= 0x1f) output += `\\u${code.toString(16).padStart(4, '0')}`;
    else output += char;
  }
  return output;
}

function findUnquotedColon(input) {
  let quote = null;
  let escaped = false;
  let braceDepth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ':' && braceDepth === 0) return index;
  }
  return -1;
}

function formatHtml(input) {
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const lines = [];
  let depth = 0;
  let position = 0;

  while (position < input.length) {
    const token = readHtmlToken(input, position);
    if (!token) return input;
    position = token.end;

    const value = token.value.trim();
    if (!value) continue;

    const closing = /^<\//.test(value);
    const tagName = value.match(/^<\/?\s*([\w-]+)/)?.[1]?.toLowerCase();
    const selfClosing = /\/>$/.test(value) || value.startsWith('<!') || voidElements.has(tagName);

    if (closing) depth = Math.max(0, depth - 1);
    lines.push(`${'  '.repeat(depth)}${value}`);
    if (!closing && !selfClosing && /^</.test(value)) depth += 1;

    if (!closing && !selfClosing && isRawTextElement(tagName)) {
      const closingStart = findClosingTag(input, tagName, position);
      if (closingStart === -1) return input;
      const rawContent = input.slice(position, closingStart).trim();
      if (rawContent) lines.push(`${'  '.repeat(depth)}${rawContent}`);
      position = closingStart;
    }
  }

  return lines.join('\n');
}

function readHtmlToken(input, start) {
  if (input.startsWith('<!--', start)) {
    const end = input.indexOf('-->', start + 4);
    return end === -1 ? null : { value: input.slice(start, end + 3), end: end + 3 };
  }
  if (input.startsWith('<![CDATA[', start)) {
    const end = input.indexOf(']]>', start + 9);
    return end === -1 ? null : { value: input.slice(start, end + 3), end: end + 3 };
  }
  if (input[start] !== '<') {
    const end = input.indexOf('<', start);
    return { value: input.slice(start, end === -1 ? input.length : end), end: end === -1 ? input.length : end };
  }

  let quote = null;
  for (let index = start + 1; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return { value: input.slice(start, index + 1), end: index + 1 };
    }
  }
  return null;
}

function isRawTextElement(tagName) {
  return tagName === 'script' || tagName === 'style' || tagName === 'textarea';
}

function findClosingTag(input, tagName, start) {
  const match = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'i').exec(input.slice(start));
  return match ? start + match.index : -1;
}

export function compressPrompt(input) {
  // 压缩是格式化的逆操作：不做清理/裁剪，仅统一换行符后转义
  const normalized = (input || '').replace(/\r\n?/g, '\n');
  return JSON.stringify(normalized).slice(1, -1);
}
