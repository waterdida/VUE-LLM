<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
  watchEffect,
} from "vue";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { markdownItTable } from "markdown-it-table";
import {
  CopyDocument,
  EditPen,
  Close,
  Delete,
  RefreshRight,
  DocumentCopy,
} from "@element-plus/icons-vue";
import { chatStream } from "@/apis/deepseek";
import AttachmentPreview from "@/components/chat/AttachmentPreview.vue";
import ChatInput from "@/components/chat/ChatInput.vue";
import { useSessionStore } from "@/stores/session";
import assistantAvatar from "@/assets/avatars/assistant.svg";
import userAvatar from "@/assets/avatars/user.svg";

defineOptions({ name: "ChatMessage" });

const sessionStore = useSessionStore();
const msg = ref("");
const isTyping = ref(false);
const showNewMessageIndicator = ref(false);

const selectedModel = computed({
  get: () => sessionStore.model,
  set: (value) => sessionStore.setModel(value),
});

const modelOptions = computed(() => sessionStore.modelOptions);
const shouldUseReasoner = computed(() => selectedModel.value === "deepseek-reasoner");

/**
 * 读取当前会话的消息记录，并保持响应式更新。
 */
const messages = computed(() => sessionStore.getcurmsgs());
/**
 * 深度推理模型的思考链内容，按会话隔离。
 */
const reasoningList = computed(() => sessionStore.reason[sessionStore.curname] ?? []);
/**
 * 控制每条思考链是否展开显示。
 */
const reasonVisibility = computed(() => sessionStore.showreason[sessionStore.curname] ?? []);

watch(
  () => sessionStore.curname,
  async () => {
    // 切换会话后自动回到底部并隐藏“新消息”提示
    autoScroll = true;
    showNewMessageIndicator.value = false;
    await forceScrollToBottom();
  },
);

/**
 * 配置 Markdown 渲染器，支持代码高亮、表格等格式。
 */
const md = new MarkdownIt({
  highlight: (code, lang) => {
    const validLang = !!(lang && hljs.getLanguage(lang));
    const highlighted = validLang
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;
    return `<pre><code class="hljs ${validLang ? `language-${lang}` : ""}">${highlighted}</code></pre>`;
  },
  html: true,
  linkify: true,
  breaks: true,
  typographer: true,
  tables: true,
});

md.use(markdownItTable);

const CHAT_CONTAINER_SELECTOR = ".content";
const CHAT_EVENTS = ["wheel", "touchstart", "mousedown", "keydown"];

const getChatContainer = () => document.querySelector(CHAT_CONTAINER_SELECTOR);

/**
 * 强制滚动到底部，用于会话切换或初始化场景。
 */
const forceScrollToBottom = async () => {
  await nextTick();
  const container = getChatContainer();
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
};

let autoScroll = true;

const scrollToBottom = () => {
  if (!autoScroll) return;
  nextTick(() => {
    const container = getChatContainer();
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });
};

const scrollToBottomOnClick = () => {
  autoScroll = true;
  showNewMessageIndicator.value = false;
  scrollToBottom();
};

/**
 * 用户滚动、键盘等操作会取消自动滚动，避免打断阅读。
 */
const handleUserInteraction = () => {
  autoScroll = false;
  if (isTyping.value) {
    showNewMessageIndicator.value = true;
  }
};

const handleScroll = () => {
  const container = getChatContainer();
  if (!container) return;
  const { scrollTop, scrollHeight, clientHeight } = container;
  if (scrollTop + clientHeight < scrollHeight - 10) {
    autoScroll = false;
    if (isTyping.value) {
      showNewMessageIndicator.value = true;
    }
  } else {
    autoScroll = true;
    showNewMessageIndicator.value = false;
  }
};

const registerChatListeners = () => {
  const container = getChatContainer();
  if (!container) return;
  CHAT_EVENTS.forEach((event) =>
    container.addEventListener(event, handleUserInteraction, { passive: true }),
  );
  container.addEventListener("scroll", handleScroll, { passive: true });
};

const removeChatListeners = () => {
  const container = getChatContainer();
  if (!container) return;
  CHAT_EVENTS.forEach((event) => container.removeEventListener(event, handleUserInteraction));
  container.removeEventListener("scroll", handleScroll);
};

const pendingDeltas = ref("");
let rafId = null;
let lastFlushTime = 0;
const MIN_FLUSH_INTERVAL = 60;

/**
 * 累积模型返回的增量内容，使用 requestAnimationFrame 与最小间隔节流，实现逐字流畅输出。
 */
const flushBuffer = () => {
  if (!pendingDeltas.value) return;
  sessionStore.adddelta(pendingDeltas.value);
  pendingDeltas.value = "";
  lastFlushTime = performance.now();
  scrollToBottom();
};

