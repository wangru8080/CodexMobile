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

export function TopBar({ selectedProject, selectedSession, connectionState, onMenu, onOpenDocs }) {
  const status = CONNECTION_STATUS[connectionState] || CONNECTION_STATUS.disconnected;
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [sessionCopied, setSessionCopied] = useState(false);
  const sessionId = !isDraftSession(selectedSession) ? String(selectedSession?.id || '').trim() : '';

  useEffect(() => {
    setSessionInfoOpen(false);
    setSessionCopied(false);
  }, [sessionId]);

  async function handleCopySessionId() {
    const copied = await copyTextToClipboard(sessionId);
    setSessionCopied(copied);
  }

  return (
    <header className="top-bar">
      <button className="icon-button" onClick={onMenu} aria-label="打开菜单">
        <Menu size={22} />
      </button>
      <div className="top-title">
        <strong>{selectedProject?.name || 'CodexMobile'}</strong>
        <span className={`connection-status ${status.className}`}>
          {sessionId ? (
            <button
              type="button"
              className={`session-info-button ${sessionInfoOpen ? 'is-active' : ''}`}
              onClick={() => setSessionInfoOpen((open) => !open)}
              aria-label="查看 Session ID"
              aria-expanded={sessionInfoOpen}
            >
              <Info size={13} />
            </button>
          ) : null}
          <Wifi size={13} />
          {status.label}
        </span>
        {sessionId ? (
          <>
            {sessionInfoOpen ? (
              <div className="session-info-popover" role="status">
                <div>
                  <strong>Session ID</strong>
                  <code>{sessionId}</code>
                </div>
                <button type="button" onClick={handleCopySessionId}>
                  <Copy size={13} />
                  {sessionCopied ? '已复制' : '复制'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <button type="button" className="icon-button" onClick={onOpenDocs} aria-label="打开文档">
        <FeishuLogoIcon size={23} className="top-docs-logo" />
      </button>
    </header>
  );
}

export function FeishuLogoIcon({ size = 30, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="飞书"
    >
      <rect x="4" y="4" width="56" height="56" rx="15" fill="#fff" />
      <path
        d="M24 15h16.4c2.2 0 3.4.7 4.7 2.5 4.1 5.7 6.5 12.2 7 19.6-6.4-5.5-13.3-8.5-20.4-8.7L24 15Z"
        fill="#12C9B7"
      />
      <path
        d="M14.5 25.8c7.1 7.9 15.3 13.8 24.5 17.8 7.4 3.2 14.7 2.7 21.4-1.6-5.7 9.6-14.7 15.1-27 16.4-7.1.8-13.9-.1-20.5-2.8-2.4-1-4.2-3.2-4.2-5.9V28.1c0-2.3 2.4-3.8 5.8-2.3Z"
        fill="#3A73F6"
      />
      <path
        d="M30.8 38.4c8.7-9.7 18.3-14.1 28.8-8.7-4.8 9.1-12.2 16.1-21.5 17.2-5.8.7-11.7-1-17.8-5.1 3.7-.5 7.2-1.6 10.5-3.4Z"
        fill="#1F45A7"
      />
    </svg>
  );
}

