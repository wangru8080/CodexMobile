import { useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import { APPROVAL_ALLOW_KEY, detectApprovalRequest } from '../app-helpers.js';

export function useApprovals({ clearRun, submitCodexMessage }) {
  const [approvalRequest, setApprovalRequest] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalAlwaysAllow, setApprovalAlwaysAllow] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(APPROVAL_ALLOW_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const approvalRequestRef = useRef(null);
  const approvalAlwaysAllowRef = useRef(approvalAlwaysAllow);

  function rememberAlwaysAllow(signature) {
    if (!signature) {
      return;
    }
    setApprovalAlwaysAllow((current) => {
      const next = [signature, ...current.filter((item) => item !== signature)].slice(0, 50);
      approvalAlwaysAllowRef.current = next;
      localStorage.setItem(APPROVAL_ALLOW_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function stopApprovalBlockedTurn(request) {
    const turnId = request?.turnId;
    if (!turnId) {
      return;
    }
    try {
      await apiFetch('/api/chat/abort', {
        method: 'POST',
        body: { turnId, sessionId: request.sessionId || null }
      });
    } catch {
      // The original turn may have already completed after asking in natural language.
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      try {
        const result = await apiFetch(`/api/chat/turns/${encodeURIComponent(turnId)}`);
        const status = result.turn?.status;
        if (!status || !['accepted', 'queued', 'running'].includes(status)) {
          clearRun({ turnId, sessionId: request.sessionId, previousSessionId: request.previousSessionId });
          return;
        }
      } catch {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    }
  }

  async function respondToApproval(request, approved, alwaysAllow = false) {
    if (!request || approvalBusy) {
      return;
    }
    setApprovalBusy(true);
    try {
      if (alwaysAllow) {
        rememberAlwaysAllow(request.signature);
      }
      const message = approved
        ? '同意执行。请继续，并只执行你刚才请求授权的操作。'
        : '拒绝执行。请不要执行刚才请求授权的操作，改用不需要该授权的方式或说明原因。';
      setApprovalRequest(null);
      approvalRequestRef.current = null;
      await stopApprovalBlockedTurn(request);
      await submitCodexMessage({
        message,
        clearComposer: false,
        approvalSessionId: request.sessionId,
        approvalPreviousSessionId: request.previousSessionId,
        approvalProjectId: request.projectId
      });
    } finally {
      setApprovalBusy(false);
    }
  }

  function maybeShowApprovalRequest(payload) {
    const request = detectApprovalRequest(payload);
    if (!request || approvalRequestRef.current?.id === request.id) {
      return;
    }
    if (approvalAlwaysAllowRef.current.includes(request.signature)) {
      respondToApproval(request, true, false).catch(() => null);
      return;
    }
    approvalRequestRef.current = request;
    setApprovalRequest(request);
  }

  return {
    approvalRequest,
    approvalBusy,
    approvalAlwaysAllow,
    approvalRequestRef,
    approvalAlwaysAllowRef,
    rememberAlwaysAllow,
    respondToApproval,
    maybeShowApprovalRequest,
    stopApprovalBlockedTurn
  };
}
