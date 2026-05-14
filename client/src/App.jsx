import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBlobFetch, apiFetch, clearToken, getToken, realtimeVoiceWebsocketUrl } from './api.js';
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_STATUS,
  REALTIME_VOICE_BARGE_IN_LEVEL_THRESHOLD,
  REALTIME_VOICE_BARGE_IN_SUSTAIN_MS,
  REALTIME_VOICE_BUFFER_SIZE,
  REALTIME_VOICE_MIN_TURN_MS,
  REALTIME_VOICE_SAMPLE_RATE,
  VOICE_DIALOG_LEVEL_THRESHOLD,
  VOICE_DIALOG_MIN_RECORDING_MS,
  VOICE_DIALOG_SILENCE_AUDIO,
  VOICE_DIALOG_SILENCE_MS,
  activityStepFromPayload,
  audioLevel,
  completeStatusMessage,
  createClientTurnId,
  createDraftSession,
  downsampleAudio,
  finishActivityMessagesForTurn,
  floatToPcm16Base64,
  hasRunningKey,
  hasVisibleAssistantForTurn,
  isBenignRealtimeCancelError,
  isDraftSession,
  isVoiceHandoffCommand,
  mergeActivityStep,
  pcm16Base64ToFloat,
  payloadRunKeys,
  realtimePayloadErrorMessage,
  selectedRunKeys,
  spokenReplyText,
  titleFromFirstMessage,
  upsertActivityMessage,
  upsertAssistantMessage,
  upsertSessionInProject,
  upsertStatusMessage,
  voiceDialogStatusLabel
} from './app-helpers.js';
import {
  ApprovalSheet,
  ChatPane,
  Composer,
  DocsPanel,
  Drawer,
  ImagePreviewModal,
  PairingScreen,
  TopBar,
  VoiceDialogPanel
} from './components/index.js';
import { useReasoningPreference } from './hooks/useReasoningPreference.js';
import { useApprovals } from './hooks/useApprovals.js';
import { useCodexSocket } from './hooks/useCodexSocket.js';
import { useDocsStatus } from './hooks/useDocsStatus.js';
import { useProjects } from './hooks/useProjects.js';
import { useTheme } from './hooks/useTheme.js';
import { useViewportKeyboard } from './hooks/useViewportKeyboard.js';
import { useVoiceInput } from './hooks/useVoiceInput.js';
import { useChatTurns } from './hooks/useChatTurns.js';

