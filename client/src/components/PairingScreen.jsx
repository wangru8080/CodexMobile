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
import { apiFetch, setToken } from '../api.js';

export function PairingScreen({ onPaired }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);

  async function handlePair(event) {
    event.preventDefault();
    setPairing(true);
    setError('');
    try {
      const result = await apiFetch('/api/pair', {
        method: 'POST',
        body: {
          code,
          deviceName: navigator.platform || 'iPhone'
        }
      });
      setToken(result.token);
      onPaired();
    } catch (err) {
      setError(err.message);
    } finally {
      setPairing(false);
    }
  }

  return (
    <main className="pairing-screen">
      <div className="pairing-mark">
        <Monitor size={30} />
      </div>
      <h1>CodexMobile</h1>
      <p>输入电脑端启动日志里的配对码。</p>
      <form className="pairing-form" onSubmit={handlePair}>
        <input
          inputMode="numeric"
          maxLength={6}
          placeholder="6 位配对码"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button type="submit" disabled={code.length !== 6 || pairing}>
          {pairing ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          连接
        </button>
      </form>
      {error ? <div className="pairing-error">{error}</div> : null}
    </main>
  );
}

function quotaPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
}

function quotaRemainingPercent(quotaWindow) {
  if (!quotaWindow || typeof quotaWindow !== 'object') {
    return null;
  }
  const display = quotaPercent(quotaWindow.displayPercent ?? quotaWindow.display_percent);
  if (display !== null) {
    return display;
  }
  const explicit = quotaPercent(quotaWindow.remainingPercent ?? quotaWindow.remaining_percent);
  if (explicit !== null) {
    return explicit;
  }
  const used = quotaPercent(quotaWindow.usedPercent ?? quotaWindow.used_percent);
  return used === null ? null : Math.max(0, Math.min(100, 100 - used));
}

function formatQuotaPercent(quotaWindow) {
  const percent = quotaRemainingPercent(quotaWindow);
  return percent === null ? '--' : `${Math.round(percent)}%`;
}

function quotaToneClass(percent) {
  if (percent === null) {
    return 'is-low';
  }
  if (percent >= 80) {
    return 'is-healthy';
  }
  if (percent >= 60) {
    return 'is-medium';
  }
  if (percent >= 40) {
    return 'is-warning';
  }
  return 'is-low';
}

