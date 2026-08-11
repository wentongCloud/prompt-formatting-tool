import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button, ConfigProvider, Tooltip, Typography, message } from 'antd';
import { CheckOutlined, ClearOutlined, CompressOutlined, CopyOutlined, FormatPainterOutlined } from '@ant-design/icons';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { compressPrompt, formatPrompt } from './transform.js';
import './styles.css';

const { Text } = Typography;
SyntaxHighlighter.registerLanguage('markdown', markdown);

function App() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [leftPercent, setLeftPercent] = useState(50);
  const [copied, setCopied] = useState(false);
  const workspaceRef = useRef(null);
  const dragging = useRef(false);

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

  const run = (transform) => {
    if (!input.trim()) {
      message.info('请先输入 Prompt 内容');
      return;
    }
    setOutput(transform(input));
  };

  const copyOutput = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1677ff', borderRadius: 6, fontSize: 13 }, components: { Button: { controlHeightSM: 28 } } }}>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand"><span className="brand-mark">P</span><Text strong>Prompt 格式化工具</Text></div>
          <div className="actions">
            <Button size="small" icon={<FormatPainterOutlined />} type="primary" onClick={() => run(formatPrompt)}>格式化</Button>
            <Button size="small" icon={<CompressOutlined />} onClick={() => run(compressPrompt)}>压缩</Button>
          </div>
        </header>

        <section className="workspace" ref={workspaceRef}>
          <section className="pane input-pane" style={{ width: `calc(${leftPercent}% - 5px)` }}>
            <PaneHeader title="输入" meta={`${input.length} 字符`}>
              <Tooltip title="清空"><Button aria-label="清空输入" size="small" type="text" icon={<ClearOutlined />} onClick={() => { setInput(''); setOutput(''); }} /></Tooltip>
            </PaneHeader>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} placeholder={'粘贴 Prompt 或 JSON content 字段…\n\n支持自动移除 "content": " 与末尾包装。'} />
          </section>

          <div className="resizer" role="separator" aria-orientation="vertical" aria-label="调整面板宽度" onMouseDown={() => { dragging.current = true; document.body.classList.add('is-resizing'); }}><span /></div>

          <section className="pane output-pane" style={{ width: `calc(${100 - leftPercent}% - 5px)` }}>
            <PaneHeader title="输出" meta={`${output.length} 字符`}>
              <Tooltip title={copied ? '已复制' : '复制'}><Button aria-label="复制输出" disabled={!output} size="small" type="text" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copyOutput} /></Tooltip>
            </PaneHeader>
            <div className="code-view">
              {output ? <SyntaxHighlighter language="markdown" style={oneLight} showLineNumbers wrapLongLines customStyle={{ margin: 0, minHeight: '100%', background: '#fff', fontSize: 13, lineHeight: 1.65, padding: '16px 12px' }} lineNumberStyle={{ minWidth: '2.8em', color: '#b6bcc6', paddingRight: '14px', userSelect: 'none' }}>{output}</SyntaxHighlighter> : <div className="empty-state">格式化结果将在这里显示</div>}
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
