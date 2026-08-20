import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPromptInput, compressPrompt, detectInputType, estimateTokens, formatInput, formatPrompt, formatToon } from './transform.js';

test('estimates tokens from UTF-8 byte length', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('hello world'), 3);
  assert.equal(estimateTokens('你好'), 2);
  assert.equal(estimateTokens('😀'), 1);
  // CJK 单独计权：2 个中文字 + 5 字节 ASCII ≈ 2 + 1.25 → 4
  assert.equal(estimateTokens('你好world'), 4);
});

test('detects Prompt, JSON, TOON, and HTML input', () => {
  assert.equal(detectInputType('Write a concise summary'), 'prompt');
  assert.equal(detectInputType('{"ok":true}'), 'json');
  assert.equal(detectInputType('rows[1]{r,cells}: 26,{0:"1"}'), 'toon');
  assert.equal(detectInputType('<section>Hello</section>'), 'html');
  assert.equal(detectInputType('123'), 'prompt');
  assert.equal(detectInputType('true'), 'prompt');
  assert.equal(detectInputType('null'), 'prompt');
});

test('formats TOON rows with one cell per indented line', () => {
  const input = 'rows[1]{r,cells}: 26,{0:"1",0:null,0:null,1:"SIPART PS2 i/p Positioner",0:null,0:null,5:"SET",4:"1",0:null,0:null,0:null,0:null,6:"SIPART PS2 i/p Positioner"}';
  assert.equal(formatToon(input), [
    'rows[1]{r,cells}:',
    '  26,{',
    '    0:"1",',
    '    0:null,',
    '    0:null,',
    '    1:"SIPART PS2 i/p Positioner",',
    '    0:null,',
    '    0:null,',
    '    5:"SET",',
    '    4:"1",',
    '    0:null,',
    '    0:null,',
    '    0:null,',
    '    0:null,',
    '    6:"SIPART PS2 i/p Positioner"',
    '  }',
  ].join('\n'));
  assert.equal(formatInput(input), formatToon(input));
});

test('governs TOON string values without changing cell order or coordinates', () => {
  const input = 'rows[1]{r,cells}: 26,{0:"  ACME\t\t pump  ",1:"say \\"hi\\" at C:\\\\tmp\nnext\rline\u0007",2:"“保留  业务”"}';
  assert.equal(formatToon(input), [
    'rows[1]{r,cells}:',
    '  26,{',
    '    0:"ACME pump",',
    '    1:"say \\"hi\\" at C:\\\\tmp\\nnext\\rline\\u0007",',
    '    2:"保留 业务"',
    '  }',
  ].join('\n'));
});

test('preserves spaces inside unquoted TOON business values', () => {
  assert.equal(formatToon('rows[1]{r,cells}: 26,{1:SIPART PS2 i/p Positioner}'), [
    'rows[1]{r,cells}:',
    '  26,{',
    '    1:SIPART PS2 i/p Positioner',
    '  }',
  ].join('\n'));
});

test('preserves smart apostrophes in unquoted TOON values', () => {
  assert.match(formatToon('rows[1]{r,cells}: 26,{1:It’s a pump}'), /1:It’s a pump/);
});

test('finds the TOON header separator after a colon in the field declaration', () => {
  assert.equal(formatToon('rows[1]{a:b}: 26,{1:"value"}'), [
    'rows[1]{a:b}:',
    '  26,{',
    '    1:"value"',
    '  }',
  ].join('\n'));
});

test('formats uniformly escaped TOON by decoding the outer layer first', () => {
  const escaped = 'rows[1]{r,cells}:\\n  11,{\\n    0:\\"AA\\",\\n    1:\\"H2S Sensor\\"\\n  }';
  assert.equal(detectInputType(escaped), 'toon');
  assert.equal(formatToon(escaped), [
    'rows[1]{r,cells}:',
    '  11,{',
    '    0:"AA",',
    '    1:"H2S Sensor"',
    '  }',
  ].join('\n'));
});

