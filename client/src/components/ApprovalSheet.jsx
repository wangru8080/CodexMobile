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

export function ApprovalSheet({ request, busy, onApprove, onAlwaysAllow, onDeny }) {
  if (!request) {
    return null;
  }

  return (
    <div className="approval-backdrop" role="presentation">
      <section className="approval-sheet" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="approval-handle" />
        <div className="approval-header">
          <div>
            <span className="approval-kicker">Codex 需要授权</span>
            <h2 id="approval-title">{request.title}</h2>
          </div>
          {request.risk ? <span className="approval-risk">需确认</span> : null}
        </div>
        {request.risk ? <p className="approval-warning">{request.risk}</p> : null}
        <pre className="approval-detail">{request.detail}</pre>
        <div className="approval-actions">
          <button type="button" className="approval-button secondary" onClick={onDeny} disabled={busy}>
            拒绝
          </button>
          <button type="button" className="approval-button secondary" onClick={onAlwaysAllow} disabled={busy}>
            始终允许
          </button>
          <button type="button" className="approval-button primary" onClick={onApprove} disabled={busy}>
            {busy ? '处理中...' : '同意执行'}
          </button>
        </div>
      </section>
    </div>
  );
}

