import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPromptInput, compressPrompt, detectInputType, estimateTokens, formatInput, formatPrompt, formatToon } from './transform.js';

test('estimates tokens from UTF-8 byte length', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('hello world'), 3);
  assert.equal(estimateTokens('你好'), 2);
  assert.equal(estimateTokens('😀'), 1);
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

test('pretty-prints HTML elements on separate indented lines', () => {
  const input = '<table><tr><td>Pos</td><td>Item</td></tr></table>';
  assert.equal(formatPrompt(input), [
    '<table>',
    '  <tr>',
    '    <td>',
    '      Pos',
    '    </td>',
    '    <td>',
    '      Item',
    '    </td>',
    '  </tr>',
    '</table>',
  ].join('\n'));
});

test('preserves greater-than signs in quoted HTML attributes', () => {
  assert.equal(formatPrompt('<div title="1 > 0">ok</div>'), [
    '<div title="1 > 0">',
    '  ok',
    '</div>',
  ].join('\n'));
});

test('preserves raw script content containing angle brackets', () => {
  assert.equal(formatPrompt('<script>if (a < b) alert("x")</script>'), [
    '<script>',
    '  if (a < b) alert("x")',
    '</script>',
  ].join('\n'));
});

test('pretty-prints structured Markdown code blocks', () => {
  assert.equal(formatPrompt('Example:\n```json\n{"ok":true}\n```'), 'Example:\n```json\n{\n\t"ok": true\n}\n```');
});

test('leaves invalid structured content unchanged', () => {
  assert.equal(formatPrompt('{not json}'), '{not json}');
  assert.equal(formatPrompt('<not closed'), '<not closed');
});