test('formats concatenated TOON documents independently', () => {
  const input = 'rows[1]{r,cells}: 11,{0:"AA"}\n\nrows[2]{r,cells}: 12,{0:"BB"}';
  assert.equal(formatToon(input), [
    'rows[1]{r,cells}:',
    '  11,{',
    '    0:"AA"',
    '  }',
    '',
    'rows[2]{r,cells}:',
    '  12,{',
    '    0:"BB"',
    '  }',
  ].join('\n'));
});

test('round-trips TOON through compress and format without corrupting value escapes', () => {
  // 值内含字面 \n 转义：剥层不得使用 fold 语义，否则往返后变成真实换行
  const toon = formatToon(String.raw`rows[1]{r,cells}: 1,{0:"a\\nb",1:"line1\nline2"}`);
  const compressed = compressPrompt(toon);
  assert.equal(formatToon(compressed), toon);
  assert.equal(compressPrompt(compressed), compressed);
});

test('formats escaped line text', () => {
  assert.equal(formatPrompt('Hello\\n\\n## Fields\\n- name: \\"value\\"'), 'Hello\n\n## Fields\n- name: "value"');
});

test('tolerates line breaks escaped through multiple layers', () => {
  assert.equal(formatPrompt(String.raw`Hello\\nworld`), 'Hello\nworld');
  assert.equal(formatPrompt(String.raw`Hello\\\nworld`), 'Hello\nworld');
  assert.equal(formatPrompt(String.raw`Hello\\\\nworld`), 'Hello\nworld');
});

test('removes a content wrapper', () => {
  assert.equal(formatPrompt('"content": "Hello\\nworld",'), 'Hello\nworld');
  assert.equal(cleanPromptInput('{"content":"Hello\\nworld"}'), 'Hello\nworld');
});

test('compresses text into a JSON-safe string body', () => {
  assert.equal(compressPrompt('A\n"B" \\ C'), 'A\\n\\"B\\" \\\\ C');
});

test('escapes literal backslash sequences instead of decoding them', () => {
  // 字面 \t 常见于 Windows 路径/正则，不得解码为 Tab 后被折叠丢失
  assert.equal(compressPrompt('C:\\tmp'), 'C:\\\\tmp');
  assert.equal(compressPrompt('C:\\temp'), 'C:\\\\temp');
});

test('never re-escapes existing escape sequences when compressing (gate)', () => {
  for (const escaped of ['a\\\\b', 'a\\bb', 'a\\fb', 'a\\u0000b', 'a\\\\"b', 'a\\nb', 'a\\rb', 'a\\"b']) {
    assert.equal(compressPrompt(escaped), escaped, escaped);
    assert.equal(compressPrompt(compressPrompt(escaped)), escaped, escaped);
  }
});

test('escapes a lone real tab instead of folding it into a space', () => {
  assert.equal(compressPrompt('a\tb'), 'a\\tb');
});

test('applies formatting-side denoising when compressing', () => {
  assert.equal(compressPrompt('"content": "Hello\\nworld"'), 'Hello\\nworld');
  assert.equal(compressPrompt('"hello"'), 'hello');
});

test('collapses consecutive spaces and tabs when formatting plain prompts', () => {
  assert.equal(formatPrompt('a   b\t\tc'), 'a b c');
  assert.equal(formatPrompt('line1\\na    b'), 'line1\na b');
  // 行首缩进与行内折叠互不影响，行尾空白保留（Markdown 硬换行）
  assert.equal(formatPrompt('a\n    b    c  '), 'a\n    b c  ');
});

test('compresses JSON documents to a single escaped line without indentation', () => {
  const pretty = '{\n\t"a": 1,\n\t"b": [\n\t\t2\n\t]\n}';
  const compressed = compressPrompt(pretty);
  // 压缩产物是恰好一层转义的紧凑 JSON 文档
  assert.equal(compressed, '{\\"a\\":1,\\"b\\":[2]}');
  assert.equal(compressed.includes('\t'), false);
  // 压缩与格式化互逆：再格式化应还原为同一缩进形态
  assert.equal(formatPrompt(compressed), pretty);
});

