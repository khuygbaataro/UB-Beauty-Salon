// OpenAI SDK-ийн нимгэн wrapper. Customer AI үүгээр ажиллана.

import OpenAI from "openai";
import { config } from "../config.js";

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI(config.openaiApiKey ? { apiKey: config.openaiApiKey } : {});
  }
  return client;
}

/**
 * Anthropic-маягийн tool тодорхойлолтыг OpenAI function-calling формат руу хөрвүүлэх.
 * {name, description, input_schema} → {type:"function", function:{name, description, parameters}}
 */
export function toOpenAITools(tools) {
  return (tools || []).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Chat completion үүсгэх.
 * @param {object} p
 * @param {Array}  p.messages   — OpenAI chat messages (system/user/assistant/tool)
 * @param {Array}  [p.tools]    — Anthropic-маягийн tool-ууд (автоматаар хөрвүүлнэ)
 * @param {number} [p.maxTokens]
 * @param {string} [p.model]
 */
export async function createChatCompletion({ messages, tools, maxTokens = 1500, model }) {
  const req = {
    model: model || config.customerModel,
    messages,
    // GPT-5 үеийн моделиуд max_completion_tokens хэрэглэдэг (max_tokens биш).
    max_completion_tokens: maxTokens,
  };
  if (tools && tools.length) {
    req.tools = toOpenAITools(tools);
    req.tool_choice = "auto";
  }
  return getClient().chat.completions.create(req);
}
