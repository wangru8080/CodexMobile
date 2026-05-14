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
import { apiFetch } from '../api.js';
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

export function Composer({
  input,
  setInput,
  onSubmit,
  running,
  onAbort,
  models,
  selectedModel,
  onSelectModel,
  selectedReasoningEffort,
  onSelectReasoningEffort,
  permissionMode,
  onSelectPermission,
  attachments,
  onUploadFiles,
  onRemoveAttachment,
  uploading,
  onVoiceSubmit,
  onOpenVoiceDialog,
  voiceDialogActive
}) {
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStreamRef = useRef(null);
  const voiceTimerRef = useRef(null);
  const voiceErrorTimerRef = useRef(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [voiceState, setVoiceState] = useState('idle');
  const [voiceError, setVoiceError] = useState('');
  const hasInput = input.trim().length > 0 || attachments.length > 0;
  const modelList = models?.length ? models : [{ value: selectedModel || 'gpt-5.5', label: selectedModel || 'gpt-5.5' }];
  const selectedModelLabel = modelList.find((model) => model.value === selectedModel)?.label || selectedModel || 'gpt-5.5';
  const voiceRecording = voiceState === 'recording';
  const voiceTranscribing = voiceState === 'transcribing';
  const voiceSending = voiceState === 'sending';

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [input]);

  useEffect(() => () => {
    clearVoiceTimer();
    clearVoiceErrorTimer();
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    stopVoiceStream();
  }, []);

  function submit(event) {
    event.preventDefault();
    if (running && !hasInput) {
      onAbort();
      return;
    }
    if (hasInput) {
      onSubmit();
      setOpenMenu(null);
    }
  }

  function toggleMenu(name) {
    setOpenMenu((current) => (current === name ? null : name));
  }

  function handleFiles(event, kind) {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      onUploadFiles(files, kind);
    }
    event.target.value = '';
    setOpenMenu(null);
  }

  function setVoiceErrorBriefly(message) {
    clearVoiceErrorTimer();
    setVoiceError(message);
    voiceErrorTimerRef.current = window.setTimeout(() => {
      setVoiceError('');
      voiceErrorTimerRef.current = null;
    }, 2600);
  }

  function clearVoiceErrorTimer() {
    if (voiceErrorTimerRef.current) {
      window.clearTimeout(voiceErrorTimerRef.current);
      voiceErrorTimerRef.current = null;
    }
  }

  function clearVoiceTimer() {
    if (voiceTimerRef.current) {
      window.clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function stopVoiceStream() {
    voiceStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  function voiceMimeType() {
    if (!window.MediaRecorder?.isTypeSupported) {
      return '';
    }
    return VOICE_MIME_CANDIDATES.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
  }

  async function transcribeVoiceBlob(blob) {
    if (!blob?.size) {
      setVoiceErrorBriefly('没有录到声音');
      return '';
    }
    if (blob.size > VOICE_MAX_UPLOAD_BYTES) {
      setVoiceErrorBriefly('录音超过 10MB');
      return '';
    }

    const formData = new FormData();
    const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
    formData.append('audio', blob, `voice.${extension}`);

    try {
      const result = await apiFetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData
      });
      if (!result.text?.trim()) {
        setVoiceErrorBriefly('没有识别到文字');
        return '';
      }
      return result.text.trim();
    } catch (error) {
      setVoiceErrorBriefly(error.message || '语音转写失败');
      return '';
    }
  }

  async function startVoiceRecording() {
    setOpenMenu(null);
    clearVoiceErrorTimer();
    setVoiceError('');
    if (window.location.protocol !== 'https:') {
      setVoiceErrorBriefly('请使用 HTTPS 地址或 iOS 键盘听写');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceErrorBriefly('当前浏览器不支持录音');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = voiceMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          voiceChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        clearVoiceTimer();
        stopVoiceStream();
        setVoiceState('idle');
        setVoiceErrorBriefly('录音失败');
      };
      recorder.onstop = async () => {
        clearVoiceTimer();
        stopVoiceStream();
        const recordedType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(voiceChunksRef.current, { type: recordedType });
        voiceChunksRef.current = [];
        mediaRecorderRef.current = null;
        try {
          setVoiceState('transcribing');
          const transcript = await transcribeVoiceBlob(blob);
          if (transcript) {
            setVoiceState('sending');
            await onVoiceSubmit(transcript);
          }
        } catch (error) {
          setVoiceErrorBriefly(error.message || '语音发送失败');
        } finally {
          setVoiceState('idle');
        }
      };

      recorder.start();
      setVoiceState('recording');
      voiceTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          setVoiceState('transcribing');
          mediaRecorderRef.current.stop();
        }
      }, VOICE_MAX_RECORDING_MS);
    } catch (error) {
      clearVoiceTimer();
      stopVoiceStream();
      mediaRecorderRef.current = null;
      setVoiceState('idle');
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setVoiceErrorBriefly(denied ? '麦克风权限被拒绝' : '录音启动失败');
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      clearVoiceErrorTimer();
      setVoiceError('');
      setVoiceState('transcribing');
      mediaRecorderRef.current.stop();
      return;
    }
    clearVoiceTimer();
    stopVoiceStream();
    setVoiceState('idle');
  }

  function toggleVoiceInput() {
    if (voiceRecording) {
      stopVoiceRecording();
    } else if (!voiceTranscribing && !voiceSending) {
      startVoiceRecording();
    }
  }

  return (
    <form className="composer-wrap" onSubmit={submit}>
      <input
        ref={imageInputRef}
        className="file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => handleFiles(event, 'image')}
      />
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        multiple
        onChange={(event) => handleFiles(event, 'file')}
      />
      {openMenu === 'attach' ? (
        <div className="composer-menu attach-menu">
          <button type="button" onClick={() => imageInputRef.current?.click()}>
            <Image size={17} />
            相册
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <FileText size={17} />
            文件
          </button>
        </div>
      ) : null}
      {openMenu === 'model' ? (
        <div className="composer-menu model-menu">
          <div className="menu-section-label">智能</div>
          {REASONING_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={selectedReasoningEffort === option.value ? 'is-selected' : ''}
              onClick={() => {
                onSelectReasoningEffort(option.value);
                setOpenMenu(null);
              }}
            >
              {selectedReasoningEffort === option.value ? <Check size={16} /> : <span className="menu-spacer" />}
              <span>{option.label}</span>
            </button>
          ))}
          <div className="menu-divider" />
          <div className="menu-section-label">模型</div>
          {modelList.map((model) => (
            <button
              key={model.value}
              type="button"
              className={selectedModel === model.value ? 'is-selected' : ''}
              onClick={() => {
                onSelectModel(model.value);
                setOpenMenu(null);
              }}
            >
              {selectedModel === model.value ? <Check size={16} /> : <span className="menu-spacer" />}
              <span>{model.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {openMenu === 'permission' ? (
        <div className="composer-menu permission-menu">
          {PERMISSION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${permissionMode === option.value ? 'is-selected' : ''} ${option.danger ? 'is-danger' : ''}`}
              onClick={() => {
                onSelectPermission(option.value);
                setOpenMenu(null);
              }}
            >
              {permissionMode === option.value ? <Check size={16} /> : <span className="menu-spacer" />}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {voiceState !== 'idle' || voiceError ? (
        <div className={`voice-popover ${voiceError ? 'is-error' : ''}`}>
          <Mic size={14} />
          <span>{voiceError || (voiceSending ? '正在发送...' : voiceTranscribing ? '正在转写...' : '正在录音...')}</span>
        </div>
      ) : null}
      <div className="composer">
        {attachments.length ? (
          <div className="attachment-tray">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="attachment-chip">
                <Paperclip size={14} />
                <span>{attachment.name}</span>
                <small>{formatBytes(attachment.size)}</small>
                <button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label="移除附件">
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="给 Codex 发送消息"
        />
        <div className="composer-controls">
          <div className="control-left">
            <button type="button" className="ghost-icon" aria-label="添加" onClick={() => toggleMenu('attach')} disabled={uploading}>
              <Plus size={21} />
            </button>
            <button type="button" className="permission-pill" onClick={() => toggleMenu('permission')}>
              {permissionLabel(permissionMode)}
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="control-right">
            <button type="button" className="model-select" onClick={() => toggleMenu('model')}>
              {shortModelName(selectedModelLabel)} {reasoningLabel(selectedReasoningEffort)}
              <ChevronDown size={15} />
            </button>
            <button
              type="button"
              className={`dialog-button ${voiceDialogActive ? 'is-active' : ''}`}
              onClick={onOpenVoiceDialog}
              aria-label="语音对话"
            >
              <Headphones size={16} />
              <span>对话</span>
            </button>
            <button
              type="button"
              className={`voice-button ${voiceRecording ? 'is-recording' : ''} ${voiceTranscribing ? 'is-transcribing' : ''} ${voiceSending ? 'is-sending' : ''}`}
              onClick={toggleVoiceInput}
              disabled={voiceTranscribing || voiceSending}
              aria-label={voiceRecording ? '停止语音输入' : voiceSending ? '正在发送语音' : '开始语音输入'}
            >
              {voiceTranscribing || voiceSending ? <Loader2 className="spin" size={16} /> : <Mic size={17} />}
            </button>
            <button type="submit" className={`send-button ${running ? 'is-running' : ''}`} disabled={uploading || (!hasInput && !running)}>
              {running && !hasInput ? <Square size={16} /> : uploading ? <Loader2 className="spin" size={16} /> : <ArrowUp size={19} />}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
