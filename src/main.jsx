import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button, ConfigProvider, Select, Tooltip, Typography, message } from 'antd';
import { CheckOutlined, ClearOutlined, CompressOutlined, CopyOutlined, FormatPainterOutlined } from '@ant-design/icons';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { compressPrompt, detectInputType, estimateTokens, formatInput } from './transform.js';
import './styles.css';

const { Text } = Typography;
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markup', markup);

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildCopyHtml(text) {
  const lines = text.split('\n').map((line) => `<div>${escapeHtml(line) || '&nbsp;'}</div>`).join('');
  return `<pre style="margin:0;font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;line-height:1.65;">${lines}</pre>`;
}

// 异步剪贴板被拒时的降级：隐藏 textarea + execCommand（扩展页需 clipboardWrite 权限）
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

function countOutputCharsBefore(view, container, offset) {
  const prefix = document.createRange();
  prefix.setStart(view, 0);
  prefix.setEnd(container, offset);
  let count = 0;
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      count += node.nodeValue.length;
      return;
    }
    if (node.classList && node.classList.contains('react-syntax-highlighter-line-number')) return;
    node.childNodes.forEach(walk);
  };
  prefix.cloneContents().childNodes.forEach(walk);
  return count;
}

function App() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [leftPercent, setLeftPercent] = useState(50);
  const [copied, setCopied] = useState(false);
  const [inputType, setInputType] = useState('prompt');
  const [outputType, setOutputType] = useState('prompt');
  const [isTypeLocked, setIsTypeLocked] = useState(false);
  const workspaceRef = useRef(null);
  const codeViewRef = useRef(null);
  const dragging = useRef(false);
  // 拖拽调宽会高频重渲染，避免每次全量 TextEncoder.encode
  const tokenEstimate = useMemo(() => estimateTokens(input), [input]);

  useEffect(() => {
    const onMove = (event) => {
      if (!dragging.current || !workspaceRef.current) return;
      const bounds = workspaceRef.current.getBoundingClientRect();
      const percent = ((event.clientX - bounds.left) / bounds.width) * 100;
      setLeftPercent(Math.min(75, Math.max(25, percent)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.classList.remove('is-resizing');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const run = (transform, type) => {
    if (!input.trim()) {
      message.info('Please enter some content first');
      return;
    }
    setOutput(transform(input));
    setOutputType(type);
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      if (!fallbackCopy(output)) {
        message.error('Copy failed — please select the text and copy manually');
        return;
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const copySelectionFromOutput = (event) => {
    if (!output) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const view = codeViewRef.current;
    if (!view || !view.contains(range.commonAncestorContainer)) return;
    const start = countOutputCharsBefore(view, range.startContainer, range.startOffset);
    const end = countOutputCharsBefore(view, range.endContainer, range.endOffset);
    const text = output.slice(start, end);
    if (!text) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', buildCopyHtml(text));
  };

  const updateInput = (value) => {
    setInput(value);
    // 用户手动选择格式后锁定，不再被自动识别覆盖
    if (!isTypeLocked) setInputType(detectInputType(value));
  };

  const selectInputType = (type) => {
    setInputType(type);
    setIsTypeLocked(true);
  };

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1677ff', borderRadius: 6, fontSize: 13 }, components: { Button: { controlHeightSM: 28 }, Select: { controlHeightSM: 28 } } }}>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand"><span className="brand-mark">P</span><Text strong>Prompt Formatting Tool</Text></div>
          <div className="actions">
            <Select
              aria-label="Input format"
              size="small"
              value={inputType}
              onChange={selectInputType}
              options={[
                { value: 'prompt', label: 'Prompt' },
                { value: 'json', label: 'JSON' },
                { value: 'toon', label: 'TOON' },
                { value: 'html', label: 'HTML' },
              ]}
            />
            <Button size="small" icon={<FormatPainterOutlined />} type="primary" onClick={() => run((value) => formatInput(value, inputType), inputType)}>Format</Button>
            <Button size="small" icon={<CompressOutlined />} onClick={() => run(compressPrompt, 'prompt')}>Compress</Button>
          </div>
        </header>

        <section className="workspace" ref={workspaceRef}>
          <section className="pane input-pane" style={{ width: `calc(${leftPercent}% - 5px)` }}>
            <PaneHeader title="Input" meta={`~${tokenEstimate} tokens`}>
              <Tooltip title="Clear"><Button aria-label="Clear input" size="small" type="text" icon={<ClearOutlined />} onClick={() => { setInput(''); setOutput(''); setInputType('prompt'); setOutputType('prompt'); setIsTypeLocked(false); }} /></Tooltip>
            </PaneHeader>
            <textarea value={input} onChange={(event) => updateInput(event.target.value)} spellCheck={false} placeholder={'Paste Prompt, JSON, TOON, or HTML…\n\nInput format is detected automatically.'} />
          </section>

          <div className="resizer" role="separator" aria-orientation="vertical" aria-label="Adjust panel width" onMouseDown={() => { dragging.current = true; document.body.classList.add('is-resizing'); }}><span /></div>

          <section className="pane output-pane" style={{ width: `calc(${100 - leftPercent}% - 5px)` }}>
            <PaneHeader title="Output" meta={`${output.length} chars`}>
              <Tooltip title={copied ? 'Copied' : 'Copy'}><Button aria-label="Copy output" disabled={!output} size="small" type="text" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copyOutput} /></Tooltip>
            </PaneHeader>
            <div className="code-view" ref={codeViewRef} onCopy={copySelectionFromOutput} onCut={copySelectionFromOutput}>
              {output ? <SyntaxHighlighter language={outputType === 'json' ? 'json' : outputType === 'html' ? 'markup' : 'markdown'} style={oneLight} showLineNumbers wrapLongLines customStyle={{ margin: 0, minHeight: '100%', background: '#fff', fontSize: 13, lineHeight: 1.65, padding: '16px 12px' }} lineNumberStyle={{ minWidth: '2.8em', color: '#b6bcc6', paddingRight: '14px', userSelect: 'none' }}>{output}</SyntaxHighlighter> : <div className="empty-state">Formatted result will appear here</div>}
            </div>
          </section>
        </section>
      </main>
    </ConfigProvider>
  );
}

function PaneHeader({ title, meta, children }) {
  return <div className="pane-header"><div><Text strong>{title}</Text><Text type="secondary" className="meta">{meta}</Text></div>{children}</div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
