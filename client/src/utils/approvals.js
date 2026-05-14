import { APPROVAL_PROMPT_PATTERN } from '../constants/permissions.js';

export function normalizeApprovalSignature(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/\s+/g, ' '))
    .replace(/\bturn-[a-z0-9-]+\b/gi, 'turn')
    .replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, 'timestamp')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

export function approvalKindFromText(text) {
  const value = String(text || '');
  if (/apply_patch|补丁|修改文件|写入|覆盖|重命名|移动|删除|文件/.test(value)) {
    return '文件操作';
  }
  if (/curl|wget|网络|联网|http|https|下载|访问互联网/i.test(value)) {
    return '网络访问';
  }
  if (/命令|command|shell|bash|npm|node|python|git/i.test(value)) {
    return '命令执行';
  }
  return '工具调用';
}

export function approvalRiskFromText(text) {
  const value = String(text || '');
  if (/danger-full-access|完全访问|bypass|sudo|\/volume2\/SSD\/Trash|删除|rm\s+-|overwrite|覆盖/i.test(value)) {
    return '高风险操作，请确认目标和影响范围。';
  }
  if (/curl|wget|http|https|下载|网络|互联网/i.test(value)) {
    return '该操作会访问网络或外部服务。';
  }
  if (/写入|修改|patch|apply_patch|move|rename|重命名|移动/i.test(value)) {
    return '该操作可能修改本地文件。';
  }
  return '';
}

export function detectApprovalRequest(payload) {
  const content = [payload?.content, payload?.label, payload?.detail]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!content || !APPROVAL_PROMPT_PATTERN.test(content)) {
    return null;
  }
  if (!/(请|是否|同意|批准|授权|approve|confirm|allow|deny|拒绝)/i.test(content)) {
    return null;
  }
  return {
    id: `${payload.turnId || 'turn'}:${payload.messageId || Date.now()}`,
    turnId: payload.turnId,
    sessionId: payload.sessionId,
    previousSessionId: payload.previousSessionId,
    projectId: payload.projectId,
    title: approvalKindFromText(content),
    detail: content,
    risk: approvalRiskFromText(content),
    signature: normalizeApprovalSignature(content)
  };
}
