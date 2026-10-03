// Anthropic SDK-ийн нимгэн wrapper. Бүх AI дуудлага эндээс гарна.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client = null;

function getClient() {
  if (!client) {
    // apiKey өгөөгүй бол SDK орчноос (ANTHROPIC_API_KEY) уншина.
    client = new Anthropic(
      config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {},
    );
  }
  return client;
}

/**
 * Энгийн хариу авах туслах.
 * @param {object} opts
 * @param {string} opts.system        — системийн промт
 * @param {Array}  opts.messages      — Anthropic.MessageParam[]
 * @param {Array}  [opts.tools]       — (заавал биш) tool-ууд
 * @param {number} [opts.maxTokens]   — default 2048 (чат хариу богино байдаг)
 * @returns {Promise<import("@anthropic-ai/sdk").Anthropic.Message>}
 */
export async function createMessage({ system, messages, tools, maxTokens = 2048, model }) {
  const req = {
    model: model || config.aiModel,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    messages,
  };
  if (system) req.system = system;
  if (tools && tools.length) req.tools = tools;

  return getClient().messages.create(req);
}

/** Хариунаас эхний текст блокийг гаргаж авах. */
export function extractText(message) {
  if (!message?.content) return "";
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Хариунаас tool_use блокуудыг гаргаж авах. */
export function extractToolUses(message) {
  if (!message?.content) return [];
  return message.content.filter((b) => b.type === "tool_use");
}
