const CONTENT_PREFIX = /^\s*[,{]?\s*"content"\s*:\s*/;

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
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
  const cleaned = cleanPromptInput(input);
  return JSON.stringify(cleaned).slice(1, -1);
}
