import OpenAI from "openai";
import { serverEnv } from "@/data/serverEnv";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGenerateOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

interface LLMProvider {
  generate(options: LLMGenerateOptions): Promise<string>;
  stream(options: LLMGenerateOptions): Promise<AsyncIterable<string>>;
}

export class NimLLMProvider implements LLMProvider {
  private client: OpenAI | null = null;
  private defaultModel?: string;

  constructor(options?: { model?: string }) {
    this.defaultModel = options?.model;
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;

    const apiKey = serverEnv.NVIDIA_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        "NVIDIA_API_KEY environment variable is missing. Please set NVIDIA_API_KEY to use the LLM provider.",
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: serverEnv.LLM_BASE_URL,
      timeout: 60_000,
      maxRetries: 2,
    });

    return this.client;
  }

  async generate(options: LLMGenerateOptions): Promise<string> {
    const client = this.getClient();
    const model = options.model || this.defaultModel || serverEnv.LLM_MODEL;
    const response = await client.chat.completions.create({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    });

    const choice = response.choices[0];
    const message = choice?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    if (message?.reasoning_content && message?.content) {
      return `<think>${message.reasoning_content}</think>${message.content}`;
    }
    return message?.content || message?.reasoning_content || "";
  }

  async stream(options: LLMGenerateOptions): Promise<AsyncIterable<string>> {
    const client = this.getClient();
    const model = options.model || this.defaultModel || serverEnv.LLM_MODEL;
    const responseStream = await client.chat.completions.create({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    });

    // Create an async generator to yield strings chunk by chunk
    async function* makeGenerator() {
      let inReasoning = false;
      for await (const chunk of responseStream) {
        const delta = chunk.choices[0]?.delta as
          | { content?: string | null; reasoning_content?: string | null }
          | undefined;
        const reasoning = delta?.reasoning_content;
        const content = delta?.content;

        if (reasoning) {
          if (!inReasoning) {
            inReasoning = true;
            yield "<think>";
          }
          yield reasoning;
        }

        if (content) {
          if (inReasoning) {
            inReasoning = false;
            yield "</think>";
          }
          yield content;
        }
      }
      if (inReasoning) {
        yield "</think>";
      }
    }

    return makeGenerator();
  }
}
