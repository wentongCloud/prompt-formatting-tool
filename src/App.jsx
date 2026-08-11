import React, { useRef, useState } from 'react';
import { Button, Input, Space, Tooltip, Typography, App as AntApp } from 'antd';
import {
  ThunderboltOutlined,
  FormatPainterOutlined,
  CompressOutlined,
  CopyOutlined,
  ClearOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { formatPrompt, compressPrompt, sanitizeInput } from './lib/prompt';
import './App.css';

SyntaxHighlighter.registerLanguage('markdown', markdown);

const { Text, Title } = Typography;

export default function App() {
  const { message } = AntApp.useApp();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [lastAction, setLastAction] = useState(''); // 'format' | 'compress'
  const [leftPct, setLeftPct] = useState(50); // 左栏宽度百分比
  const workspaceRef = useRef(null);

  /* ---------- 操作 ---------- */

  const requireInput = () => {
    if (!input.trim()) {
      message.warning('请先在左侧输入内容');
      return false;
    }
    return true;
  };

  const handleFormat = () => {
    if (!requireInput()) return;
    setOutput(formatPrompt(input));
    setLastAction('format');
  };

  const handleCompress = () => {
    if (!requireInput()) return;
    setOutput(compressPrompt(input));
    setLastAction('compress');
  };

  const handleCopy = async () => {
    if (!output) {
      message.warning('右侧暂无可复制内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
      message.success('已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选择复制');
    }
  };

  const handleClear = () => {
    setInput('');
    setOutput('');
    setLastAction('');
  };

  /* ---------- 输入区：粘贴时自动过滤 JSON 包装碎片 ---------- */

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain');
    const cleaned = sanitizeInput(pasted);
    const el = e.target;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = input.slice(0, start) + cleaned + input.slice(end);
    setInput(next);
    // 恢复光标位置到插入内容末尾
    requestAnimationFrame(() => {
      const pos = start + cleaned.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /* ---------- 中间拖拽区 ---------- */

  const startDrag = (e) => {
    e.preventDefault();
    const rect = workspaceRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* ---------- 渲染 ---------- */

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="topbar">
        <Space size={12} align="center">
          <ThunderboltOutlined style={{ color: '#1677ff', fontSize: 16 }} />
          <Title level={5} style={{ margin: 0 }}>
            Prompt 格式化工具
          </Title>
        </Space>

        <Space size={8}>
          <Tooltip title={'行文本 → Markdown（反转义 \\n \\" \\\\ 等）'}>
            <Button type="primary" icon={<FormatPainterOutlined />} onClick={handleFormat}>
              格式化
            </Button>
          </Tooltip>
          <Tooltip title="Markdown → 行文本（转义为 JSON 安全字符串）">
            <Button icon={<CompressOutlined />} onClick={handleCompress}>
              压缩
            </Button>
          </Tooltip>
          <Tooltip title="复制右侧输出">
            <Button icon={<CopyOutlined />} onClick={handleCopy}>
              复制
            </Button>
          </Tooltip>
          <Tooltip title="清空输入与输出">
            <Button danger icon={<ClearOutlined />} onClick={handleClear}>
              清空
            </Button>
          </Tooltip>
        </Space>

        <Text type="secondary" className="topbar-count">
          输入 {input.length} 字符 · 输出 {output.length} 字符
        </Text>
      </header>

      {/* 三栏工作区：height = 页面高度 - 顶栏 */}
      <div className="workspace" ref={workspaceRef}>
        {/* 左栏：输入 */}
        <section className="pane" style={{ width: `${leftPct}%` }}>
          <div className="pane-header">
            <Space size={6}>
              <FileTextOutlined />
              <Text strong>输入</Text>
            </Space>
            <Text type="secondary">自动过滤 "content": " / ", 等包装碎片</Text>
          </div>
          <Input.TextArea
            className="input-area"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={'粘贴 prompt 行文本，例如：\n{"role":"user","content":"Extract ...\\n\\n<input>\\n..."}'}
            autoSize={false}
            spellCheck={false}
          />
        </section>

        {/* 中间：拖拽区 */}
        <div className="divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" />

        {/* 右栏：输出 */}
        <section className="pane" style={{ width: `${100 - leftPct}%` }}>
          <div className="pane-header">
            <Space size={6}>
              <CodeOutlined />
              <Text strong>输出</Text>
            </Space>
            <Text type="secondary">
              {lastAction === 'format'
                ? 'Markdown 高亮 · 带行号'
                : lastAction === 'compress'
                  ? '压缩后的单行行文本'
                  : '等待操作'}
            </Text>
          </div>
          <div className="output-area">
            {output ? (
              <SyntaxHighlighter
                language={lastAction === 'compress' ? 'json' : 'markdown'}
                style={oneLight}
                showLineNumbers={lastAction !== 'compress'}
                lineNumberStyle={{ minWidth: '3em', opacity: 0.45 }}
                wrapLongLines={false}
                customStyle={{
                  margin: 0,
                  padding: 12,
                  background: '#fff',
                  fontSize: 12,
                  fontFamily:
                    "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
                  minHeight: '100%',
                }}
              >
                {output}
              </SyntaxHighlighter>
            ) : (
              <div className="output-empty">
                <Text type="secondary">格式化 / 压缩结果将显示在这里</Text>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