const onDelta = (delta) => {
  pendingDeltas.value += delta;
  if (!rafId) {
    const tick = () => {
      const now = performance.now();
      if (
        pendingDeltas.value &&
        (now - lastFlushTime >= MIN_FLUSH_INTERVAL || lastFlushTime === 0)
      ) {
        flushBuffer();
        rafId = null;
      } else if (pendingDeltas.value) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  }
};

const handleReasoningDelta = (delta) => {
  if (!shouldUseReasoner.value) {
    return;
  }
  sessionStore.add(delta);
  scrollToBottom();
};

const handleStreamFinished = () => {
  isTyping.value = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  flushBuffer();
  showNewMessageIndicator.value = false;
};

watchEffect(() => {
  if (!isTyping.value) {
    flushBuffer();
  }
});

onMounted(async () => {
  addCopyButtons();
  await forceScrollToBottom();
  registerChatListeners();
});

onUpdated(() => {
  addCopyButtons();
});

onBeforeUnmount(() => {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  flushBuffer();
  removeChatListeners();
});

/**
 * 发送消息时处理文本、附件并发起流式请求。
 */
const submit = async ({ attachments = [] } = {}) => {
  const trimmed = msg.value.trim();
  if (!trimmed && !attachments.length) return;

  const placeholder = "";
  sessionStore.sessionpush({
    role: "user",
    content: trimmed,
    attachments,
  });
  if (shouldUseReasoner.value) {
    sessionStore.reasonadd(placeholder);
    sessionStore.reasonadd(placeholder);
  }
  msg.value = "";
  await scrollToBottom();

  const aiMessage = { role: "assistant", content: "", attachments: [] };
  sessionStore.sessionpush(aiMessage);
  isTyping.value = true;
  autoScroll = true;

  try {
    const payloadMessages = sessionStore.getMessagesForModel();
    if (payloadMessages.length) {
      payloadMessages.pop();
    }
    await chatStream(
      payloadMessages,
      onDelta,
      handleStreamFinished,
      handleReasoningDelta,
      selectedModel.value,
    );
  } catch (error) {
    isTyping.value = false;
    aiMessage.content = "抱歉，回复生成出错";
    showNewMessageIndicator.value = false;
    flushBuffer();
    console.error(error);
  } finally {
    autoScroll = true;
  }
};

const renderMarkdown = (raw) => md.render(raw || "");

/**
 * 给代码块添加复制按钮，便于用户快速复制答案示例。
 */
const addCopyButtons = () => {
  nextTick(() => {
    const codeBlocks = document.querySelectorAll(`${CHAT_CONTAINER_SELECTOR} pre`);
    codeBlocks.forEach((block) => {
      if (block.querySelector(".copy-btn")) return;
      const button = document.createElement("button");
      button.className = "copy-btn";
      button.innerHTML = "复制";
      button.addEventListener("click", () => {
        const code = block.querySelector("code")?.textContent ?? "";
        navigator.clipboard.writeText(code).then(() => {
          button.textContent = "已复制！";
          setTimeout(() => {
            button.textContent = "复制";
          }, 2000);
        });
      });
      block.appendChild(button);
    });
  });
};

const copyMessage = (text) => {
  navigator.clipboard.writeText((text ?? "").trim());
};

const copyMessageMarkdown = (text) => {
  navigator.clipboard.writeText(text ?? "");
};

const handleDeleteMessage = (index) => {
  sessionStore.removeMessageAt(index);
};

const handleRegenerateMessage = async (index) => {
  const target = messages.value[index];
  if (!target || target.role !== "assistant" || isTyping.value) {
    return;
  }

  sessionStore.trimMessagesFrom(index);
  const placeholder = "";
  if (shouldUseReasoner.value) {
    sessionStore.reasonadd(placeholder);
  }

  const aiMessage = { role: "assistant", content: "", attachments: [] };
  sessionStore.sessionpush(aiMessage);
  isTyping.value = true;
  autoScroll = true;

  try {
    const payloadMessages = sessionStore.getMessagesForModel();
    if (payloadMessages.length) {
      payloadMessages.pop();
    }
    await chatStream(
      payloadMessages,
      onDelta,
      handleStreamFinished,
      handleReasoningDelta,
      selectedModel.value,
    );
  } catch (error) {
    isTyping.value = false;
    aiMessage.content = "抱歉，重新生成时出错";
    showNewMessageIndicator.value = false;
    flushBuffer();
    console.error(error);
  } finally {
    autoScroll = true;
  }
};

const avatarForRole = (role) => (role === "user" ? userAvatar : assistantAvatar);

const isEditingTitle = ref(false);
const tempTitle = ref("");

/**
 * 进入标题编辑态，聚焦输入框方便直接修改。
 */
const startEditing = () => {
  tempTitle.value = sessionStore.curname;
  isEditingTitle.value = true;
  nextTick(() => {
    document.querySelector(".title-input input")?.focus();
  });
};

/**
 * 保存新的标题并同步到 Store。
 */
const saveTitle = () => {
  if (tempTitle.value.trim()) {
    sessionStore.updateTitle(tempTitle.value.trim());
  }
  isEditingTitle.value = false;
};

/**
 * 取消编辑，恢复原始标题。
 */
const cancelEditing = () => {
  isEditingTitle.value = false;
};

const toggleReason = (index) => {
  sessionStore.qiehuan(index);
};

const reasoningText = (index) => reasoningList.value[index] ?? "";
const shouldDisplayReason = (index) => {
  const text = reasoningText(index);
  return text.trim() && (reasonVisibility.value[index] ?? false);
};

/**
 * 判断是否为正在流式输出的最后一条 assistant 消息。
 * 流式期间使用纯文本展示，避免未闭合 Markdown 导致布局跳动。
 */
const isStreamingMessage = (item, index) =>
  item.role === "assistant" && isTyping.value && index === messages.value.length - 1;

const selecthistory = (name) => {
  flushBuffer();
  sessionStore.selecthistory(name);
};

defineExpose({ selecthistory });
</script>

<template>
  <div class="header">
    <div class="header-title">
      <template v-if="!isEditingTitle">
        {{ sessionStore.curname }}
        <el-icon @click="startEditing"><EditPen /></el-icon>
      </template>
      <template v-else>
        <el-input
          v-model="tempTitle"
          class="title-input"
          size="small"
          @keyup.enter="saveTitle"
          @blur="saveTitle"
        />
        <el-icon @click="cancelEditing"><Close /></el-icon>
      </template>
    </div>
    <el-select
      v-model="selectedModel"
      size="small"
      class="model-select"
      :disabled="isTyping"
      placeholder="选择模型"
      :teleported="false"
    >
      <el-option
        v-for="option in modelOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
  </div>

  <div class="content">
    <div
      v-for="(item, index) in messages"
      :key="item._key"
      class="message-row"
      :class="item.role === 'user' ? 'is-user' : 'is-assistant'"
      :data-index="index"
    >
      <img
        class="message-avatar"
        :src="avatarForRole(item.role)"
        :alt="item.role === 'user' ? '用户头像' : 'AI头像'"
      />
      <div class="message" :class="item.role === 'user' ? 'user-message' : 'assistant-message'">
        <div class="message-header">
          <span class="message-role">{{ item.role === "user" ? "我" : "DeepSeek" }}</span>
          <div class="message-actions">
            <el-tooltip content="复制纯文本" placement="top">
              <button @click="copyMessage(item.content)" class="action-btn">
                <el-icon><CopyDocument /></el-icon>
              </button>
            </el-tooltip>
            <el-tooltip v-if="item.role === 'assistant'" content="复制全文" placement="top">
              <button @click="copyMessageMarkdown(item.content)" class="action-btn">
                <el-icon><DocumentCopy /></el-icon>
              </button>
            </el-tooltip>
            <el-tooltip v-if="item.role === 'assistant'" content="重新回复" placement="top">
              <button @click="handleRegenerateMessage(index)" class="action-btn">
                <el-icon><RefreshRight /></el-icon>
              </button>
            </el-tooltip>
            <el-tooltip content="删除此消息" placement="top">
              <button @click="handleDeleteMessage(index)" class="action-btn">
                <el-icon><Delete /></el-icon>
              </button>
            </el-tooltip>
          </div>
        </div>

        <div v-if="reasoningText(index).trim()" class="reasoning-header">
          <span>思考过程</span>
          <button class="reason-toggle" @click="toggleReason(index)">
            {{ shouldDisplayReason(index) ? "收起" : "展开" }}
          </button>
        </div>

        <div v-if="shouldDisplayReason(index)" class="reasoning-body">
          {{ reasoningText(index) }}
        </div>

        <div v-if="isStreamingMessage(item, index)" class="message-body message-body-streaming">
          {{ item.content }}<span class="streaming-cursor">▌</span>
        </div>
        <div v-else class="message-body" v-html="renderMarkdown(item.content)"></div>

        <AttachmentPreview v-if="item.attachments?.length" :attachments="item.attachments" />
      </div>
    </div>
  </div>

  <!-- 输入区：同时支持文本、文件上传与语音输入 -->
  <ChatInput v-model:msg="msg" v-model:isTyping="isTyping" @submit="submit" />

  <!-- 新消息指示器 -->
  <div v-if="showNewMessageIndicator" class="new-message-indicator" @click="scrollToBottomOnClick">
    新消息
  </div>
</template>

<style scoped>
.header {
  padding: 18px 24px;
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-heading);
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-title {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.model-select {
  width: 220px;
}

.header .el-icon {
  cursor: pointer;
  color: var(--color-muted);
  transition: color 0.2s ease;
}

.header .el-icon:hover {
  color: var(--color-heading);
}

.title-input {
  width: 220px;
  max-width: 60%;
}

.content {
  flex: 1;
  overflow-y: auto;
  overflow-anchor: auto;
  background: var(--color-panel-alt);
  padding: 32px 12%;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}

.message-row.is-user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--color-surface);
  padding: 6px;
  box-shadow: var(--shadow-soft);
}