test('compresses JSON documents idempotently without stacking escape layers', () => {
  const pretty = '{\n\t"a": 1\n}';
  const once = compressPrompt(pretty);
  assert.equal(compressPrompt(once), once);
});

test('keeps value escapes intact through compress-format round trips', () => {
  const pretty = JSON.stringify({ note: 'line1\nline2', path: 'C:\\tmp' }, null, '\t');
  const compressed = compressPrompt(pretty);
  // 值内转义被均匀转义一层，再格式化时完整还原，不叠加、不丢失
  assert.equal(
    compressed,
    '{\\"note\\":\\"line1\\\\nline2\\",\\"path\\":\\"C:\\\\\\\\tmp\\"}',
  );
  assert.equal(formatPrompt(compressed), pretty);
});

test('format decodes compressed prompts and formats their JSON blocks', () => {
  const markdown = '# Title\n\n```json\n{"path":"C:\\\\tmp"}\n```';
  assert.equal(formatPrompt(compressPrompt(markdown)), '# Title\n\n```json\n{\n\t"path": "C:\\\\tmp"\n}\n```');
});

test('preserves edge whitespace in plain prompts', () => {
  assert.equal(formatPrompt('  prompt  '), '  prompt  ');
  assert.equal(compressPrompt('  prompt  '), '  prompt  ');
});

test('pretty-prints an escaped JSON prompt with tabs', () => {
  const input = String.raw`{\"documentID\":{\"value\":\"SHOR26ME022-Q01\",\"readIdx\":\"12.9\"},\"serialNo\":{\"value\":null,\"readIdx\":null}}`;
  assert.equal(formatPrompt(input), [
    '{',
    '\t"documentID": {',
    '\t\t"value": "SHOR26ME022-Q01",',
    '\t\t"readIdx": "12.9"',
    '\t},',
    '\t"serialNo": {',
    '\t\t"value": null,',
    '\t\t"readIdx": null',
    '\t}',
    '}',
  ].join('\n'));
});

test('pretty-prints a complete JSON request without decoding string values first', () => {
  const input = '{"messages":[{"role":"user","content":[{"type":"text","text":"First line\\n\\nSecond line"}]}],"stream":false,"temperature":0}';
  assert.equal(formatPrompt(input), [
    '{',
    '\t"messages": [',
    '\t\t{',
    '\t\t\t"role": "user",',
    '\t\t\t"content": [',
    '\t\t\t\t{',
    '\t\t\t\t\t"type": "text",',
    '\t\t\t\t\t"text": "First line\\n\\nSecond line"',
    '\t\t\t\t}',
    '\t\t\t]',
    '\t\t}',
    '\t],',
    '\t"stream": false,',
    '\t"temperature": 0',
    '}',
  ].join('\n'));
});

test('detects and pretty-prints JSON whose structure is escaped', () => {
  const input = String.raw`{\n    \"lineItems\": [\n        {\n            \"pageNum\": 3,\n            \"quantity\": null\n        }\n    ]\n}`;
  assert.equal(detectInputType(input), 'json');
  assert.equal(formatInput(input), [
    '{',
    '\t"lineItems": [',
    '\t\t{',
    '\t\t\t"pageNum": 3,',
    '\t\t\t"quantity": null',
    '\t\t}',
    '\t]',
    '}',
  ].join('\n'));
});

test('decodes stacked escaping layers to the same JSON document', () => {
  const single = String.raw`{\n\"a\": 1\n}`;
  const doubled = single.replace(/\\/g, '\\\\');
  assert.equal(detectInputType(doubled), 'json');
  assert.equal(formatInput(doubled), formatInput(single));
});

test('unwraps a quoted JSON string literal when formatting JSON', () => {
  const inner = String.raw`{\n\"a\": 1\n}`;
  assert.equal(formatInput(JSON.stringify(inner), 'json'), formatInput(inner, 'json'));
});

