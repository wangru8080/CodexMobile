import { useRef, useState } from 'react';

export function useVoiceHandoff({
  closeVoiceDialog,
  selectedProject,
  selectedProjectRef,
  setVoiceDialogAssistantText,
  setVoiceDialogError,
  setVoiceDialogErrorBriefly,
  setVoiceDialogMode,
  stopRealtimePlayback,
  submitCodexMessage,
  voiceRealtimeAssistantTextRef,
  voiceRealtimeAwaitingResponseRef,
  voiceRealtimeBargeInStartedAtRef,
  voiceRealtimeSocketRef,
  voiceRealtimeSuppressAssistantAudioRef
}) {
  const voiceDialogIdeaBufferRef = useRef([]);
  const voiceDialogHandoffDraftRef = useRef('');
  const [voiceDialogHandoffDraft, setVoiceDialogHandoffDraft] = useState('');

  function setVoiceDialogHandoffDraftValue(next) {
    const value = String(next || '');
    voiceDialogHandoffDraftRef.current = value;
    setVoiceDialogHandoffDraft(value);
  }

  function clearVoiceHandoffState() {
    voiceDialogIdeaBufferRef.current = [];
    setVoiceDialogHandoffDraftValue('');
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
      clearVoiceHandoffState();
      closeVoiceDialog();
    } catch (error) {
      setVoiceDialogError(error.message || '发送给 Codex 失败');
      setVoiceDialogMode('handoff');
    }
  }

  return {
    appendVoiceDialogIdeaTranscript,
    cancelVoiceHandoffConfirmation,
    clearVoiceHandoffState,
    continueVoiceHandoffCollection,
    requestVoiceHandoffSummary,
    setVoiceDialogHandoffDraftValue,
    submitVoiceHandoffToCodex,
    voiceDialogHandoffDraft
  };
}