.message {
  max-width: 70%;
  width: fit-content;
  padding: 16px 20px;
  border-radius: 18px;
  position: relative;
  contain: layout;
  box-shadow: var(--shadow-soft);
  animation: fadeIn 0.3s ease;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  word-break: break-word;
  color: var(--color-text-primary);
}

.message.user-message {
  background: var(--color-bubble-user);
  color: var(--color-accent-contrast);
  border: 1px solid var(--color-bubble-user-border);
}

.message.assistant-message {
  background: var(--color-elevated-surface);
  color: var(--color-text-primary);
}

.message-row.is-user .message-actions .action-btn {
  color: rgba(249, 250, 251, 0.8);
}

.message-row.is-user .message-actions .action-btn:hover {
  color: var(--color-accent-contrast);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.message-role {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: inherit;
}

.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.action-btn:hover {
  background: var(--color-reasoning-surface);
  color: var(--color-text-primary);
}

.message-row.is-user .action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.reasoning-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--color-reasoning-surface);
  color: inherit;
  font-size: 13px;
  margin-bottom: 8px;
}

.reason-toggle {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.reason-toggle:hover {
  text-decoration: underline;
}

.reasoning-body {
  padding: 12px;
  border-radius: 10px;
  background: var(--color-reasoning-contrast);
  border: 1px solid var(--color-reasoning-border);
  margin-bottom: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: inherit;
}

.message.user-message .reasoning-header,
.message.user-message .reasoning-body {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.22);
}

