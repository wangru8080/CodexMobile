import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import {
  createClientTurnId,
  createDraftSession,
  hasAssistantMessageForTurn,
  finishActivityMessagesForTurn,
  hasVisibleAssistantForTurn,
  payloadRunKeys,
  removeActivityMessagesForTurn,
  titleFromFirstMessage,
  upsertSessionInProject,
  upsertStatusMessage
} from '../app-helpers.js';

export function useChatTurns({
  defaultReasoningEffort,
  filterEditedMessages,
  model,
  payloadMatchesCurrentConversation,
  permissionMode,
  projects,
  reasoningEffort,
  selectedSessionRef,
  selectedProject,
  selectedProjectRef,
  setAttachments,
  setExpandedProjectIds,
  setInput,
  setMessages,
  setSelectedSession,
  setSessionsByProject,
  updateEditedReplacementTurn
} = {}) {
  const [runningById, setRunningById] = useState({});
  const runningByIdRef = useRef({});
  const lastLocalRunAtRef = useRef(0);
  const activePollsRef = useRef(new Set());
  const turnRefreshTimersRef = useRef(new Map());

  function markRun(payload) {
    const keys = payloadRunKeys(payload);
    if (!keys.length) {
      return;
    }
    lastLocalRunAtRef.current = Date.now();
    setRunningById((current) => {
      const next = { ...current };
      for (const key of keys) {
        next[key] = true;
      }
      runningByIdRef.current = next;
      return next;
    });
  }

  function clearRun(payload) {
    const keys = payloadRunKeys(payload);
    if (!keys.length) {
      return;
    }
    setRunningById((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      runningByIdRef.current = next;
      return next;
    });
  }

  function clearTurnRefreshTimer(turnId) {
    if (!turnId) {
      return;
    }
    const timer = turnRefreshTimersRef.current.get(turnId);
    if (timer) {
      window.clearTimeout(timer);
      turnRefreshTimersRef.current.delete(turnId);
    }
  }

  async function refreshMessagesForPayload(payload) {
    if (!payload?.sessionId || !payloadMatchesCurrentConversation?.(payload)) {
      return false;
    }
    try {
      const data = await apiFetch(`/api/sessions/${encodeURIComponent(payload.sessionId)}/messages?limit=120`);
      if (data.messages?.length && hasVisibleAssistantForTurn(data.messages, payload)) {
        setMessages(filterEditedMessages(payload.sessionId, data.messages));
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function finalizeTurnWithoutAssistant(payload) {
    if (!payload?.turnId) {
      return;
    }
    clearTurnRefreshTimer(payload.turnId);
    setMessages((current) =>
      upsertStatusMessage(current, {
        ...payload,
        status: 'completed',
        label: '任务已完成',
        detail: payload.error || payload.detail || ''
      })
    );
    clearRun(payload);
  }

  function markTurnCompleted(payload, detail = '结果同步中') {
    if (!payload?.turnId) {
      return;
    }
    setMessages((current) => {
      if (hasAssistantMessageForTurn(current, payload)) {
        return removeActivityMessagesForTurn(current, payload);
      }
      return upsertStatusMessage(current, {
        ...payload,
        kind: 'turn',
        status: 'running',
        label: '正在思考中',
        detail
      });
    });
  }

  function scheduleTurnRefresh(payload, attempt = 0) {
    const turnId = payload?.turnId;
    if (!turnId || !payload?.sessionId || !payloadMatchesCurrentConversation?.(payload)) {
      return;
    }
    clearTurnRefreshTimer(turnId);
    const delays = [300, 800, 1500, 2500, 4000, 6500, 10000, 15000, 22000, 30000, 30000];
    const delay = delays[attempt];
    if (delay === undefined) {
      finalizeTurnWithoutAssistant(payload);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!payloadMatchesCurrentConversation?.(payload)) {
        return;
      }
      const loaded = await refreshMessagesForPayload(payload);
      if (loaded) {
        clearTurnRefreshTimer(turnId);
        clearRun(payload);
        return;
      }
      scheduleTurnRefresh(payload, attempt + 1);
    }, delay);
    turnRefreshTimersRef.current.set(turnId, timer);
  }


  function turnMatchesCurrentSelection(turnId, optimisticSessionId, realSessionId, previousSessionId) {
    const current = selectedSessionRef?.current;
    if (!current) {
      return true;
    }
    return (
      current.id === optimisticSessionId ||
      current.id === realSessionId ||
      current.id === previousSessionId ||
      current.turnId === turnId ||
      current.draft
    );
  }

  function applyTurnSession(turn, optimisticSessionId, projectId, previousSessionId) {
    const sessionIdText = String(turn.sessionId || '');
    const realSessionId =
      sessionIdText && !sessionIdText.startsWith('draft-') && !sessionIdText.startsWith('codex-')
        ? sessionIdText
        : null;
    if (!realSessionId) {
      return null;
    }

    const currentSession = selectedSessionRef?.current;
    const nextSession = {
      ...(currentSession || {}),
      id: realSessionId,
      projectId,
      title: currentSession?.title || '新对话',
      updatedAt: turn.completedAt || turn.updatedAt || new Date().toISOString(),
      draft: false
    };

    setSelectedSession((current) => {
      if (!current) {
        return nextSession;
      }
      if (!turnMatchesCurrentSelection(turn.turnId, optimisticSessionId, realSessionId, previousSessionId)) {
        return current;
      }
      return { ...current, ...nextSession };
    });
    setSessionsByProject((current) =>
      upsertSessionInProject(current, projectId, nextSession, previousSessionId || optimisticSessionId)
    );
    setMessages((current) =>
      current.map((message) =>
        message.turnId === turn.turnId || message.sessionId === optimisticSessionId || message.sessionId === previousSessionId
          ? { ...message, sessionId: realSessionId }
          : message
      )
    );
    return realSessionId;
  }

  async function loadTurnMessages(realSessionId, turnId, optimisticSessionId, previousSessionId) {
    if (!realSessionId) {
      return false;
    }
    const current = selectedSessionRef?.current;
    if (
      current &&
      current.id !== realSessionId &&
      current.id !== optimisticSessionId &&
      current.id !== previousSessionId &&
      current.turnId !== turnId
    ) {
      return false;
    }
    const data = await apiFetch(`/api/sessions/${encodeURIComponent(realSessionId)}/messages?limit=120`);
    if (data.messages?.length && hasVisibleAssistantForTurn(data.messages, { turnId })) {
      setMessages(filterEditedMessages(realSessionId, data.messages));
      return true;
    }
    return false;
  }

  async function pollTurnUntilComplete({ turnId, optimisticSessionId, projectId, previousSessionId }) {
    if (!turnId || activePollsRef.current.has(turnId)) {
      return;
    }
    activePollsRef.current.add(turnId);
    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < 1800000) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        let turn = null;
        try {
          const result = await apiFetch(`/api/chat/turns/${encodeURIComponent(turnId)}`);
          turn = result.turn;
        } catch {
          continue;
        }
        if (!turn) {
          continue;
        }

        const realSessionId = applyTurnSession(turn, optimisticSessionId, projectId, previousSessionId);
        if (turn.status === 'failed') {
          clearRun({ turnId, sessionId: realSessionId || optimisticSessionId, previousSessionId });
          setMessages((current) =>
            upsertStatusMessage(current, {
              sessionId: realSessionId || optimisticSessionId,
              turnId,
              kind: 'turn',
              status: 'failed',
              label: '任务失败',
              detail: turn.error || turn.detail || '任务失败'
            })
          );
          break;
        }
        if (turn.status === 'aborted') {
          clearRun({ turnId, sessionId: realSessionId || optimisticSessionId, previousSessionId });
          setMessages((current) =>
            upsertStatusMessage(current, {
              sessionId: realSessionId || optimisticSessionId,
              turnId,
              kind: 'turn',
              status: 'completed',
              label: '已中止'
            })
          );
          break;
        }
        if (turn.status === 'completed') {
          const terminalPayload = {
            sessionId: realSessionId || optimisticSessionId,
            turnId,
            previousSessionId,
            detail: turn.detail || ''
          };
          markTurnCompleted(terminalPayload);
          const loaded = await loadTurnMessages(realSessionId, turnId, optimisticSessionId, previousSessionId);
          if (loaded) {
            clearRun(terminalPayload);
          } else {
            scheduleTurnRefresh({
              sessionId: realSessionId || optimisticSessionId,
              turnId,
              previousSessionId,
              hadAssistantText: turn.hadAssistantText || Boolean(turn.assistantPreview),
              usage: turn.usage || null
            });
          }
          break;
        }
      }
    } finally {
      activePollsRef.current.delete(turnId);
    }
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
      return `${base}
${value}`;
    });
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
      selectedProjectRef?.current;
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
        ? { ...(selectedSessionRef?.current || {}), id: approvalSessionId, projectId: project.id, draft: false }
        : selectedSessionRef?.current;
    if (!sessionForTurn) {
      sessionForTurn = createDraftSession(project);
      setSelectedSession(sessionForTurn);
      setExpandedProjectIds((current) => ({ ...current, [project.id]: true }));
      setSessionsByProject((current) => upsertSessionInProject(current, project.id, sessionForTurn));
    }

    const turnId = createClientTurnId();
    const draftSessionId = approvalSessionId
      ? null
      : (sessionForTurn?.draft || sessionForTurn?.id?.startsWith?.('draft-'))
        ? sessionForTurn.id
        : null;
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
          model,
          reasoningEffort: reasoningEffort || defaultReasoningEffort,
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

  async function handleAbort() {
    const abortId =
      selectedSessionRef?.current?.id ||
      selectedSessionRef?.current?.turnId ||
      Object.keys(runningByIdRef.current)[0];
    if (!abortId) {
      return;
    }
    await apiFetch('/api/chat/abort', {
      method: 'POST',
      body: { sessionId: abortId, turnId: selectedSessionRef?.current?.turnId || null }
    }).catch(() => null);
    const payload = { sessionId: abortId, turnId: selectedSessionRef?.current?.turnId || null };
    clearRun(payload);
    setMessages((current) => finishActivityMessagesForTurn(current, payload));
  }

  useEffect(
    () => () => {
      for (const timer of turnRefreshTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      turnRefreshTimersRef.current.clear();
    },
    []
  );

  return {
    runningById,
    setRunningById,
    runningByIdRef,
    lastLocalRunAtRef,
    activePollsRef,
    turnRefreshTimersRef,
    markRun,
    clearRun,
    clearTurnRefreshTimer,
    refreshMessagesForPayload,
    finalizeTurnWithoutAssistant,
    markTurnCompleted,
    scheduleTurnRefresh,
    turnMatchesCurrentSelection,
    applyTurnSession,
    loadTurnMessages,
    pollTurnUntilComplete,
    handleAbort,
    restoreVoiceTextToInput,
    submitCodexMessage
  };
}
