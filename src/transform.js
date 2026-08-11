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
  if (!/\\[nrt"\\]/.test(cleaned)) return cleaned;
  return decodeJsonString(cleaned);
}

export function compressPrompt(input) {
  // 压缩是格式化的逆操作：不做清理/裁剪，仅统一换行符后转义
  const normalized = (input || '').replace(/\r\n?/g, '\n');
  return JSON.stringify(normalized).slice(1, -1);
}
