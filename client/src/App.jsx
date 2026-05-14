import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, clearToken, getToken } from './api.js';
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_STATUS,
  activityStepFromPayload,
  completeStatusMessage,
  finishActivityMessagesForTurn,
  hasRunningKey,
  isDraftSession,
  mergeActivityStep,
  payloadRunKeys,
  realtimePayloadErrorMessage,
  selectedRunKeys,
  upsertActivityMessage,
  upsertAssistantMessage,
  upsertSessionInProject,
  upsertStatusMessage,
  voiceDialogStatusLabel
} from './app-helpers.js';
import {
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
import { useCodexSocket } from './hooks/useCodexSocket.js';
import { useDocsStatus } from './hooks/useDocsStatus.js';
import { useProjects } from './hooks/useProjects.js';
import { useTheme } from './hooks/useTheme.js';
import { useViewportKeyboard } from './hooks/useViewportKeyboard.js';
import { useVoiceInput } from './hooks/useVoiceInput.js';
import { useChatTurns } from './hooks/useChatTurns.js';
import { useVoiceDialog } from './hooks/useVoiceDialog.js';

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
    pollTurnUntilComplete,
    handleAbort,
    submitCodexMessage
  } = useChatTurns({
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    filterEditedMessages,
    model: selectedModel || status.model,
    payloadMatchesCurrentConversation,
    permissionMode,
    projects,
    reasoningEffort: selectedReasoningEffort || status.reasoningEffort,
    selectedProject,
    selectedProjectRef,
    selectedSessionRef,
    setAttachments,
    setExpandedProjectIds,
    setInput,
    setMessages,
    setSelectedSession,
    setSessionsByProject,
    updateEditedReplacementTurn
  });
  const running =
    hasRunningKey(runningById, selectedRunKeys(selectedSession)) ||
    messages.some((message) => message.role === 'activity' && (message.status === 'running' || message.status === 'queued'));

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

  const { handleVoiceSubmit } = useVoiceInput({ submitCodexMessage });
  const {
    voiceDialogOpen,
    voiceDialogState,
    voiceDialogError,
    voiceDialogTranscript,
    voiceDialogAssistantText,
    voiceDialogHandoffDraft,
    setVoiceDialogHandoffDraftValue,
    submitVoiceHandoffToCodex,
    continueVoiceHandoffCollection,
    cancelVoiceHandoffConfirmation,
    startVoiceDialogRecording,
    stopVoiceDialogRecording,
    closeVoiceDialog,
    openVoiceDialog
  } = useVoiceDialog({
    handleVoiceSubmit,
    messages,
    runningById,
    selectedProject,
    selectedProjectRef,
    status,
    submitCodexMessage
  });

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
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
  );
}
