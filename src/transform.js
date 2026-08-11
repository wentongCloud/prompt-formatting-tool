const CONTENT_PREFIX = /^\s*[,{]?\s*"content"\s*:\s*/;

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
  const decoded = /\\[nrt"\\]/.test(cleaned) ? decodeJsonString(cleaned) : cleaned;
  return formatStructuredContent(decoded);
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
