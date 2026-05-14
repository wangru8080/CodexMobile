# 第三阶段 Hooks 拆分跟踪

本文档用于跟踪 `App.jsx` 第三阶段 hooks 拆分进度，避免分批执行后遗忘当前状态。

## 总原则

- 每批只拆一个相对独立的状态域。
- 每批完成后必须运行 `npm run build`。
- 每批完成后创建一个清晰的本地 commit。
- 不把半成品 hook 接入主流程。
- 如果某批拆分风险变高，先停止并保留原逻辑。
- 不改变后端 API、UI 样式语义和现有交互行为。

## 当前进度

- 第一阶段：常量与工具函数拆分，已完成。
- 第二阶段：UI 组件拆分，已完成。
- 第三阶段：hooks 拆分，进行中；第 3.1、3.2、3.3、3.4 批已完成，第 3.5 第一批已完成。

## 第 3.1 批：偏好与 UI 环境状态

状态：已完成

目标：拆分低风险、偏 UI 环境的状态逻辑，不触碰聊天核心链路。

拟新增文件：

- `client/src/hooks/useTheme.js`
- `client/src/hooks/useReasoningPreference.js`
- `client/src/hooks/useViewportKeyboard.js`

拟迁移内容：

- 主题读取、保存和 `document.documentElement.dataset.theme` 同步。
- 推理强度偏好读取、默认版本迁移和保存。
- 移动端键盘/视口高度相关 `visualViewport` 监听。

验收标准：

- `App.jsx` 中相关 `useState` / `useEffect` 明显减少。
- 主题切换行为不变。
- 推理强度默认值和本地保存行为不变。
- iPhone 键盘弹出时布局行为不变。
- `npm run build` 通过。

## 第 3.2 批：文档状态与项目会话加载

状态：已完成

目标：拆分中低风险的数据加载逻辑。

拟新增文件：

- `client/src/hooks/useDocsStatus.js`
- `client/src/hooks/useProjects.js`

拟迁移内容：

- 飞书文档状态刷新、连接、断开、打开授权页等逻辑。
- 项目列表加载、项目展开、会话列表加载、同步刷新。

验收标准：

- 项目抽屉加载、展开、切换行为不变。
- 飞书面板状态、连接和刷新行为不变。
- `npm run build` 通过。

## 第 3.3 批：WebSocket 与审批状态

状态：已完成

目标：拆分中风险副作用逻辑，保持实时状态更新行为不变。

拟新增文件：

- `client/src/hooks/useCodexSocket.js`
- `client/src/hooks/useApprovals.js`

拟迁移内容：

- WebSocket 连接、重连、消息分发入口。
- 连接状态维护。
- 审批请求识别、总是允许列表、批准/拒绝处理。

验收标准：

- 连接状态显示不变。
- Codex 运行状态实时更新不变。
- 审批弹窗、批准、总是允许、拒绝行为不变。
- `npm run build` 通过。

## 第 3.4 批：聊天 Turn 与普通语音输入

状态：已完成

目标：拆分聊天核心逻辑，风险较高，必须小步提交。

拟新增文件：

- `client/src/hooks/useChatTurns.js`
- `client/src/hooks/useVoiceInput.js`

拟迁移内容：

- 发送消息、草稿会话、turn 轮询、消息刷新、终止任务。
- 普通录音、转写、语音提交。

验收标准：

- 新对话、续聊、编辑、重新生成、删除消息行为不变。
- 任务完成/失败/中止后的消息刷新行为不变。
- 普通语音输入行为不变。
- `npm run build` 通过。

## 第 3.5 批：实时语音对话

状态：已完成（已抽取语音对话整体 hook、实时音频播放 hook、实时麦克风 hook 和 handoff hook）

目标：拆分最高风险的实时语音逻辑，必要时再细分为多批。

拟新增文件：

- `client/src/hooks/useVoiceDialog.js`
- 可选：`client/src/hooks/useRealtimeVoice.js`
- `client/src/hooks/useRealtimePlayback.js`
- `client/src/hooks/useRealtimeMicrophone.js`
- 可选：`client/src/hooks/useRealtimeAudioPlayback.js`
- `client/src/hooks/useVoiceHandoff.js`

拟迁移内容：

- 实时语音 WebSocket。
- 麦克风 PCM 采集和下采样。
- 音频播放队列。
- 打断、静音检测、handoff 总结。

验收标准：

- 实时语音连接、说话、回复播放行为不变。
- “总结一下交给 Codex”流程不变。
- 关闭面板后麦克风、音频上下文、WebSocket 均正确释放。
- `npm run build` 通过。

## 每批完成记录

### 3.1 偏好与 UI 环境状态

- 状态：已完成
- 完成时间：2026-05-14 14:20:00 CST
- Commit：dd9f683
- 验证命令：`npm run build` 通过
- 备注：新增 `useTheme`、`useReasoningPreference`、`useViewportKeyboard`，并接入 `App.jsx`。

### 3.2 文档状态与项目会话加载

- 状态：已完成
- 完成时间：2026-05-14 14:29:56 CST
- Commit：840045c
- 验证命令：`npm run build` 通过
- 备注：新增 `useDocsStatus`、`useProjects`，迁移飞书面板处理、项目/会话加载、抽屉会话操作。

### 3.3 WebSocket 与审批状态

- 状态：已完成
- 完成时间：2026-05-14 14:38:57 CST
- Commit：67d0988
- 验证命令：`npm run build` 通过
- 备注：新增 `useApprovals`、`useCodexSocket`，迁移审批状态、自动允许、审批回复、WebSocket 连接/重连生命周期。

### 3.4 聊天 Turn 与普通语音输入

- 状态：已完成
- 完成时间：2026-05-14 15:23:00 CST
- Commit：fcc6e39、6563b7e、8307a96、3298f67、b7be374、本次提交
- 验证命令：`npm run build` 通过
- 备注：3.4a 新增 `useVoiceInput`，迁移普通语音提交入口；3.4b 新增 `useChatTurns`，已迁移运行状态、运行 ref、轮询集合、刷新定时器清理、完成后消息刷新、完成状态更新、turn 会话绑定、turn 消息加载、轮询、中止任务、消息提交和语音失败回填。

### 3.5 实时语音对话

- 状态：已完成
- 完成时间：2026-05-14 15:40:00 CST
- Commit：本次提交
- 验证命令：`npm run build` 通过
- 备注：第一批新增 `useVoiceDialog`，整体迁移语音对话状态、普通语音对话录音/TTS、实时语音 WebSocket、PCM 采集、播放队列、打断、静音检测和 handoff 总结；第二批新增 `useRealtimePlayback`，迁移实时音频播放队列、播放 AudioContext 和 PCM 播放；第三批新增 `useRealtimeMicrophone`，迁移实时麦克风 PCM 采集、下采样、客户端 VAD、打断检测和麦克风资源释放；第四批新增 `useVoiceHandoff`，迁移 handoff 文本缓存、总结请求、确认/取消和提交给 Codex 的逻辑。
