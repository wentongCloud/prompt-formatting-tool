// HTML 格式化层：prettier 式建树重排 + HTML 空白折叠，自包含无内部依赖。

const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// 块级/表格类元素：作为后代出现时强制父元素展开（对齐 prettier 的 css 空白敏感性）
const HTML_BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'ul']);
const HTML_PRINT_WIDTH = 80;

// prettier 式 HTML 格式化：先建树，无块级后代且单行放得下的元素收拢为一行
// （如 <td>Pos</td>），其余按块级边界展开缩进；建树失败原样返回
export function formatHtml(input) {
  const root = parseHtmlTree(input);
  if (!root) return input;
  const lines = root.children.map((node) => printHtmlNode(node, 0)).filter(Boolean);
  return lines.length ? lines.join('\n') : input;
}

// 将 HTML 解析为节点树；标签不配对（未闭合/多余闭合）视为畸形返回 null
function parseHtmlTree(input) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let position = 0;
  while (position < input.length) {
    const token = readHtmlToken(input, position);
    if (!token) return null;
    position = token.end;
    const value = token.value;
    if (!value.trim()) {
      top().children.push({ type: 'text', value });
      continue;
    }
    if (value.startsWith('<!--') || value.startsWith('<![CDATA[')) {
      top().children.push({ type: 'leaf', value: value.trim() });
      continue;
    }
    if (value.startsWith('</')) {
      const tagName = value.match(/^<\/\s*([\w-]+)/)?.[1]?.toLowerCase();
      let openIndex = -1;
      for (let i = stack.length - 1; i >= 1; i -= 1) {
        if (stack[i].tag === tagName) { openIndex = i; break; }
      }
      if (openIndex === -1) return null;
      stack.length = openIndex;
      continue;
    }
    if (value.startsWith('<')) {
      const tagName = value.match(/^<\s*([\w-]+)/)?.[1]?.toLowerCase();
      const node = { type: 'element', tag: tagName, openTag: value.trim(), children: [] };
      if (/\/>$/.test(value) || value.startsWith('<!') || HTML_VOID.has(tagName)) {
        node.selfClosing = true;
        top().children.push(node);
      } else if (isRawTextElement(tagName)) {
        const closing = findClosingTag(input, tagName, position);
        if (!closing) return null;
        node.rawText = input.slice(position, closing.start);
        node.preserveWhitespace = tagName === 'pre';
        position = closing.end;
        top().children.push(node);
      } else {
        top().children.push(node);
        stack.push(node);
      }
      continue;
    }
    top().children.push({ type: 'text', value });
  }
  return stack.length === 1 ? root : null;
}

function printHtmlNode(node, depth) {
  const pad = '  '.repeat(depth);
  if (node.type === 'text') {
    const text = collapseHtmlWhitespace(node.value).trim();
    return text ? `${pad}${text}` : '';
  }
  if (node.type === 'leaf') return `${pad}${node.value}`;
  if (node.selfClosing) return `${pad}${node.openTag}`;
  if (node.rawText !== undefined) {
    // 空白敏感元素（pre）：内容原样保留，不折叠不修剪
    if (node.preserveWhitespace) return `${pad}${node.openTag}${node.rawText}</${node.tag}>`;
    const lines = [`${pad}${node.openTag}`];
    const content = node.rawText.trim();
    if (content) lines.push(`${'  '.repeat(depth + 1)}${content}`);
    lines.push(`${pad}</${node.tag}>`);
    return lines.join('\n');
  }
  // 无块级后代且放得下：收拢单行（prettier 的标志性行为）
  if (!hasBlockDescendant(node)) {
    const flat = flattenHtmlNode(node);
    if (pad.length + flat.length <= HTML_PRINT_WIDTH) return `${pad}${flat}`;
  }
  const lines = [`${pad}${node.openTag}`];
  for (const child of node.children) {
    const printed = printHtmlNode(child, depth + 1);
    if (printed) lines.push(printed);
  }
  lines.push(`${pad}</${node.tag}>`);
  return lines.join('\n');
}

// 收拢为单行：文本空白折叠为单空格以保留内联间距，首尾去除
function flattenHtmlNode(node) {
  if (node.selfClosing) return node.openTag;
  if (node.rawText !== undefined) {
    const raw = node.preserveWhitespace ? node.rawText : node.rawText.trim();
    return `${node.openTag}${raw}</${node.tag}>`;
  }
  const inner = collapseHtmlWhitespace(node.children.map((child) => {
    if (child.type === 'text') return collapseHtmlWhitespace(child.value);
    if (child.type === 'leaf') return child.value;
    return flattenHtmlNode(child);
  }).join('')).trim();
  return `${node.openTag}${inner}</${node.tag}>`;
}

function hasBlockDescendant(node) {
  return node.children.some((child) => child.type === 'element'
    && (HTML_BLOCK.has(child.tag) || child.rawText !== undefined || hasBlockDescendant(child)));
}

function collapseHtmlWhitespace(text) {
  return text.replace(/\s+/g, ' ');
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
  return tagName === 'script' || tagName === 'style' || tagName === 'textarea' || tagName === 'pre';
}

function findClosingTag(input, tagName, start) {
  const match = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'i').exec(input.slice(start));
  return match ? { start: start + match.index, end: start + match.index + match[0].length } : null;
}

// HTML 标签间空白无语义，所有空白跑（含换行）整体折为单空格并去首尾
export function collapseAllWhitespace(text) {
  return collapseHtmlWhitespace(text).trim();
}