test('detects quoted and multiply-wrapped JSON literals', () => {
  const inner = String.raw`{\n\"a\": 1\n}`;
  const wrapped = JSON.stringify(inner);
  assert.equal(detectInputType(wrapped), 'json');
  assert.equal(detectInputType(JSON.stringify(wrapped)), 'json');
  assert.equal(formatInput(JSON.stringify(wrapped)), formatInput(inner));
});

test('strips an unescaped outer quote wrapper before parsing JSON', () => {
  const input = '"{"role":"user","content":"line1\\nline2"}"';
  assert.equal(detectInputType(input), 'json');
  assert.equal(formatInput(input), '{\n\t"role": "user",\n\t"content": "line1\\nline2"\n}');
});

test('does not flag plain quoted sentences as JSON', () => {
  assert.equal(detectInputType('"Just a sentence"'), 'prompt');
  assert.equal(detectInputType('{incomplete'), 'prompt');
});

test('preserves backslash and unicode escapes while decoding escaped JSON', () => {
  const input = String.raw`{\n\"path\": \"C:\\\\tmp\",\n\"label\": \"\\u4e2d\\/x\"\n}`;
  assert.equal(detectInputType(input), 'json');
  assert.equal(formatInput(input), '{\n\t"path": "C:\\\\tmp",\n\t"label": "中/x"\n}');
});

test('repairs malformed JSON with unquoted keys and trailing comma', () => {
  const input = '{name: "John", age: 30,}';
  assert.equal(detectInputType(input), 'json');
  assert.equal(formatInput(input), '{\n\t"name": "John",\n\t"age": 30\n}');
});

test('repairs JSON with comments and single quotes', () => {
  const input = "{'a': 1, // note\n'b': 2}";
  assert.equal(detectInputType(input), 'json');
  assert.equal(formatInput(input), '{\n\t"a": 1,\n\t"b": 2\n}');
});

test('repairs truncated JSON by closing open brackets', () => {
  assert.equal(formatInput('{"a": 1, "b": [1, 2'), '{\n\t"a": 1,\n\t"b": [\n\t\t1,\n\t\t2\n\t]\n}');
});

test('repairs escaped malformed JSON after peeling the escape layer', () => {
  const input = String.raw`{\"name\": \"John\",}`;
  assert.equal(detectInputType(input), 'json');
  assert.equal(formatInput(input), '{\n\t"name": "John"\n}');
});

test('does not misclassify prose or Markdown as repairable JSON', () => {
  assert.equal(detectInputType('# Title\n\nsome text'), 'prompt');
  assert.equal(detectInputType('[1] First\n[2] Second'), 'prompt');
  assert.equal(detectInputType('{incomplete'), 'prompt');
});

test('collapses simple table cells onto single lines while indenting structure', () => {
  const input = '<table><tr><td>Pos</td><td>Item</td></tr></table>';
  assert.equal(formatPrompt(input), [
    '<table>',
    '  <tr>',
    '    <td>Pos</td>',
    '    <td>Item</td>',
    '  </tr>',
    '</table>',
  ].join('\n'));
});

test('preserves greater-than signs in quoted attributes while collapsing to one line', () => {
  assert.equal(formatPrompt('<div title="1 > 0">ok</div>'), '<div title="1 > 0">ok</div>');
});

test('preserves raw script content containing angle brackets', () => {
  assert.equal(formatPrompt('<script>if (a < b) alert("x")</script>'), [
    '<script>',
    '  if (a < b) alert("x")',
    '</script>',
  ].join('\n'));
});

test('preserves inline spacing when collapsing whitespace-sensitive content', () => {
  assert.equal(formatPrompt('<p>Hello <b>world</b> and <a href="#">link</a></p>'), '<p>Hello <b>world</b> and <a href="#">link</a></p>');
});

test('expands block-level nesting while collapsing inline-only branches', () => {
  assert.equal(formatPrompt('<div><p>one</p><p>two</p></div>'), [
    '<div>',
    '  <p>one</p>',
    '  <p>two</p>',
    '</div>',
  ].join('\n'));
});

test('formats HTML idempotently', () => {
  const input = '<div><p>hi</p><span>x</span></div>';
  assert.equal(formatPrompt(formatPrompt(input)), formatPrompt(input));
});

