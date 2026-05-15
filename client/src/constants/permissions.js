export const APPROVAL_PROMPT_PATTERN =
  /(拟执行操作清单|需要授权|请求授权|请明确回复|同意执行|批准执行|approve|approval|permission)/i;
export const APPROVAL_ALLOW_KEY = 'codexmobile.approvalAlwaysAllow';

export const PERMISSION_OPTIONS = [
  { value: 'default', label: '默认权限' },
  { value: 'bypassPermissions', label: '完全访问权限', danger: true },
  { value: 'customConfig', label: '自定义（config.toml）' }
];

export const REASONING_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' }
];