export default function App() {
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_STATUS.model);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useReasoningPreference(status.reasoningEffort);
  const [theme, setTheme] = useTheme();
  const [syncing, setSyncing] = useState(false);
  const selectedProjectRef = useRef(null);
  const selectedSessionRef = useRef(null);
  const editedMessageFiltersRef = useRef(new Map());
  const editedMessageReplacementsRef = useRef(new Map());
  const voiceDialogRecorderRef = useRef(null);
  const voiceDialogChunksRef = useRef([]);
  const voiceDialogStreamRef = useRef(null);
  const voiceDialogTimerRef = useRef(null);
  const voiceDialogSilenceFrameRef = useRef(null);
  const voiceDialogAudioContextRef = useRef(null);
  const voiceDialogAudioSourceRef = useRef(null);
  const voiceDialogSpeechStartedRef = useRef(false);
  const voiceDialogLastSoundAtRef = useRef(0);
  const voiceDialogAudioRef = useRef(null);
  const voiceDialogAudioUnlockedRef = useRef(false);
  const voiceDialogAudioUrlRef = useRef('');
  const voiceDialogAwaitingTurnRef = useRef(null);
  const voiceDialogLastSpokenRef = useRef('');
  const voiceDialogAutoListenRef = useRef(false);
  const voiceDialogOpenRef = useRef(false);
  const voiceDialogStateRef = useRef('idle');
  const voiceDialogRealtimeRef = useRef(false);
  const voiceRealtimeSocketRef = useRef(null);
  const voiceRealtimeStreamRef = useRef(null);
  const voiceRealtimeAudioContextRef = useRef(null);
  const voiceRealtimeAudioSourceRef = useRef(null);
  const voiceRealtimeProcessorRef = useRef(null);
  const voiceRealtimePlaybackContextRef = useRef(null);
  const voiceRealtimePlaybackSourcesRef = useRef(new Set());
  const voiceRealtimePlayheadRef = useRef(0);
  const voiceRealtimeAssistantTextRef = useRef('');
  const voiceRealtimeSpeechStartedRef = useRef(false);
  const voiceRealtimeTurnStartedAtRef = useRef(0);
  const voiceRealtimeLastSoundAtRef = useRef(0);
  const voiceRealtimeAwaitingResponseRef = useRef(false);
  const voiceRealtimeBargeInStartedAtRef = useRef(0);
  const voiceRealtimeSuppressAssistantAudioRef = useRef(false);
  const voiceDialogIdeaBufferRef = useRef([]);
  const voiceDialogHandoffDraftRef = useRef('');
  const {
    runningById,
    setRunningById,
    runningByIdRef,
    lastLocalRunAtRef,
    activePollsRef,
    turnRefreshTimersRef,
    markRun,
    clearRun,
    markTurnCompleted,
    scheduleTurnRefresh,
    pollTurnUntilComplete
  } = useChatTurns({
    filterEditedMessages,
    payloadMatchesCurrentConversation,
    selectedSessionRef,
    setMessages,
    setSelectedSession,
    setSessionsByProject
  });
  const {
    approvalRequest,
    approvalBusy,
    respondToApproval,
    maybeShowApprovalRequest
  } = useApprovals({
    clearRun,
    submitCodexMessage
  });

  function editedMessageKey(message) {
    const role = String(message?.role || '').trim();
    const content = String(message?.content || '').trim();
    if (!role || !content) {
      return '';
    }
    return `${role}:${content}`;
  }

  function rememberEditedMessages(sessionId, messagesToHide, replacementMessage = null) {
    const id = String(sessionId || '').trim();
    if (!id) {
      return { keys: [], replacementId: '' };
    }
    const keys = messagesToHide.map(editedMessageKey).filter(Boolean);
    if (!keys.length) {
      return { keys: [], replacementId: '' };
    }
    const next = new Set(editedMessageFiltersRef.current.get(id) || []);
    for (const key of keys) {
      next.add(key);
    }
    editedMessageFiltersRef.current.set(id, next);
    if (replacementMessage) {
      const replacements = editedMessageReplacementsRef.current.get(id) || [];
      const replacementId = String(replacementMessage.id || `edited-${Date.now()}`);
      editedMessageReplacementsRef.current.set(id, [
        ...replacements,
        {
          id: replacementId,
          keys,
          message: { ...replacementMessage, id: replacementId }
        }
      ]);
      return { keys, replacementId };
    }
    return { keys, replacementId: '' };
  }

  function forgetEditedMessages(sessionId, keys, replacementId = '') {
    const id = String(sessionId || '').trim();
    if (!id || !keys.length) {
      return;
    }
    const current = editedMessageFiltersRef.current.get(id);
    if (!current) {
      return;
    }
    for (const key of keys) {
      current.delete(key);
    }
    if (current.size) {
      editedMessageFiltersRef.current.set(id, current);
    } else {
      editedMessageFiltersRef.current.delete(id);
    }
    if (replacementId) {
      const replacements = editedMessageReplacementsRef.current.get(id) || [];
      const nextReplacements = replacements.filter((item) => item.id !== replacementId);
      if (nextReplacements.length) {
        editedMessageReplacementsRef.current.set(id, nextReplacements);
      } else {
        editedMessageReplacementsRef.current.delete(id);
      }
    }
  }

  function isEditedMessageHidden(sessionId, message) {
    const id = String(sessionId || '').trim();
    const key = editedMessageKey(message);
    return Boolean(id && key && editedMessageFiltersRef.current.get(id)?.has(key));
  }

  function updateEditedReplacementTurn(sessionId, replacementId, patch) {
    const id = String(sessionId || '').trim();
    if (!id || !replacementId) {
      return;
    }
    const replacements = editedMessageReplacementsRef.current.get(id) || [];
    editedMessageReplacementsRef.current.set(
      id,
      replacements.map((item) =>
        item.id === replacementId
          ? { ...item, message: { ...item.message, ...patch } }
          : item
      )
    );
  }

  function filterEditedMessages(sessionId, nextMessages) {
    const messagesToFilter = Array.isArray(nextMessages) ? nextMessages : [];
    const id = String(sessionId || '').trim();
    const replacements = id ? editedMessageReplacementsRef.current.get(id) || [] : [];
    if (!replacements.length) {
      return messagesToFilter.filter((message) => !isEditedMessageHidden(sessionId, message));
    }

    const inserted = new Set();
    const next = [];
    for (const message of messagesToFilter) {
      const key = editedMessageKey(message);
      const replacement = replacements.find((item) => item.keys.includes(key));
      if (replacement) {
        if (!inserted.has(replacement.id)) {
          next.push(replacement.message);
          inserted.add(replacement.id);
        }
        continue;
      }
      if (!isEditedMessageHidden(sessionId, message)) {
        next.push(message);
      }
    }
    for (const replacement of replacements) {
      const replacementContent = String(replacement.message?.content || '').trim();
      const alreadyLoadedReplacement = next.some(
        (message) => message.role === 'user' && String(message.content || '').trim() === replacementContent
      );
      if (!inserted.has(replacement.id) && !alreadyLoadedReplacement) {
        next.push(replacement.message);
      }
    }
    return next;
  }

  function codexContextBeforeMessage(messageId) {
    const targetId = String(messageId || '');
    if (!targetId) {
      return [];
    }
    const targetIndex = messages.findIndex((item) => String(item.id) === targetId);
    if (targetIndex <= 0) {
      return [];
    }
    const hasLaterUserMessage = messages
      .slice(targetIndex + 1)
      .some((item) => item.role === 'user' && String(item.content || '').trim());
    if (!hasLaterUserMessage) {
      return [];
    }
    return messages
      .slice(0, targetIndex)
      .filter((item) => (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim())
      .map((item) => ({
        role: item.role,
        content: String(item.content || '').trim()
      }));
  }
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceDialogState, setVoiceDialogState] = useState('idle');
  const [voiceDialogError, setVoiceDialogError] = useState('');
  const [voiceDialogTranscript, setVoiceDialogTranscript] = useState('');
  const [voiceDialogAssistantText, setVoiceDialogAssistantText] = useState('');
  const [voiceDialogHandoffDraft, setVoiceDialogHandoffDraft] = useState('');

  useViewportKeyboard();

  const {
    projects,
    setProjects,
    selectedProject,
    setSelectedProject,
    expandedProjectIds,
    setExpandedProjectIds,
    sessionsByProject,
    setSessionsByProject,
    loadingProjectId,
    selectedSession,
    setSelectedSession,
    loadProjects,
    loadSessions,
    handleToggleProject,
    handleSelectSession,
    refreshProjectSessions,
    handleRenameSession,
    handleDeleteSession,
    handleNewConversation
  } = useProjects({
    filterEditedMessages,
    selectedProjectRef,
    selectedSessionRef,
    setAttachments,
    setDrawerOpen,
    setInput,
    setMessages
  });

  const running =
    hasRunningKey(runningById, selectedRunKeys(selectedSession)) ||
    messages.some((message) => message.role === 'activity' && (message.status === 'running' || message.status === 'queued'));

  function setVoiceDialogMode(next) {
    voiceDialogStateRef.current = next;
    setVoiceDialogState(next);
  }

  function setVoiceDialogHandoffDraftValue(next) {
    const value = String(next || '');
    voiceDialogHandoffDraftRef.current = value;
    setVoiceDialogHandoffDraft(value);
  }

  function clearVoiceDialogTimer() {
    if (voiceDialogTimerRef.current) {
      window.clearTimeout(voiceDialogTimerRef.current);
      voiceDialogTimerRef.current = null;
    }
  }

  function clearVoiceDialogSilenceDetection() {
    if (voiceDialogSilenceFrameRef.current) {
      window.cancelAnimationFrame(voiceDialogSilenceFrameRef.current);
      voiceDialogSilenceFrameRef.current = null;
    }
    voiceDialogAudioSourceRef.current?.disconnect?.();
    voiceDialogAudioSourceRef.current = null;
    const context = voiceDialogAudioContextRef.current;
    voiceDialogAudioContextRef.current = null;
    if (context && context.state !== 'closed') {
      const closePromise = context.close?.();
      closePromise?.catch?.(() => null);
    }
    voiceDialogSpeechStartedRef.current = false;
    voiceDialogLastSoundAtRef.current = 0;
  }

  function stopVoiceDialogStream() {
    clearVoiceDialogSilenceDetection();
    voiceDialogStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    voiceDialogStreamRef.current = null;
  }

  function setupVoiceDialogSilenceDetection(stream, recorder) {
    clearVoiceDialogSilenceDetection();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    try {
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      voiceDialogAudioContextRef.current = context;
      voiceDialogAudioSourceRef.current = source;
      voiceDialogSpeechStartedRef.current = false;

      const samples = new Uint8Array(analyser.fftSize);
      const startedAt = performance.now();
      voiceDialogLastSoundAtRef.current = startedAt;

      const tick = (now) => {
        if (!voiceDialogOpenRef.current || recorder.state !== 'recording') {
          return;
        }

        analyser.getByteTimeDomainData(samples);
        let total = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const value = (samples[index] - 128) / 128;
          total += value * value;
        }
        const level = Math.sqrt(total / samples.length);
        if (level >= VOICE_DIALOG_LEVEL_THRESHOLD) {
          voiceDialogSpeechStartedRef.current = true;
          voiceDialogLastSoundAtRef.current = now;
        }

        const heardSpeech = voiceDialogSpeechStartedRef.current;
        const recordingLongEnough = now - startedAt >= VOICE_DIALOG_MIN_RECORDING_MS;
        const silentLongEnough = now - voiceDialogLastSoundAtRef.current >= VOICE_DIALOG_SILENCE_MS;
        if (heardSpeech && recordingLongEnough && silentLongEnough) {
          setVoiceDialogMode('transcribing');
          recorder.stop();
          return;
        }

        voiceDialogSilenceFrameRef.current = window.requestAnimationFrame(tick);
      };

      const resumePromise = context.resume?.();
      resumePromise?.catch?.(() => null);
      voiceDialogSilenceFrameRef.current = window.requestAnimationFrame(tick);
    } catch {
      clearVoiceDialogSilenceDetection();
    }
  }

  function ensureVoiceDialogAudio() {
    if (!voiceDialogAudioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.playsInline = true;
      voiceDialogAudioRef.current = audio;
    }
    return voiceDialogAudioRef.current;
  }

  function unlockVoiceDialogAudio() {
    if (voiceDialogAudioUnlockedRef.current) {
      return;
    }
    try {
      const audio = ensureVoiceDialogAudio();
      audio.muted = true;
      audio.src = VOICE_DIALOG_SILENCE_AUDIO;
      const playPromise = audio.play();
      playPromise
        ?.then?.(() => {
          audio.pause();
          audio.muted = false;
          audio.removeAttribute('src');
          audio.load?.();
          voiceDialogAudioUnlockedRef.current = true;
        })
        ?.catch?.(() => {
          audio.muted = false;
        });
    } catch {
      voiceDialogAudioUnlockedRef.current = false;
    }
  }

  function clearVoiceDialogAudio({ release = false } = {}) {
    const audio = voiceDialogAudioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load?.();
      if (release) {
        voiceDialogAudioRef.current = null;
        voiceDialogAudioUnlockedRef.current = false;
      }
    }
    if (voiceDialogAudioUrlRef.current) {
      URL.revokeObjectURL(voiceDialogAudioUrlRef.current);
      voiceDialogAudioUrlRef.current = '';
    }
    window.speechSynthesis?.cancel?.();
  }

  function stopRealtimePlayback({ release = false } = {}) {
    for (const source of voiceRealtimePlaybackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    voiceRealtimePlaybackSourcesRef.current.clear();
    const context = voiceRealtimePlaybackContextRef.current;
    voiceRealtimePlayheadRef.current = context?.currentTime || 0;
    if (release && context && context.state !== 'closed') {
      context.close?.().catch?.(() => null);
      voiceRealtimePlaybackContextRef.current = null;
      voiceRealtimePlayheadRef.current = 0;
    }
  }

  function stopRealtimeVoiceDialog({ keepPanel = false } = {}) {
    const socket = voiceRealtimeSocketRef.current;
    voiceRealtimeSocketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.send(JSON.stringify({ type: 'close' }));
      } catch {
        // Socket may already be closed.
      }
      try {
        socket.close();
      } catch {
        // Socket may already be closed.
      }
    }

    voiceRealtimeProcessorRef.current?.disconnect?.();
    voiceRealtimeProcessorRef.current = null;
    voiceRealtimeAudioSourceRef.current?.disconnect?.();
    voiceRealtimeAudioSourceRef.current = null;
    voiceRealtimeStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    voiceRealtimeStreamRef.current = null;
    const context = voiceRealtimeAudioContextRef.current;
    voiceRealtimeAudioContextRef.current = null;
    if (context && context.state !== 'closed') {
      context.close?.().catch?.(() => null);
    }
    voiceRealtimeAssistantTextRef.current = '';
    voiceRealtimeSpeechStartedRef.current = false;
    voiceRealtimeTurnStartedAtRef.current = 0;
    voiceRealtimeLastSoundAtRef.current = 0;
    voiceRealtimeAwaitingResponseRef.current = false;
    voiceRealtimeBargeInStartedAtRef.current = 0;
    voiceRealtimeSuppressAssistantAudioRef.current = false;
    stopRealtimePlayback({ release: true });
    if (!keepPanel) {
      voiceDialogRealtimeRef.current = false;
    }
  }

  function playRealtimeAudioDelta(delta) {
    if (!delta) {
      return;
    }
    const samples = pcm16Base64ToFloat(delta);
    if (!samples.length) {
      return;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    let context = voiceRealtimePlaybackContextRef.current;
    if (!context || context.state === 'closed') {
      context = new AudioContextCtor();
      voiceRealtimePlaybackContextRef.current = context;
      voiceRealtimePlayheadRef.current = context.currentTime;
    }
    context.resume?.().catch?.(() => null);
    const outputSampleRate = Number(status.voiceRealtime?.outputSampleRate) || REALTIME_VOICE_SAMPLE_RATE;
    const buffer = context.createBuffer(1, samples.length, outputSampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    voiceRealtimePlaybackSourcesRef.current.add(source);
    source.onended = () => {
      voiceRealtimePlaybackSourcesRef.current.delete(source);
      if (
        voiceDialogOpenRef.current &&
        voiceDialogRealtimeRef.current &&
        voiceRealtimePlaybackSourcesRef.current.size === 0 &&
        voiceDialogStateRef.current === 'speaking'
      ) {
        voiceRealtimeAwaitingResponseRef.current = false;
        setVoiceDialogMode('listening');
      }
    };
    const startAt = Math.max(voiceRealtimePlayheadRef.current, context.currentTime + 0.03);
    source.start(startAt);
    voiceRealtimePlayheadRef.current = startAt + buffer.duration;
  }

  function appendVoiceDialogIdeaTranscript(transcript) {
    const text = String(transcript || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }
    const buffer = voiceDialogIdeaBufferRef.current;
    if (buffer[buffer.length - 1] === text) {
      return;
    }
    buffer.push(text);
    if (buffer.length > 30) {
      buffer.splice(0, buffer.length - 30);
    }
  }

  function requestVoiceHandoffSummary(triggerText = '') {
    const socket = voiceRealtimeSocketRef.current;
    const transcripts = voiceDialogIdeaBufferRef.current.filter(Boolean);
    if (!transcripts.length) {
      setVoiceDialogErrorBriefly('还没有可整理的语音内容');
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setVoiceDialogErrorBriefly('实时语音连接不可用');
      return;
    }
    stopRealtimePlayback();
    voiceRealtimeSuppressAssistantAudioRef.current = true;
    voiceRealtimeAwaitingResponseRef.current = false;
    voiceRealtimeBargeInStartedAtRef.current = 0;
    voiceRealtimeAssistantTextRef.current = '';
    setVoiceDialogAssistantText('');
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogError('');
    setVoiceDialogMode('summarizing');
    socket.send(JSON.stringify({
      type: 'voice.handoff.summarize',
      transcripts,
      trigger: triggerText
    }));
  }

  async function startRealtimeMicrophone(socket) {
    if (!window.isSecureContext) {
      throw new Error('请使用 HTTPS 地址');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持录音');
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('当前浏览器不支持实时音频');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const context = new AudioContextCtor();
    await context.resume?.().catch?.(() => null);
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(REALTIME_VOICE_BUFFER_SIZE, 1, 1);
    const inputSampleRate = Number(status.voiceRealtime?.inputSampleRate) || REALTIME_VOICE_SAMPLE_RATE;
    const useClientVad = Boolean(status.voiceRealtime?.clientTurnDetection);
    const silenceMs = Number(status.voiceRealtime?.clientVadSilenceMs) || VOICE_DIALOG_SILENCE_MS;
    const commitCurrentTurn = () => {
      if (!voiceRealtimeSpeechStartedRef.current || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      voiceRealtimeSpeechStartedRef.current = false;
      voiceRealtimeBargeInStartedAtRef.current = 0;
      voiceRealtimeAwaitingResponseRef.current = true;
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      setVoiceDialogMode('waiting');
      socket.send(JSON.stringify({ type: 'input_audio.commit' }));
    };
    const beginBargeIn = () => {
      voiceRealtimeSuppressAssistantAudioRef.current = true;
      socket.send(JSON.stringify({ type: 'response.cancel' }));
      socket.send(JSON.stringify({ type: 'input_audio.clear' }));
      stopRealtimePlayback();
      voiceRealtimeAwaitingResponseRef.current = false;
      voiceRealtimeBargeInStartedAtRef.current = 0;
      voiceRealtimeAssistantTextRef.current = '';
      setVoiceDialogAssistantText('');
      setVoiceDialogMode('listening');
    };
    processor.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      if (
        !voiceDialogOpenRef.current ||
        !voiceDialogRealtimeRef.current ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      if (voiceDialogStateRef.current === 'summarizing' || voiceDialogStateRef.current === 'handoff') {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleAudio(input, context.sampleRate, inputSampleRate);
      if (!useClientVad) {
        socket.send(JSON.stringify({
          type: 'input_audio.append',
          audio: floatToPcm16Base64(downsampled)
        }));
        return;
      }

      const now = performance.now();
      const level = audioLevel(downsampled);
      const hasSound = level >= VOICE_DIALOG_LEVEL_THRESHOLD;
      if (voiceRealtimeAwaitingResponseRef.current) {
        const playbackActive =
          voiceRealtimePlaybackSourcesRef.current.size > 0 ||
          voiceDialogStateRef.current === 'speaking';
        if (playbackActive) {
          const bargeInCandidate = level >= REALTIME_VOICE_BARGE_IN_LEVEL_THRESHOLD;
          if (!bargeInCandidate) {
            voiceRealtimeBargeInStartedAtRef.current = 0;
            return;
          }
          if (!voiceRealtimeBargeInStartedAtRef.current) {
            voiceRealtimeBargeInStartedAtRef.current = now;
            return;
          }
          if (now - voiceRealtimeBargeInStartedAtRef.current < REALTIME_VOICE_BARGE_IN_SUSTAIN_MS) {
            return;
          }
          beginBargeIn();
        } else if (hasSound) {
          beginBargeIn();
        } else {
          voiceRealtimeBargeInStartedAtRef.current = 0;
          return;
        }
      }

      if (hasSound) {
        if (!voiceRealtimeSpeechStartedRef.current) {
          voiceRealtimeSpeechStartedRef.current = true;
          voiceRealtimeTurnStartedAtRef.current = now;
          setVoiceDialogMode('listening');
        }
        voiceRealtimeLastSoundAtRef.current = now;
      }

      if (!voiceRealtimeSpeechStartedRef.current) {
        return;
      }

      socket.send(JSON.stringify({
        type: 'input_audio.append',
        audio: floatToPcm16Base64(downsampled)
      }));

      const turnLongEnough = now - voiceRealtimeTurnStartedAtRef.current >= REALTIME_VOICE_MIN_TURN_MS;
      const silentLongEnough = now - voiceRealtimeLastSoundAtRef.current >= silenceMs;
      if (turnLongEnough && silentLongEnough) {
        commitCurrentTurn();
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
    voiceRealtimeStreamRef.current = stream;
    voiceRealtimeAudioContextRef.current = context;
    voiceRealtimeAudioSourceRef.current = source;
    voiceRealtimeProcessorRef.current = processor;
  }

  function handleRealtimeVoiceEvent(payload) {
    if (!voiceDialogOpenRef.current || !voiceDialogRealtimeRef.current) {
      return;
    }
    if (payload.type === 'voice.realtime.connecting') {
      setVoiceDialogMode('waiting');
      return;
    }
    if (payload.type === 'voice.realtime.ready') {
      const socket = voiceRealtimeSocketRef.current;
      if (!socket || voiceRealtimeStreamRef.current) {
        setVoiceDialogMode('listening');
        return;
      }
      startRealtimeMicrophone(socket)
        .then(() => {
          setVoiceDialogError('');
          setVoiceDialogMode('listening');
        })
        .catch((error) => {
          setVoiceDialogErrorBriefly(error.message || '实时语音启动失败');
          stopRealtimeVoiceDialog({ keepPanel: true });
        });
      return;
    }
    if (payload.type === 'voice.realtime.cancel_ignored') {
      voiceRealtimeAwaitingResponseRef.current = false;
      voiceRealtimeBargeInStartedAtRef.current = 0;
      setVoiceDialogError('');
      setVoiceDialogMode('listening');
      return;
    }
    if (payload.type === 'voice.handoff.summarizing') {
      stopRealtimePlayback();
      voiceRealtimeSuppressAssistantAudioRef.current = true;
      voiceRealtimeAssistantTextRef.current = '';
      setVoiceDialogAssistantText('');
      setVoiceDialogError('');
      setVoiceDialogMode('summarizing');
      return;
    }
    if (payload.type === 'voice.handoff.summary_delta') {
      return;
    }
    if (payload.type === 'voice.handoff.summary_done') {
      const draft = String(payload.message || payload.rawText || '').trim();
      if (!draft) {
        setVoiceDialogErrorBriefly('没有整理出可交给 Codex 的任务');
        return;
      }
      setVoiceDialogHandoffDraftValue(draft);
      setVoiceDialogAssistantText('');
      setVoiceDialogError(payload.parsed ? '' : '整理结果不是标准 JSON，已作为草稿保留');
      setVoiceDialogMode('handoff');
      return;
    }
    if (payload.type === 'voice.handoff.summary_error') {
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      setVoiceDialogErrorBriefly(payload.error || '语音任务整理失败');
      return;
    }
    if (payload.type === 'response.created') {
      if (voiceDialogStateRef.current === 'summarizing' || voiceDialogStateRef.current === 'handoff') {
        return;
      }
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      voiceRealtimeAwaitingResponseRef.current = true;
      return;
    }
    if (payload.type === 'voice.realtime.error' || payload.type === 'error') {
      if (isBenignRealtimeCancelError(payload)) {
        voiceRealtimeAwaitingResponseRef.current = false;
        voiceRealtimeBargeInStartedAtRef.current = 0;
        setVoiceDialogError('');
        setVoiceDialogMode('listening');
        return;
      }
      const message = payload.error?.message || payload.error || '实时语音连接失败';
      voiceRealtimeAwaitingResponseRef.current = false;
      setVoiceDialogErrorBriefly(message);
      stopRealtimeVoiceDialog({ keepPanel: true });
      return;
    }
    if (payload.type === 'input_audio_buffer.speech_started') {
      stopRealtimePlayback();
      voiceRealtimeAssistantTextRef.current = '';
      voiceRealtimeAwaitingResponseRef.current = false;
      setVoiceDialogAssistantText('');
      setVoiceDialogMode('listening');
      return;
    }
    if (payload.type === 'input_audio_buffer.speech_stopped') {
      setVoiceDialogMode('waiting');
      return;
    }
    if (
      payload.type === 'conversation.item.input_audio_transcription.completed' &&
      payload.transcript
    ) {
      const transcript = String(payload.transcript || '').trim();
      setVoiceDialogTranscript(transcript);
      if (isVoiceHandoffCommand(transcript)) {
        requestVoiceHandoffSummary(transcript);
        return;
      }
      appendVoiceDialogIdeaTranscript(transcript);
      return;
    }
    if (
      (payload.type === 'response.audio_transcript.delta' ||
        payload.type === 'response.output_audio_transcript.delta') &&
      payload.delta
    ) {
      if (voiceRealtimeSuppressAssistantAudioRef.current) {
        return;
      }
      voiceRealtimeAssistantTextRef.current += payload.delta;
      setVoiceDialogAssistantText(voiceRealtimeAssistantTextRef.current.trim());
      return;
    }
    if (
      (payload.type === 'response.audio.delta' ||
        payload.type === 'response.output_audio.delta') &&
      payload.delta
    ) {
      if (voiceRealtimeSuppressAssistantAudioRef.current) {
        return;
      }
      voiceRealtimeAwaitingResponseRef.current = true;
      setVoiceDialogMode('speaking');
      playRealtimeAudioDelta(payload.delta);
      return;
    }
    if (
      payload.type === 'response.done' &&
      voiceDialogStateRef.current !== 'summarizing' &&
      voiceDialogStateRef.current !== 'handoff' &&
      voiceRealtimePlaybackSourcesRef.current.size === 0
    ) {
      voiceRealtimeSuppressAssistantAudioRef.current = false;
      voiceRealtimeAwaitingResponseRef.current = false;
      setVoiceDialogMode('listening');
    }
  }

  function startRealtimeVoiceDialog() {
    if (!status.voiceRealtime?.configured) {
      setVoiceDialogErrorBriefly('未配置实时语音');
      return;
    }
    if (voiceRealtimeSocketRef.current) {
      return;
    }
    clearVoiceDialogAudio();
    stopRealtimeVoiceDialog({ keepPanel: true });
    voiceDialogRealtimeRef.current = true;
    voiceRealtimeAssistantTextRef.current = '';
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('waiting');

    const socket = new WebSocket(realtimeVoiceWebsocketUrl());
    voiceRealtimeSocketRef.current = socket;
    socket.onopen = () => {
      setVoiceDialogMode('waiting');
    };
    socket.onmessage = (event) => {
      try {
        handleRealtimeVoiceEvent(JSON.parse(event.data));
      } catch {
        // Ignore malformed proxy events.
      }
    };
    socket.onerror = () => {
      setVoiceDialogErrorBriefly('实时语音连接失败');
      stopRealtimeVoiceDialog({ keepPanel: true });
    };
    socket.onclose = () => {
      if (voiceDialogOpenRef.current && voiceDialogRealtimeRef.current) {
        stopRealtimeVoiceDialog({ keepPanel: true });
        setVoiceDialogMode('idle');
      }
    };
  }

  function voiceDialogMimeType() {
    if (!window.MediaRecorder?.isTypeSupported) {
      return '';
    }
    return VOICE_MIME_CANDIDATES.find((type) => window.MediaRecorder.isTypeSupported(type)) || '';
  }

  function setVoiceDialogErrorBriefly(message) {
    setVoiceDialogError(message);
    setVoiceDialogMode('error');
  }

  async function transcribeVoiceDialogBlob(blob) {
    if (!blob?.size) {
      throw new Error('没有录到声音');
    }
    if (blob.size > VOICE_MAX_UPLOAD_BYTES) {
      throw new Error('录音超过 10MB');
    }

    const formData = new FormData();
    const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
    formData.append('audio', blob, `voice-dialog.${extension}`);
    const result = await apiFetch('/api/voice/transcribe', {
      method: 'POST',
      body: formData
    });
    const text = String(result.text || '').trim();
    if (!text) {
      throw new Error('没有识别到文字');
    }
    return text;
  }

  function playAudioBlob(blob) {
    return new Promise((resolve, reject) => {
      clearVoiceDialogAudio();
      const url = URL.createObjectURL(blob);
      const audio = ensureVoiceDialogAudio();
      voiceDialogAudioUrlRef.current = url;
      audio.muted = false;
      audio.src = url;
      audio.playsInline = true;
      audio.onended = () => {
        voiceDialogAudioUnlockedRef.current = true;
        resolve();
      };
      audio.onerror = () => reject(new Error('播放失败'));
      audio.load?.();
      audio.play().catch(reject);
    });
  }

  function speakWithBrowser(text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        reject(new Error('当前浏览器不支持朗读'));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = resolve;
      utterance.onerror = () => reject(new Error('朗读失败'));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  function scheduleNextVoiceDialogTurn() {
    if (!voiceDialogOpenRef.current || !voiceDialogAutoListenRef.current) {
      setVoiceDialogMode('idle');
      return;
    }
    setVoiceDialogMode('idle');
    window.setTimeout(() => {
      if (voiceDialogOpenRef.current && voiceDialogAutoListenRef.current) {
        startVoiceDialogRecording();
      }
    }, 220);
  }

  async function playVoiceDialogReply(message) {
    const text = spokenReplyText(message?.content);
    if (!text) {
      scheduleNextVoiceDialogTurn();
      return;
    }

    setVoiceDialogAssistantText(text);
    setVoiceDialogError('');
    setVoiceDialogMode('speaking');

    try {
      const blob = await apiBlobFetch('/api/voice/speech', {
        method: 'POST',
        body: { text }
      });
      await playAudioBlob(blob);
    } catch (error) {
      try {
        await speakWithBrowser(text);
      } catch {
        setVoiceDialogError(error.message || '朗读失败');
      }
    } finally {
      clearVoiceDialogAudio();
      scheduleNextVoiceDialogTurn();
    }
  }

  async function startVoiceDialogRecording() {
    if (voiceDialogRealtimeRef.current) {
      startRealtimeVoiceDialog();
      return;
    }
    if (!voiceDialogOpenRef.current) {
      return;
    }
    if (['transcribing', 'sending', 'waiting', 'speaking'].includes(voiceDialogStateRef.current)) {
      return;
    }
    clearVoiceDialogTimer();
    clearVoiceDialogAudio();
    unlockVoiceDialogAudio();
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');

    if (!selectedProjectRef.current && !selectedProject) {
      setVoiceDialogErrorBriefly('请先选择项目');
      return;
    }
    if (!window.isSecureContext) {
      setVoiceDialogErrorBriefly('请使用 HTTPS 地址');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceDialogErrorBriefly('当前浏览器不支持录音');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = voiceDialogMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceDialogStreamRef.current = stream;
      voiceDialogChunksRef.current = [];
      voiceDialogRecorderRef.current = recorder;
      setupVoiceDialogSilenceDetection(stream, recorder);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          voiceDialogChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        clearVoiceDialogTimer();
        stopVoiceDialogStream();
        voiceDialogRecorderRef.current = null;
        setVoiceDialogErrorBriefly('录音失败');
      };
      recorder.onstop = async () => {
        clearVoiceDialogTimer();
        stopVoiceDialogStream();
        const recordedType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(voiceDialogChunksRef.current, { type: recordedType });
        voiceDialogChunksRef.current = [];
        voiceDialogRecorderRef.current = null;

        try {
          setVoiceDialogMode('transcribing');
          const transcript = await transcribeVoiceDialogBlob(blob);
          setVoiceDialogTranscript(transcript);
          setVoiceDialogMode('sending');
          const turn = await handleVoiceSubmit(transcript);
          voiceDialogAwaitingTurnRef.current = {
            turnId: turn?.turnId,
            message: transcript,
            startedAt: Date.now()
          };
          setVoiceDialogMode('waiting');
        } catch (error) {
          voiceDialogAwaitingTurnRef.current = null;
          setVoiceDialogErrorBriefly(error.message || '语音对话失败');
        }
      };

      recorder.start();
      setVoiceDialogMode('listening');
      voiceDialogTimerRef.current = window.setTimeout(() => {
        if (voiceDialogRecorderRef.current?.state === 'recording') {
          setVoiceDialogMode('transcribing');
          voiceDialogRecorderRef.current.stop();
        }
      }, VOICE_MAX_RECORDING_MS);
    } catch (error) {
      clearVoiceDialogTimer();
      stopVoiceDialogStream();
      voiceDialogRecorderRef.current = null;
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setVoiceDialogErrorBriefly(denied ? '麦克风权限被拒绝' : '录音启动失败');
    }
  }

  function stopVoiceDialogRecording() {
    if (voiceDialogRealtimeRef.current) {
      stopRealtimeVoiceDialog({ keepPanel: true });
      setVoiceDialogMode('idle');
      return;
    }
    if (voiceDialogRecorderRef.current?.state === 'recording') {
      setVoiceDialogError('');
      setVoiceDialogMode('transcribing');
      voiceDialogRecorderRef.current.stop();
      return;
    }
    clearVoiceDialogTimer();
    stopVoiceDialogStream();
    setVoiceDialogMode('idle');
  }

  function continueVoiceHandoffCollection() {
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogError('');
    setVoiceDialogAssistantText('');
    voiceRealtimeSuppressAssistantAudioRef.current = false;
    setVoiceDialogMode('listening');
  }

  function cancelVoiceHandoffConfirmation() {
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogError('');
    voiceRealtimeSuppressAssistantAudioRef.current = false;
    setVoiceDialogMode('listening');
  }

  async function submitVoiceHandoffToCodex() {
    const message = voiceDialogHandoffDraftRef.current.trim();
    if (!message) {
      return;
    }
    if (!selectedProjectRef.current && !selectedProject) {
      setVoiceDialogError('请先选择项目');
      setVoiceDialogMode('handoff');
      return;
    }
    try {
      setVoiceDialogError('');
      setVoiceDialogMode('sending');
      await submitCodexMessage({ message });
      voiceDialogIdeaBufferRef.current = [];
      setVoiceDialogHandoffDraftValue('');
      closeVoiceDialog();
    } catch (error) {
      setVoiceDialogError(error.message || '发送给 Codex 失败');
      setVoiceDialogMode('handoff');
    }
  }

  function openVoiceDialog() {
    unlockVoiceDialogAudio();
    voiceDialogOpenRef.current = true;
    voiceDialogRealtimeRef.current = Boolean(status.voiceRealtime?.configured);
    voiceDialogAutoListenRef.current = !voiceDialogRealtimeRef.current;
    voiceDialogAwaitingTurnRef.current = null;
    voiceDialogIdeaBufferRef.current = [];
    setVoiceDialogHandoffDraftValue('');
    setVoiceDialogOpen(true);
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('idle');
    window.setTimeout(() => {
      if (voiceDialogOpenRef.current) {
        if (voiceDialogRealtimeRef.current) {
          startRealtimeVoiceDialog();
        } else {
          startVoiceDialogRecording();
        }
      }
    }, 80);
  }

  function closeVoiceDialog() {
    voiceDialogAutoListenRef.current = false;
    voiceDialogOpenRef.current = false;
    voiceDialogAwaitingTurnRef.current = null;
    voiceDialogIdeaBufferRef.current = [];
    setVoiceDialogHandoffDraftValue('');
    stopRealtimeVoiceDialog();
    if (voiceDialogRecorderRef.current?.state === 'recording') {
      voiceDialogRecorderRef.current.onstop = null;
      voiceDialogRecorderRef.current.stop();
    }
    voiceDialogRecorderRef.current = null;
    clearVoiceDialogTimer();
    stopVoiceDialogStream();
    clearVoiceDialogAudio({ release: true });
    setVoiceDialogOpen(false);
    setVoiceDialogError('');
    setVoiceDialogTranscript('');
    setVoiceDialogAssistantText('');
    setVoiceDialogMode('idle');
  }

  function restoreTurnSnapshot(turn) {
    const currentSession = selectedSessionRef.current;
    if (!turn?.turnId || !currentSession || !payloadMatchesCurrentConversation(turn)) {
      return;
    }

    const sessionId = turn.sessionId || turn.previousSessionId || currentSession.id || null;
    const projectId = turn.projectId || selectedProjectRef.current?.id || currentSession.projectId || null;
    const content = String(turn.assistantPreview || '');

    if (content.trim()) {
      setMessages((current) =>
        upsertAssistantMessage(current, {
          sessionId,
          previousSessionId: turn.previousSessionId,
          turnId: turn.turnId,
          messageId: turn.messageId || `assistant-${turn.turnId}`,
          kind: 'message',
          content
        })
      );
    } else if (turn.status === 'running' || turn.status === 'queued') {
      setMessages((current) =>
        upsertStatusMessage(current, {
          sessionId,
          previousSessionId: turn.previousSessionId,
          turnId: turn.turnId,
          kind: turn.kind || 'reasoning',
          status: turn.status || 'running',
          label: turn.label || '正在思考中',
          detail: turn.detail || ''
        })
      );
    }

    if (turn.status === 'running' || turn.status === 'queued') {
      pollTurnUntilComplete({
        turnId: turn.turnId,
        optimisticSessionId: turn.previousSessionId || sessionId,
        projectId,
        previousSessionId: turn.previousSessionId
      });
      return;
    }

    if (turn.status === 'completed' && sessionId) {
      scheduleTurnRefresh({
        sessionId,
        previousSessionId: turn.previousSessionId,
        turnId: turn.turnId,
        hadAssistantText: turn.hadAssistantText || Boolean(content.trim()),
        usage: turn.usage || null
      });
    }
  }

  function syncActiveRunsFromStatus(nextStatus) {
    const activeRuns = Array.isArray(nextStatus?.activeRuns) ? nextStatus.activeRuns : [];
    const recentTurns = Array.isArray(nextStatus?.recentTurns) ? nextStatus.recentTurns : [];
    const recoverableTurns = new Map();
    const currentSession = selectedSessionRef.current;
    const matchingRecentTurns = currentSession
      ? recentTurns.filter((turn) => turn?.turnId && payloadMatchesCurrentConversation(turn))
      : [];
    const latestMatchingTurn = matchingRecentTurns[0] || null;

    for (const turn of activeRuns) {
      if (turn?.turnId && payloadMatchesCurrentConversation(turn)) {
        recoverableTurns.set(turn.turnId, turn);
      }
    }
    if (latestMatchingTurn) {
      recoverableTurns.set(latestMatchingTurn.turnId, latestMatchingTurn);
    }

    for (const turn of recoverableTurns.values()) {
      restoreTurnSnapshot(turn);
    }

    if (!activeRuns.length) {
      setMessages((current) => {
        const hasRecentLocalRun = Date.now() - lastLocalRunAtRef.current < 15000;
        if (activePollsRef.current.size || turnRefreshTimersRef.current.size || hasRecentLocalRun) {
          return current;
        }
        return current.filter(
          (message) => !(message.role === 'activity' && (message.status === 'running' || message.status === 'queued'))
        );
      });
      return;
    }

    const nextRunning = {};
    for (const run of activeRuns) {
      for (const key of payloadRunKeys(run)) {
        nextRunning[key] = true;
      }
    }
    const shouldPreserveLocalRuns =
      activePollsRef.current.size > 0 ||
      turnRefreshTimersRef.current.size > 0 ||
      Date.now() - lastLocalRunAtRef.current < 15000;
    setRunningById((current) => {
      const next = shouldPreserveLocalRuns ? { ...current, ...nextRunning } : nextRunning;
      runningByIdRef.current = next;
      return next;
    });
  }

  function payloadMatchesCurrentConversation(payload) {
    const current = selectedSessionRef.current;
    if (!current) {
      return true;
    }
    const keys = payloadRunKeys(payload);
    return keys.includes(current.id) || keys.includes(current.turnId);
  }

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => () => closeVoiceDialog(), []);

  useEffect(() => {
    const awaiting = voiceDialogAwaitingTurnRef.current;
    if (!voiceDialogOpen || !awaiting?.turnId || voiceDialogStateRef.current !== 'waiting') {
      return;
    }
    if (runningById[awaiting.turnId]) {
      return;
    }

    const reversed = [...messages].reverse();
    let reply = reversed.find(
      (message) =>
        message.role === 'assistant' &&
        message.turnId === awaiting.turnId &&
        String(message.content || '').trim()
    );

    if (!reply) {
      let userIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
          message.role === 'user' &&
          (message.turnId === awaiting.turnId || String(message.content || '').trim() === awaiting.message)
        ) {
          userIndex = index;
          break;
        }
      }
      if (userIndex >= 0) {
        reply = [...messages.slice(userIndex + 1)].reverse().find(
          (message) => message.role === 'assistant' && String(message.content || '').trim()
        );
      }
    }

    const speechText = spokenReplyText(reply?.content);
    if (!reply || !speechText) {
      return;
    }

    const speechKey = `${awaiting.turnId}:${reply.id}:${speechText.length}`;
    if (voiceDialogLastSpokenRef.current === speechKey) {
      return;
    }
    voiceDialogLastSpokenRef.current = speechKey;
    voiceDialogAwaitingTurnRef.current = null;
    playVoiceDialogReply(reply);
  }, [messages, runningById, voiceDialogOpen]);

  useEffect(() => {
    if (status.model && selectedModel === DEFAULT_STATUS.model) {
      setSelectedModel(status.model);
    }
  }, [selectedModel, status.model]);

  const loadStatus = useCallback(async () => {
    const data = await apiFetch('/api/status');
    setStatus(data);
    setAuthenticated(Boolean(data.auth?.authenticated));
    syncActiveRunsFromStatus(data);
    return data;
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const currentStatus = await loadStatus();
      if (currentStatus.auth?.authenticated) {
        await loadProjects();
        setSyncing(true);
        apiFetch('/api/sync', { method: 'POST' })
          .then(async () => {
            await loadStatus();
            await loadProjects();
          })
          .catch(() => null)
          .finally(() => setSyncing(false));
      }
    } catch (error) {
      if (String(error.message).includes('Pairing')) {
        clearToken();
        setAuthenticated(false);
      }
    }
  }, [loadProjects, loadStatus]);

  const {
    docsBusy,
    docsError,
    handleConnectDocs,
    handleDisconnectDocs,
    handleRefreshDocs,
    handleOpenDocsHome,
    handleOpenDocsAuth
  } = useDocsStatus({
    docs: status.docs,
    setStatus,
    loadStatus
  });

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const handleSocketPayload = useCallback((payload, { setConnectionState: setSocketConnectionState }) => {
    if (payload.type === 'connected') {
      setStatus(payload.status || DEFAULT_STATUS);
      setSocketConnectionState(payload.status?.connected ? 'connected' : 'disconnected');
      syncActiveRunsFromStatus(payload.status || DEFAULT_STATUS);
      return;
    }
    if (payload.type === 'chat-started') {
      markRun(payload);
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      if (!selectedSessionRef.current && payload.sessionId) {
        setSelectedSession({ id: payload.sessionId, projectId: payload.projectId, title: '新对话' });
      }
      return;
    }
    if (payload.type === 'thread-started' && payload.sessionId) {
      const projectId = payload.projectId || selectedProjectRef.current?.id || selectedSessionRef.current?.projectId;
      const currentSession = selectedSessionRef.current;
      const nextSession = {
        ...(currentSession || {}),
        id: payload.sessionId,
        projectId,
        title: currentSession?.title || '新对话',
        updatedAt: new Date().toISOString(),
        draft: false
      };
      markRun(payload);
      setSelectedSession((current) => {
        if (!current) {
          return nextSession;
        }
        const shouldReplace =
          current.id === payload.previousSessionId ||
          current.id === payload.sessionId ||
          current.turnId === payload.turnId ||
          (current.draft && current.projectId === projectId);
        return shouldReplace ? { ...current, ...nextSession } : current;
      });
      setSessionsByProject((current) =>
        upsertSessionInProject(current, projectId, nextSession, payload.previousSessionId)
      );
      setMessages((current) =>
        current.map((message) =>
          message.turnId === payload.turnId || message.sessionId === payload.previousSessionId
            ? { ...message, sessionId: payload.sessionId }
            : message
        )
      );
      return;
    }
    if (payload.type === 'message-deleted') {
      if (payloadMatchesCurrentConversation(payload)) {
        setMessages((current) => current.filter((message) => String(message.id) !== String(payload.messageId)));
      }
      return;
    }
    if (payload.type === 'user-message') {
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      if (isEditedMessageHidden(payload.sessionId, payload.message)) {
        return;
      }
      setMessages((current) => {
        const alreadyShown = current.some(
          (message) => message.role === 'user' && message.content === payload.message.content
        );
        if (alreadyShown) {
          return current;
        }
        return [...current, payload.message];
      });
      return;
    }
    if (payload.type === 'assistant-update') {
      if (!payload.content?.trim()) {
        return;
      }
      markRun(payload);
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      if (payload.phase === 'commentary' || payload.kind === 'agent_message') {
        maybeShowApprovalRequest(payload);
        setMessages((current) =>
          upsertStatusMessage(current, {
            ...payload,
            kind: payload.kind || 'agent_message',
            label: briefActivityLabel(payload.content),
            status: payload.status || 'running'
          })
        );
        return;
      }
      maybeShowApprovalRequest(payload);
      setMessages((current) => upsertAssistantMessage(current, payload));
      return;
    }
    if (payload.type === 'status-update') {
      if (payload.status === 'running' || payload.status === 'queued') {
        markRun(payload);
      }
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      maybeShowApprovalRequest(payload);
      if (payload.kind === 'turn' && payload.status === 'completed') {
        markTurnCompleted(payload);
        return;
      }
      setMessages((current) => upsertStatusMessage(current, payload));
      return;
    }
    if (payload.type === 'activity-update') {
      if (payload.status === 'running' || payload.status === 'queued') {
        markRun(payload);
      }
      if (!payloadMatchesCurrentConversation(payload)) {
        return;
      }
      setMessages((current) => upsertActivityMessage(current, payload));
      return;
    }
    if (payload.type === 'chat-complete' || payload.type === 'chat-error' || payload.type === 'chat-aborted') {
      if (!payloadMatchesCurrentConversation(payload)) {
        clearRun(payload);
        return;
      }
      if (payload.type === 'chat-complete') {
        markTurnCompleted(payload);
        scheduleTurnRefresh(payload);
        return;
      }
      clearRun(payload);
      if (payload.type === 'chat-error' && payload.error) {
        setMessages((current) =>
          upsertStatusMessage(current, {
            ...payload,
            status: 'failed',
            label: '任务失败',
            detail: payload.error
          })
        );
      } else if (payload.type === 'chat-aborted') {
        setMessages((current) =>
          upsertStatusMessage(finishActivityMessagesForTurn(current, payload), {
            ...payload,
            status: 'completed',
            label: '已中止'
          })
        );
      }
      return;
    }
    if (payload.type === 'sync-complete' && payload.projects) {
      setProjects(payload.projects);
      const project = selectedProjectRef.current;
      if (project?.id) {
        apiFetch(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
          .then((data) => {
            setSessionsByProject((current) => ({ ...current, [project.id]: data.sessions || [] }));
          })
          .catch(() => null);
      }
    }
  }, []);

  const { connectionState } = useCodexSocket({ authenticated, onPayload: handleSocketPayload });

  async function handleSync() {
    setSyncing(true);
    try {
      await apiFetch('/api/sync', { method: 'POST' });
      await loadStatus();
      await loadProjects();
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteMessage(message) {
    if (!message?.id) {
      return;
    }
    if (!window.confirm('删除这条消息？')) {
      return;
    }

    const messageId = String(message.id);
    const sessionId = selectedSessionRef.current?.id || message.sessionId || '';
    const existingIndex = messages.findIndex((item) => String(item.id) === messageId);
    const removedMessage = existingIndex >= 0 ? messages[existingIndex] : message;
    setMessages((current) => current.filter((item) => String(item.id) !== messageId));

    if (!sessionId || isDraftSession({ id: sessionId })) {
      return;
    }

    try {
      await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      setMessages((current) => {
        if (current.some((item) => String(item.id) === messageId)) {
          return current;
        }
        const next = [...current];
        const insertAt = existingIndex >= 0 ? Math.min(existingIndex, next.length) : next.length;
        next.splice(insertAt, 0, removedMessage);
        return next;
      });
      window.alert(`删除失败：${error.message}`);
    }
  }

  async function hideMessagesForEdit(sessionId, messagesToHide) {
    if (!sessionId || isDraftSession({ id: sessionId })) {
      return;
    }
    const ids = messagesToHide.map((item) => item.id).filter(Boolean);
    await Promise.all(
      ids.map((messageId) =>
        apiFetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(String(messageId))}`,
          { method: 'DELETE' }
        )
      )
    );
  }

  async function handleEditMessage(message, nextContent, { force = false } = {}) {
    const value = String(nextContent || '').trim();
    if (!message?.id || !value || (!force && value === String(message.content || '').trim())) {
      return;
    }

    const messageId = String(message.id);
    const sessionId = selectedSessionRef.current?.id || message.sessionId || '';
    const existingIndex = messages.findIndex((item) => String(item.id) === messageId);
    const editIndex = existingIndex >= 0 ? existingIndex : messages.length;
    const replacedMessages = existingIndex >= 0 ? messages.slice(editIndex) : [message];

    const editedMessage = {
      ...(existingIndex >= 0 ? messages[existingIndex] : message),
      id: messageId,
      role: 'user',
      content: value,
      timestamp: new Date().toISOString(),
      sessionId
    };
    const editedState = rememberEditedMessages(sessionId, replacedMessages, editedMessage);
    setMessages((current) => {
      const next = current.slice(0, Math.max(0, editIndex));
      next.push(editedMessage);
      return next;
    });

    try {
      await hideMessagesForEdit(sessionId, replacedMessages);
      await submitCodexMessage({
        message: value,
        attachmentsForTurn: [],
        clearComposer: false,
        userMessageId: messageId,
        contextMessages: codexContextBeforeMessage(messageId)
      });
    } catch (error) {
      forgetEditedMessages(sessionId, editedState.keys, editedState.replacementId);
      setMessages((current) => {
        const withoutRestored = current.filter(
          (item) =>
            String(item.id) !== messageId &&
            !replacedMessages.some((restored) => String(restored.id) === String(item.id))
        );
        const next = [...withoutRestored];
        next.splice(Math.min(editIndex, next.length), 0, ...replacedMessages);
        return next;
      });
      window.alert(`修改失败：${error.message}`);
    }
  }

  async function handleRegenerateMessage(message) {
    if (running) {
      window.alert('当前任务正在运行，请稍后再重新生成。');
      return;
    }
    const assistantIndex = messages.findIndex((item) => String(item.id) === String(message?.id));
    if (assistantIndex < 0) {
      return;
    }
    let userMessage = null;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user' && String(messages[index].content || '').trim()) {
        userMessage = messages[index];
        break;
      }
    }
    if (!userMessage) {
      window.alert('没有找到可重新生成的用户输入。');
      return;
    }
    await handleEditMessage(userMessage, userMessage.content, { force: true });
  }

  async function handleUploadFiles(files) {
    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiFetch('/api/uploads', {
          method: 'POST',
          body: formData
        });
        setAttachments((current) => [...current, result.upload]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `upload-error-${Date.now()}`,
          role: 'activity',
          content: error.message,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveAttachment(id) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function submitCodexMessage({
    message,
    attachmentsForTurn = [],
    clearComposer = false,
    restoreTextOnError = false,
    userMessageId = '',
    contextMessages = null,
    approvalSessionId = null,
    approvalPreviousSessionId = null,
    approvalProjectId = null
  }) {
    const project =
      (approvalProjectId && projects.find((item) => item.id === approvalProjectId)) ||
      selectedProject ||
      selectedProjectRef.current;
    const selectedAttachments = Array.isArray(attachmentsForTurn) ? attachmentsForTurn : [];
    const displayMessage = String(message || '').trim() || (selectedAttachments.length ? '请查看附件。' : '');
    if ((!displayMessage && !selectedAttachments.length) || !project) {
      if (restoreTextOnError && displayMessage) {
        restoreVoiceTextToInput(displayMessage);
      }
      throw new Error(project ? 'message or attachments are required' : '请先选择项目');
    }

    let sessionForTurn =
      approvalSessionId
        ? { ...(selectedSessionRef.current || {}), id: approvalSessionId, projectId: project.id, draft: false }
        : selectedSession;
    if (!sessionForTurn) {
      sessionForTurn = createDraftSession(project);
      setSelectedSession(sessionForTurn);
      setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
      setSessionsByProject((current) => upsertSessionInProject(current, project.id, sessionForTurn));
    }

    const turnId = createClientTurnId();
    const draftSessionId = approvalSessionId ? null : isDraftSession(sessionForTurn) ? sessionForTurn.id : null;
    const outgoingSessionId = draftSessionId ? null : sessionForTurn?.id || null;
    const optimisticSessionId = approvalSessionId || draftSessionId || outgoingSessionId || turnId;
    const previousSessionIdForTurn = approvalPreviousSessionId || draftSessionId || outgoingSessionId;
    const initialTitle = draftSessionId && !sessionForTurn.titleLocked
      ? titleFromFirstMessage(displayMessage)
      : null;

    if (clearComposer) {
      setInput('');
      setAttachments([]);
    }

    markRun({ turnId, sessionId: optimisticSessionId, previousSessionId: previousSessionIdForTurn });
    setSelectedSession((current) =>
      current?.id === sessionForTurn?.id
        ? { ...current, turnId, ...(initialTitle ? { title: initialTitle, titleLocked: true } : {}) }
        : current
    );
    if (initialTitle) {
      setSessionsByProject((current) => ({
        ...current,
        [project.id]: (current[project.id] || []).map((item) =>
          item.id === sessionForTurn.id ? { ...item, title: initialTitle, titleLocked: true } : item
        )
      }));
    }
    setMessages((current) => {
      const nextMessages = userMessageId
        ? current.map((item) =>
            String(item.id) === String(userMessageId)
              ? {
                  ...item,
                  content: displayMessage,
                  sessionId: optimisticSessionId,
                  turnId,
                  timestamp: item.timestamp || new Date().toISOString()
                }
              : item
          )
        : [
            ...current,
            {
              id: `local-${Date.now()}`,
              role: 'user',
              content: displayMessage,
              timestamp: new Date().toISOString(),
              sessionId: optimisticSessionId,
              turnId
            }
          ];
      return upsertStatusMessage(nextMessages, {
        sessionId: optimisticSessionId,
        turnId,
        kind: 'reasoning',
        status: 'running',
        label: '正在思考中',
        timestamp: new Date().toISOString()
      });
    });
    if (userMessageId) {
      updateEditedReplacementTurn(sessionForTurn.id, userMessageId, {
        sessionId: optimisticSessionId,
        turnId
      });
    }

    try {
      const result = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: {
          projectId: project.id,
          sessionId: outgoingSessionId,
          draftSessionId,
          clientTurnId: turnId,
          message: displayMessage,
          permissionMode,
          model: selectedModel || status.model,
          reasoningEffort: selectedReasoningEffort || status.reasoningEffort || DEFAULT_REASONING_EFFORT,
          attachments: selectedAttachments,
          contextMessages
        }
      });
      pollTurnUntilComplete({
        turnId: result.turnId || turnId,
        optimisticSessionId,
        projectId: project.id,
        previousSessionId: previousSessionIdForTurn
      });
      return {
        turnId: result.turnId || turnId,
        optimisticSessionId,
        projectId: project.id,
        previousSessionId: previousSessionIdForTurn
      };
    } catch (error) {
      clearRun({ turnId, sessionId: optimisticSessionId, previousSessionId: previousSessionIdForTurn });
      if (clearComposer) {
        setAttachments(selectedAttachments);
      }
      if (restoreTextOnError) {
        restoreVoiceTextToInput(displayMessage);
      }
      setMessages((current) =>
        upsertStatusMessage(current, {
          sessionId: optimisticSessionId,
          turnId,
          kind: 'turn',
          status: 'failed',
          label: '发送失败',
          detail: error.message,
          timestamp: new Date().toISOString()
        })
      );
      throw error;
    }
  }

  const { handleVoiceSubmit } = useVoiceInput({ submitCodexMessage });

  async function handleSubmit() {
    const message = input.trim();
    if ((!message && !attachments.length) || !selectedProject) {
      return;
    }
    try {
      await submitCodexMessage({
        message,
        attachmentsForTurn: attachments,
        clearComposer: true
      });
    } catch {
      // submitCodexMessage already reflects the failure in the chat UI.
    }
    return;
  }

  function restoreVoiceTextToInput(text) {
    const value = String(text || '').trim();
    if (!value) {
      return;
    }
    setInput((current) => {
      const base = String(current || '').trimEnd();
      if (!base) {
        return value;
      }
      if (base.includes(value)) {
        return current;
      }
      return `${base}\n${value}`;
    });
  }

  async function handleAbort() {
    const abortId =
      selectedSessionRef.current?.id ||
      selectedSessionRef.current?.turnId ||
      Object.keys(runningById)[0];
    if (!abortId) {
      return;
    }
    await apiFetch('/api/chat/abort', {
      method: 'POST',
      body: { sessionId: abortId, turnId: selectedSessionRef.current?.turnId || null }
    }).catch(() => null);
    const payload = { sessionId: abortId, turnId: selectedSessionRef.current?.turnId || null };
    clearRun(payload);
    setMessages((current) => finishActivityMessagesForTurn(current, payload));
  }

  const shellClass = useMemo(() => (drawerOpen ? 'app-shell drawer-active' : 'app-shell'), [drawerOpen]);

  if (!authenticated) {
    return <PairingScreen onPaired={bootstrap} />;
  }

  return (
    <div className={shellClass}>
      <TopBar
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        connectionState={connectionState}
        onMenu={() => setDrawerOpen(true)}
        onOpenDocs={() => setDocsOpen(true)}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projects={projects}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        expandedProjectIds={expandedProjectIds}
        sessionsByProject={sessionsByProject}
        loadingProjectId={loadingProjectId}
        onToggleProject={handleToggleProject}
        onSelectSession={handleSelectSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onNewConversation={handleNewConversation}
        onSync={handleSync}
        syncing={syncing}
        theme={theme}
        setTheme={setTheme}
      />
      <DocsPanel
        open={docsOpen}
        docs={status.docs}
        busy={docsBusy}
        error={docsError}
        onClose={() => setDocsOpen(false)}
        onConnect={handleConnectDocs}
        onDisconnect={handleDisconnectDocs}
        onOpenHome={handleOpenDocsHome}
        onOpenAuth={handleOpenDocsAuth}
        onRefresh={handleRefreshDocs}
      />
      <ChatPane
        messages={messages}
        selectedSession={selectedSession}
        running={running}
        onPreviewImage={setPreviewImage}
        onDeleteMessage={handleDeleteMessage}
        onEditMessage={handleEditMessage}
        onRegenerateMessage={handleRegenerateMessage}
      />
      <VoiceDialogPanel
        open={voiceDialogOpen}
        state={voiceDialogState}
        error={voiceDialogError}
        transcript={voiceDialogTranscript}
        assistantText={voiceDialogAssistantText}
        handoffDraft={voiceDialogHandoffDraft}
        onHandoffDraftChange={setVoiceDialogHandoffDraftValue}
        onHandoffSubmit={submitVoiceHandoffToCodex}
        onHandoffContinue={continueVoiceHandoffCollection}
        onHandoffCancel={cancelVoiceHandoffConfirmation}
        onStart={startVoiceDialogRecording}
        onStop={stopVoiceDialogRecording}
        onClose={closeVoiceDialog}
      />
      <Composer
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        running={running}
        onAbort={handleAbort}
        models={status.models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        selectedReasoningEffort={selectedReasoningEffort}
        onSelectReasoningEffort={setSelectedReasoningEffort}
        permissionMode={permissionMode}
        onSelectPermission={setPermissionMode}
        attachments={attachments}
        onUploadFiles={handleUploadFiles}
        onRemoveAttachment={handleRemoveAttachment}
        uploading={uploading}
        onVoiceSubmit={handleVoiceSubmit}
        onOpenVoiceDialog={openVoiceDialog}
        voiceDialogActive={voiceDialogOpen}
      />
      <ApprovalSheet
        request={approvalRequest}
        busy={approvalBusy}
        onApprove={() => respondToApproval(approvalRequest, true, false)}
        onAlwaysAllow={() => respondToApproval(approvalRequest, true, true)}
        onDeny={() => respondToApproval(approvalRequest, false, false)}
      />
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
  );
}