test('preserves whitespace-sensitive content inside pre elements', () => {
  const input = '<pre>line1\n  line2\nline3</pre>';
  assert.equal(formatPrompt(input), input);
  assert.equal(
    formatPrompt('<div><pre>a   b\nc</pre><p>x</p></div>'),
    '<div>\n  <pre>a   b\nc</pre>\n  <p>x</p>\n</div>',
  );
});

test('strips an unescaped outer quote wrapper when the type is locked to prompt', () => {
  assert.equal(formatInput('"{"a":1}"', 'prompt'), formatInput('{"a":1}'));
});

test('expands a single element when its collapsed form exceeds the print width', () => {
  const cls = 'x'.repeat(90);
  assert.equal(formatPrompt(`<p class="${cls}">text</p>`), [`<p class="${cls}">`, '  text', '</p>'].join('\n'));
});

test('pretty-prints structured Markdown code blocks', () => {
  assert.equal(formatPrompt('Example:\n```json\n{"ok":true}\n```'), 'Example:\n```json\n{\n\t"ok": true\n}\n```');
});

test('compresses already-escaped text without stacking a second escape layer', () => {
  const escaped = 'Hello\\nworld \\"q\\"';
  assert.equal(compressPrompt(escaped), escaped);
  assert.equal(compressPrompt(compressPrompt(escaped)), escaped);
});

test('collapses consecutive spaces and tabs into single spaces when compressing', () => {
  assert.equal(compressPrompt('a    b\t\tc'), 'a b c');
});

test('converts HTML line break tags to escaped newlines when compressing', () => {
  assert.equal(compressPrompt('line1<br>line2'), 'line1\\nline2');
  assert.equal(compressPrompt('a<br/>b<BR />c'), 'a\\nb\\nc');
});

test('removes full-width quotes when compressing', () => {
  assert.equal(compressPrompt('say ＂hello＂ ok'), 'say hello ok');
});

test('keeps compress idempotent after normalizing line break tags', () => {
  const once = compressPrompt('line1<br>line2');
  assert.equal(compressPrompt(once), once);
});

test('compresses formatted HTML and TOON without keeping indentation escapes', () => {
  const html = formatInput('<div><p>hi</p></div>');
  assert.equal(compressPrompt(html).includes('\\n  '), false);
  const toon = formatToon('rows[1]{r,cells}: 26,{0:"SIPART  PS2"}');
  assert.equal(compressPrompt(toon), 'rows[1]{r,cells}:\\n26,{\\n0:\\"SIPART PS2\\"\\n}');
});

test('decodes full JSON escape table in TOON values', () => {
  assert.equal(formatToon('rows[1]{r,cells}: 26,{0:"a\\bb\\fc\\/d"}'), [
    'rows[1]{r,cells}:',
    '  26,{',
    '    0:"a\\bb\\fc/d"',
    '  }',
  ].join('\n'));
});

test('unwraps uniformly escaped JSON with backslash-quote adjacencies intact', () => {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const source = String.raw`{"a":"x\"y","b":"C:\\tmp","c":"C:\\"}`;
  const formatted = formatInput(esc(source), 'json');
  const expected = JSON.stringify(JSON.parse(source), null, '\t');
  assert.equal(formatted, expected);
});

test('formats fenced JSON blocks in raw markdown without stripping value escapes', () => {
  const markdown = '# Title\n\n```json\n{"path":"C:\\\\tmp"}\n```';
  assert.equal(formatPrompt(markdown), '# Title\n\n```json\n{\n\t"path": "C:\\\\tmp"\n}\n```');
});

test('formats single-line fenced JSON blocks without a line break after the language tag', () => {
  assert.equal(formatPrompt('Note: ```json {"ok":true}``` end'), 'Note: ```json\n{\n\t"ok": true\n}\n``` end');
});

test('leaves invalid structured content unchanged', () => {
  assert.equal(formatPrompt('{not json}'), '{not json}');
  assert.equal(formatPrompt('<not closed'), '<not closed');
});
