// src/api/deepseek.js
import axios from "axios";
import { ElMessage } from "element-plus";

import { DEEPSEEK_API_KEY } from "@/config/deepseekKey";

const api = axios.create({
  baseURL: "https://api.deepseek.com/v1",
  timeout: 240000,
});
let currentAbortController = null;

// 🔐 请求拦截器：给所有请求自动加上 Bearer Token
api.interceptors.request.use((config) => {
  const apiKey = (DEEPSEEK_API_KEY ?? "").trim();
  config.headers["Authorization"] = `Bearer ${apiKey || ""}`;
  config.headers["Content-Type"] = "application/json";
  config.headers["Accept"] = "text/event-stream";
  // 每次请求创建新的 AbortController
  currentAbortController = new AbortController();
  config.signal = currentAbortController.signal;

  return config;
});

// ❗️响应拦截器：统一处理错误
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (!axios.isCancel(err)) {
      const msg = err.response?.data?.error?.message || "网络异常";
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  },
);

// 🌊 流式对话（核心函数）
/**
 * 调用 DeepSeek 接口获取流式响应。
 * @param {Array} messages 上下文消息数组
 * @param {Function} onChunk 内容增量回调
 * @param {Function} onDone 完成回调
 * @param {Function} onReasoning 推理内容回调
 */
export async function chatStream(
  messages,
  onChunk,
  onDone,
  onReasoning,
  model = "deepseek-reasoner",
) {
  let processedContentChunks = 0;
  let processedReasonChunks = 0;

  const emitTokens = (tokens, callback) => {
    if (!callback || tokens === undefined || tokens === null) {
      return;
    }
    if (Array.isArray(tokens)) {
      tokens.forEach((token) => callback(token));
    } else {
      callback(tokens);
    }
  };

  await api.post(
    "/chat/completions",
    {
      model: model || "deepseek-reasoner",
      messages,
      stream: true,
    },
    {
      responseType: "text",
      onDownloadProgress(evt) {
        const chunk =
          evt.event?.currentTarget?.response ??
          evt.event?.target?.response ??
          "";
        const lines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "));

        let index = 0;
        let reasonIndex = 0;

        for (const line of lines) {
          if (line === "data: [DONE]") {
            onDone?.();
            return;
          }

          try {
            const payload = JSON.parse(line.slice(6));
            const reasoning = payload.choices?.[0]?.delta?.reasoning_content;

            if (reasoning) {
              if (reasonIndex >= processedReasonChunks) {
                emitTokens(reasoning, onReasoning);
                processedReasonChunks++;
              }
              reasonIndex++;
            }

            const delta = payload.choices?.[0]?.delta?.content;
            if (delta) {
              if (index >= processedContentChunks) {
                emitTokens(delta, onChunk);
                processedContentChunks++;
              }
              index++;
            }
          } catch (error) {
            if (axios.isCancel(error)) {
              onDone?.();
              return;
            }
            // 跳过不完整的行（如截断的 JSON），避免因解析失败中断流
          }
        }
      },
    },
  );
}
export function abortStream() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}
