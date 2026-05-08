import { ref } from "vue";
import { defineStore } from "pinia";

// 默认会话名称，用于初始化以及兜底
const DEFAULT_SESSION_NAME = "新对话";

const MODEL_OPTIONS = Object.freeze([
  {
    label: "DeepSeek Reasoner（推理增强）",
    value: "deepseek-reasoner",
  },
  {
    label: "DeepSeek Chat（快速对话）",
    value: "deepseek-chat",
  },
]);

const formatFileSize = (size) => {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};

// 将附件对象描述为更易读的字符串，方便拼接到模型上下文
const describeAttachment = (attachment) => {
  if (!attachment) return "";
  const { name, size, type, body, note } = attachment;
  const header = [`文件名: ${name}`, `大小: ${formatFileSize(size)}`];
  if (type) {
    header.push(`类型: ${type}`);
  }

  const bodyText = body
    ? `内容预览:\n${(body || "").slice(0, 4000)}`
    : note || "未提供内容";

  return `${header.join(" | ")}\n${bodyText}`;
};

export const useSessionStore = defineStore(
  "session",
  () => {
    const session = ref({ [DEFAULT_SESSION_NAME]: [] });
    const curname = ref(DEFAULT_SESSION_NAME);
    const time = ref({});
    const reason = ref({ [DEFAULT_SESSION_NAME]: [] });
    const showreason = ref({ [DEFAULT_SESSION_NAME]: [] });
    const visibility = ref({ [DEFAULT_SESSION_NAME]: false });
    const pendingConversation = ref(DEFAULT_SESSION_NAME);
    const model = ref(MODEL_OPTIONS[0].value);

    if ((session.value[DEFAULT_SESSION_NAME]?.length ?? 0) > 0) {
      visibility.value[DEFAULT_SESSION_NAME] = true;
      pendingConversation.value = null;
    }

    /**
     * 确保某个会话的相关数据结构已初始化，避免访问 undefined。
     */
    const ensureConversation = (
      name = curname.value,
      { makeVisibleIfNew = true } = {},
    ) => {
      const exists = !!session.value[name];

      if (!exists) {
        session.value[name] = [];
      }
      if (!reason.value[name]) {
        reason.value[name] = [];
      }
      if (!showreason.value[name]) {
        showreason.value[name] = [];
      }
      if (time.value[name] === undefined) {
        time.value[name] = exists ? Date.now() : 0;
      }

      if (visibility.value[name] === undefined) {
        visibility.value[name] = session.value[name].length > 0;
      }

      if (!exists && !makeVisibleIfNew) {
        visibility.value[name] = false;
        pendingConversation.value = name;
      } else if (!exists) {
        visibility.value[name] = true;
      }
    };

    const generateConversationName = () => {
      const base = DEFAULT_SESSION_NAME;
      if (!session.value[base]) {
        return base;
      }

      let index = 1;
      let candidate = `${base} ${index}`;
      while (session.value[candidate]) {
        index += 1;
        candidate = `${base} ${index}`;
      }
      return candidate;
    };

    /**
     * 反转指定消息的思考链显示状态。
     */
    const toggleReasonVisibility = (index) => {
      ensureConversation();
      const key = curname.value;
      if (showreason.value[key][index] === undefined) {
        showreason.value[key][index] = true;
      }
      showreason.value[key][index] = !showreason.value[key][index];
    };

    /**
     * 向当前会话追加一条消息，同时记录最近活跃时间。
     */
    const sessionpush = (msg) => {
      const key = curname.value;
      ensureConversation(key);
      const normalized = {
        role: msg.role,
        content: msg.content ?? "",
        attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
      };
      session.value[key].push(normalized);
      time.value[key] = Date.now();
      visibility.value[key] = true;
      if (pendingConversation.value === key) {
        pendingConversation.value = null;
      }
    };

    const reasonadd = (reasonmsg) => {
      const key = curname.value;
      ensureConversation(key);
      reason.value[key].push(reasonmsg);
      showreason.value[key].push(true);
    };

    const setModel = (value) => {
      const exists = MODEL_OPTIONS.some((option) => option.value === value);
      if (exists) {
        model.value = value;
      }
    };

    /**
     * 返回所有可见会话的名称列表。
     */
    const getAllSessions = () =>
      Object.keys(session.value).filter((name) => {
        if (visibility.value[name] === undefined) {
          visibility.value[name] = session.value[name].length > 0;
        }
        return visibility.value[name] !== false;
      });

    /**
     * 创建一个空白会话，标记为待输入状态。
     */
    const createBlankConversation = (name) => {
      session.value[name] = [];
      reason.value[name] = [];
      showreason.value[name] = [];
      time.value[name] = 0;
      visibility.value[name] = false;
      pendingConversation.value = name;
    };

    /**
     * 清空所有历史记录并创建新的占位会话。
     */
    const clear = () => {
      session.value = {};
      reason.value = {};
      showreason.value = {};
      time.value = {};
      visibility.value = {};
      const name = generateConversationName();
      createBlankConversation(name);
      curname.value = name;
    };

    /**
     * 更新当前会话标题，若目标标题已存在则切换到该会话。
     */
    const updateTitle = (newTitle) => {
      const trimmed = newTitle?.trim();
      if (!trimmed) {
        return;
      }

      const current = curname.value;
      if (trimmed === current) {
        return;
      }

      if (session.value[trimmed]) {
        curname.value = trimmed;
        visibility.value[trimmed] = true;
        pendingConversation.value = null;
        return;
      }

      ensureConversation(current);

      session.value[trimmed] = session.value[current];
      reason.value[trimmed] = reason.value[current];
      showreason.value[trimmed] = showreason.value[current];
      if (time.value[current]) {
        time.value[trimmed] = time.value[current];
      }

      visibility.value[trimmed] = true;

      delete session.value[current];
      delete reason.value[current];
      delete showreason.value[current];
      delete time.value[current];
      delete visibility.value[current];

      curname.value = trimmed;
      pendingConversation.value = null;
    };

    const removeMessageAt = (index) => {
      ensureConversation();
      const key = curname.value;
      const messages = session.value[key];
      if (!messages || index < 0 || index >= messages.length) {
        return;
      }

      messages.splice(index, 1);
      reason.value[key]?.splice(index, 1);
      showreason.value[key]?.splice(index, 1);

      if (!messages.length) {
        time.value[key] = 0;
      }
    };

    const trimMessagesFrom = (startIndex) => {
      ensureConversation();
      const key = curname.value;
      const messages = session.value[key];
      if (!messages || startIndex < 0) {
        return;
      }

      if (startIndex < messages.length) {
        session.value[key] = messages.slice(0, startIndex);
        reason.value[key] = (reason.value[key] ?? []).slice(0, startIndex);
        showreason.value[key] = (showreason.value[key] ?? []).slice(0, startIndex);
      }
    };

    const deletehistory = (name) => {
      const wasCurrent = name === curname.value;
      delete session.value[name];
      delete time.value[name];
      delete reason.value[name];
      delete showreason.value[name];
      delete visibility.value[name];

      if (pendingConversation.value === name) {
        pendingConversation.value = null;
      }

      const remaining = Object.keys(session.value);

      if (wasCurrent) {
        const fallback = remaining
          .map((key) => ({ key, updatedAt: time.value[key] ?? 0 }))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.key;

        if (fallback) {
          ensureConversation(fallback);
          curname.value = fallback;
          return;
        }

        const fallbackName = generateConversationName();
        createBlankConversation(fallbackName);
        curname.value = fallbackName;
      }
    };

    /**
     * 切换当前会话，必要时自动初始化数据。
     */
    const selecthistory = (name) => {
      if (name && curname.value !== name) {
        ensureConversation(name);
        curname.value = name;
      }
    };

    /**
     * 获取当前会话的消息列表，附带虚拟滚动所需的 key。
     */
    const getcurmsgs = () => {
      ensureConversation();
      const currentMessages = session.value[curname.value];

      return currentMessages.map((item, idx) => ({
        ...item,
        attachments: Array.isArray(item.attachments) ? item.attachments : [],
        _key: `${item.role}-${idx}`,
      }));
    };

    /**
     * 创建新的对话。当存在未使用的占位对话时直接切换过去。
     */
    const newchat = () => {
      if (
        pendingConversation.value &&
        session.value[pendingConversation.value] &&
        (session.value[pendingConversation.value]?.length ?? 0) === 0
      ) {
        curname.value = pendingConversation.value;
        ensureConversation(curname.value, { makeVisibleIfNew: false });
        return { created: false, name: curname.value };
      }

      const name = generateConversationName();
      createBlankConversation(name);
      curname.value = name;
      return { created: true, name };
    };

    /**
     * 将流式响应追加到最后一条消息中。
     */
    const adddelta = (delta) => {
      ensureConversation();
      const key = curname.value;
      const messages = session.value[key];
      const lastMessage = messages[messages.length - 1];

      if (lastMessage) {
        lastMessage.content += delta;
      }
    };

    /**
     * 将推理文本追加到当前会话的最后一个思考链中。
     */
    const add = (delta) => {
      ensureConversation();
      const key = curname.value;
      const reasoningList = reason.value[key];
      const last = reasoningList[reasoningList.length - 1];
      if (last !== undefined) {
        reasoningList[reasoningList.length - 1] = `${last}${delta}`;
      }
    };

    /**
     * 将消息和附件概述拼接成模型可读的输入。
     */
    const getMessagesForModel = () => {
      ensureConversation();
      const key = curname.value;
      return session.value[key].map((item) => {
        const attachmentsText =
          item.attachments && item.attachments.length
            ? `\n\n附件:\n${item.attachments
                .map((attachment) => describeAttachment(attachment))
                .join("\n\n")}`
            : "";

        const content = `${item.content ?? ""}${attachmentsText}`.trim();

        return {
          role: item.role,
          content: content || "(空消息)",
        };
      });
    };

    return {
      session,
      curname,
      sessionpush,
      getcurmsgs,
      adddelta,
      getAllSessions,
      newchat,
      clear,
      deletehistory,
      selecthistory,
      time,
      updateTitle,
      reasonadd,
      reason,
      add,
      showreason,
      qiehuan: toggleReasonVisibility,
      getMessagesForModel,
      visibility,
      pendingConversation,
      removeMessageAt,
      trimMessagesFrom,
      model,
      modelOptions: MODEL_OPTIONS,
      setModel,
    };
  },
  {
    persist: true,
  },
);