.message-body {
  min-height: 1.5em;
}

.message-body-streaming {
  white-space: pre-wrap;
  word-break: break-word;
}

.streaming-cursor {
  display: inline-block;
  animation: blink 1s step-end infinite;
  margin-left: 2px;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.message-body :deep(p) {
  margin: 0.5em 0;
}

.message-body :deep(a) {
  color: var(--color-link);
}

.message-body :deep(a:hover) {
  text-decoration: underline;
  color: var(--color-link-hover);
}

.message-body :deep(code:not(.hljs)) {
  background: var(--color-code-surface);
  padding: 0.2em 0.4em;
  border-radius: 4px;
}

.content :deep(pre) {
  position: relative;
  background: var(--color-code-surface);
  border: 1px solid var(--color-code-border);
  border-radius: 10px;
  padding: 16px;
  margin: 16px 0;
  overflow-x: auto;
}

.content :deep(code.hljs) {
  background: transparent;
  padding: 0;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 14px;
  color: var(--color-text-primary);
}

.content :deep(pre)::before {
  content: "代码";
  display: block;
  font-size: 12px;
  color: var(--color-code-label);
  margin-bottom: 8px;
}

.content :deep(.copy-btn) {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--color-copy-button-bg);
  color: var(--color-accent-contrast);
  border: none;
  cursor: pointer;
  font-size: 12px;
}

.content :deep(.copy-btn:hover) {
  background: var(--color-copy-button-hover);
}

.new-message-indicator {
  position: fixed;
  bottom: 80px;
  right: 24px;
  background: var(--color-new-indicator-bg);
  color: var(--color-accent-contrast);
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--shadow-strong);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.new-message-indicator:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-strong);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  background: var(--color-table-bg);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--color-table-border);
  font-size: 14px;
}

.content :deep(th),
.content :deep(td) {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-table-border);
}

.content :deep(th) {
  background: var(--color-table-header-bg);
  font-weight: 600;
  color: var(--color-heading);
}

.content :deep(tr:last-child td) {
  border-bottom: none;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: var(--color-scroll-track);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb {
  background: var(--color-scroll-thumb);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-scroll-thumb-hover);
}

@media (max-width: 960px) {
  .content {
    padding: 24px 24px;
  }

  .message {
    max-width: 85%;
  }
}

@media (max-width: 640px) {
  .content {
    padding: 20px 16px;
  }

  .message-row {
    gap: 12px;
  }

  .message {
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 14px 18px;
    font-size: 16px;
  }

  .title-input {
    width: 180px;
  }

  .content {
    padding: 18px 12px;
  }

  .message-avatar {
    width: 36px;
    height: 36px;
    padding: 4px;
  }

  .message {
    padding: 14px 16px;
  }

  .message-actions {
    gap: 4px;
  }
}
</style>
