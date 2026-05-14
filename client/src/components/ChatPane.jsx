import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  Headphones,
  Image,
  Info,
  Loader2,
  Menu,
  Mic,
  MessageSquarePlus,
  Monitor,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Volume2,
  Wifi,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  CONNECTION_STATUS,
  EDIT_MESSAGE_TEXTAREA_MAX_HEIGHT,
  PERMISSION_OPTIONS,
  REASONING_OPTIONS,
  VOICE_MAX_RECORDING_MS,
  VOICE_MAX_UPLOAD_BYTES,
  VOICE_MIME_CANDIDATES,
  compactPath,
  copyTextToClipboard,
  formatBytes,
  formatTime,
  imageUrlWithRetry,
  isDraftSession,
  isVisibleActivityStep,
  permissionLabel,
  reasoningLabel,
  shortModelName,
  voiceDialogStatusLabel
} from '../app-helpers.js';

export function ActivityMessage({ message }) {
  const running = message.status === 'running' || message.status === 'queued';
  const failed = message.status === 'failed';
  const activities = message.activities || [];
  const visibleSteps = activities.filter((activity) => isVisibleActivityStep(activity, message.status)).slice(-4);
  const headline = running ? '正在思考中' : message.label || message.content || '正在处理';

  return (
    <div className="message-row is-activity">
      <div className={`message-bubble activity-bubble ${failed ? 'is-failed' : ''}`}>
        <div className="activity-summary" role="status" aria-live="polite">
          {running ? <Loader2 className="spin" size={15} /> : failed ? <X size={15} /> : <Check size={15} />}
          <span>{headline}</span>
        </div>
        {visibleSteps.length ? (
          <div className="activity-steps" aria-label="任务进度">
            {visibleSteps.map((activity) => (
              <div key={activity.id} className={`activity-step is-${activity.status || 'running'}`}>
                <span className="activity-step-dot" />
                <span>{activity.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
      </div>
    </div>
  );
}

export function GeneratedImage({ part, onPreviewImage }) {
  const [loadState, setLoadState] = useState('loading');
  const [retryKey, setRetryKey] = useState(0);
  const src = imageUrlWithRetry(part.url, retryKey);

  function retry(event) {
    event.stopPropagation();
    setLoadState('loading');
    setRetryKey(Date.now());
  }

  return (
    <button
      type="button"
      className={`message-image-link ${loadState === 'failed' ? 'is-failed' : ''}`}
      onClick={() => (loadState === 'failed' ? setRetryKey(Date.now()) : onPreviewImage(part))}
      aria-label="预览图片"
    >
      <img
        className="message-image"
        src={src}
        alt={part.alt}
        loading="eager"
        decoding="async"
        onLoad={() => setLoadState('loaded')}
        onError={() => setLoadState('failed')}
      />
      {loadState === 'failed' ? (
        <span className="image-error">
          图片加载失败
          <span onClick={retry}>重试</span>
        </span>
      ) : null}
    </button>
  );
}


export function MessageContent({ content, onPreviewImage }) {
  const text = String(content || '');
  const parts = [];
  const pattern = /!\[([^\]]*)\]\((\/generated\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'image', alt: match[1] || '生成图片', url: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  if (!parts.length) {
    return <div className="message-content">{renderInlineText(text, 'message-root')}</div>;
  }

  const rendered = [];
  parts.forEach((part, index) => {
    if (part.type === 'image') {
      rendered.push(<GeneratedImage key={`${part.url}-${index}`} part={part} onPreviewImage={onPreviewImage} />);
      return;
    }
    rendered.push(...renderMarkdownBlocks(part.value, `message-${index}`));
  });

  return (
    <div className="message-content">
      {rendered}
    </div>
  );
}

export function renderMarkdownBlocks(text, keyPrefix) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const nodes = [];
  let index = 0;
  let paragraph = [];

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }
    const value = paragraph.join('\n');
    nodes.push(
      <p key={`${keyPrefix}-p-${nodes.length}`}>
        {renderInlineMarkdown(value, `${keyPrefix}-p-${nodes.length}`)}
      </p>
    );
    paragraph = [];
  }

  while (index < lines.length) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      flushParagraph();
      const language = line.replace(/^\s*```\s*/, '').trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      nodes.push(
        <pre key={`${keyPrefix}-code-${nodes.length}`} className={language ? `language-${language}` : undefined}>
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(headingMatch[1].length, 3);
      const Tag = `h${level + 2}`;
      nodes.push(
        <Tag key={`${keyPrefix}-heading-${nodes.length}`}>
          {renderInlineMarkdown(headingMatch[2].trim(), `${keyPrefix}-heading-${nodes.length}`)}
        </Tag>
      );
      index += 1;
      continue;
    }

    const listMatch = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (index < lines.length) {
        const itemMatch = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(lines[index]);
        if (!itemMatch || /^\s*\d+[.)]\s+/.test(lines[index]) !== ordered) {
          break;
        }
        items.push(itemMatch[1]);
        index += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      nodes.push(
        <ListTag key={`${keyPrefix}-list-${nodes.length}`}>
          {items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-li-${nodes.length}-${itemIndex}`}>
              {renderInlineMarkdown(item, `${keyPrefix}-li-${nodes.length}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      const quoteLines = [];
      while (index < lines.length) {
        const currentQuote = /^>\s?(.*)$/.exec(lines[index]);
        if (!currentQuote) {
          break;
        }
        quoteLines.push(currentQuote[1]);
        index += 1;
      }
      nodes.push(
        <blockquote key={`${keyPrefix}-quote-${nodes.length}`}>
          {renderMarkdownBlocks(quoteLines.join('\n'), `${keyPrefix}-quote-${nodes.length}`)}
        </blockquote>
      );
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return nodes.length ? nodes : renderInlineText(normalized, `${keyPrefix}-text`);
}

export function normalizeInlineHref(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) {
    return raw;
  }
  return `https://${raw}`;
}

export function renderInlineText(text, keyPrefix) {
  const value = String(text || '');
  const pattern = /\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>()]+)/gi;
  const nodes = [];
  let lastIndex = 0;
  let match;
  let partIndex = 0;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`${keyPrefix}-text-${partIndex++}`}>{value.slice(lastIndex, match.index)}</span>);
    }

    if (match[1] && match[2]) {
      const href = normalizeInlineHref(match[2]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      const href = normalizeInlineHref(match[3]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[3]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(<span key={`${keyPrefix}-text-${partIndex++}`}>{value.slice(lastIndex)}</span>);
  }

  return nodes.length ? nodes : [<span key={`${keyPrefix}-text-0`}>{value}</span>];
}

export function renderInlineMarkdown(text, keyPrefix) {
  const value = String(text || '');
  const pattern = /(\*\*|__)(.+?)\1|(`)(.+?)`|\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>()]+)/gi;
  const nodes = [];
  let lastIndex = 0;
  let match;
  let partIndex = 0;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`${keyPrefix}-text-${partIndex++}`}>{value.slice(lastIndex, match.index)}</span>);
    }

    if (match[1]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${partIndex++}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<code key={`${keyPrefix}-code-${partIndex++}`}>{match[4]}</code>);
    } else if (match[5] && match[6]) {
      const href = normalizeInlineHref(match[6]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[5]}
        </a>
      );
    } else if (match[7]) {
      const href = normalizeInlineHref(match[7]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[7]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(<span key={`${keyPrefix}-text-${partIndex++}`}>{value.slice(lastIndex)}</span>);
  }

  return nodes.length ? nodes : [<span key={`${keyPrefix}-text-0`}>{value}</span>];
}

