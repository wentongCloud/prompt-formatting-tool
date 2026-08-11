import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPromptInput, compressPrompt, formatPrompt } from './transform.js';

test('formats escaped line text', () => {
  assert.equal(formatPrompt('Hello\\n\\n## Fields\\n- name: \\"value\\"'), 'Hello\n\n## Fields\n- name: "value"');
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
