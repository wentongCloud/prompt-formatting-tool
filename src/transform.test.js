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

test('format and compress round-trip', () => {
  const markdown = '# Title\n\n```json\n{"path":"C:\\\\tmp"}\n```';
  assert.equal(formatPrompt(compressPrompt(markdown)), markdown);
});

test('preserves edge whitespace in plain prompts', () => {
  assert.equal(formatPrompt('  prompt  '), '  prompt  ');
  assert.equal(compressPrompt('  prompt  '), '  prompt  ');
});