export function MessageEditForm({ message, onCancel, onSubmit }) {
  const [draft, setDraft] = useState(String(message.content || ''));
  const textareaRef = useRef(null);
  const value = draft.trim();

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, EDIT_MESSAGE_TEXTAREA_MAX_HEIGHT)}px`;
  }, [draft]);

  function submit(event) {
    event.preventDefault();
    if (!value) {
      return;
    }
    onSubmit?.(message, value);
  }

  return (
    <form className="message-edit-form" onSubmit={submit}>
      <textarea
        ref={textareaRef}
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel?.();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            submit(event);
          }
        }}
        placeholder="编辑你的输入"
      />
      <div className="message-edit-actions">
        <button type="button" className="message-edit-button" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="message-edit-button is-primary" disabled={!value}>
          发送
        </button>
      </div>
    </form>
  );
}

export function ChatMessage({ message, onPreviewImage, onDeleteMessage, onEditMessage, onRegenerateMessage }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  if (message.role === 'activity') {
    return <ActivityMessage message={message} />;
  }
  const isUser = message.role === 'user';
  const canAct = message.role === 'user' || message.role === 'assistant';
  const canEdit = message.role === 'user';
  const canRegenerate = message.role === 'assistant';

  async function handleCopy() {
    const copiedText = await copyTextToClipboard(message.content);
    if (!copiedText) {
      window.alert('复制失败');
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`message-row ${isUser ? 'is-user' : ''}`}>
      <div className="message-stack">
        <div className="message-bubble">
          {editing ? (
            <MessageEditForm
              message={message}
              onCancel={() => setEditing(false)}
              onSubmit={(editedMessage, nextContent) => {
                setEditing(false);
                onEditMessage?.(editedMessage, nextContent);
              }}
            />
          ) : (
            <MessageContent content={message.content} onPreviewImage={onPreviewImage} />
          )}
          {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
        </div>
        {canAct && !editing ? (
          <div className="message-actions" aria-label="消息操作">
            <button type="button" className="message-action" onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            {canEdit ? (
              <button type="button" className="message-action" onClick={() => setEditing(true)}>
                <Pencil size={13} />
                <span>修改</span>
              </button>
            ) : null}
            <button type="button" className="message-action is-delete" onClick={() => onDeleteMessage?.(message)}>
              <Trash2 size={13} />
              <span>删除</span>
            </button>
            {canRegenerate ? (
              <button type="button" className="message-action" onClick={() => onRegenerateMessage?.(message)}>
                <RefreshCw size={13} />
                <span>重新生成</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ChatPane({ messages, selectedSession, running, onPreviewImage, onDeleteMessage, onEditMessage, onRegenerateMessage }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, running]);

  if (!messages.length) {
    return (
      <section className="chat-pane empty-chat">
        <div className="empty-orbit">
          <ShieldCheck size={30} />
        </div>
        <h2>{selectedSession ? selectedSession.title : '新对话'}</h2>
        <p>问 Codex 任何事。</p>
      </section>
    );
  }

  return (
    <section className="chat-pane">
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          onPreviewImage={onPreviewImage}
          onDeleteMessage={onDeleteMessage}
          onEditMessage={onEditMessage}
          onRegenerateMessage={onRegenerateMessage}
        />
      ))}
      <div ref={bottomRef} />
    </section>
  );
}

