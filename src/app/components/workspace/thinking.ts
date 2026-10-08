export interface ParsedThinkingResult {
  thinking: string | null;
  answer: string;
}

/**
 * Extracts thinking / reasoning content from model responses.
 *
 * Supports:
 * 1. Explicit <think>...</think> or <thought>...</thought> tags, including unclosed tags while streaming.
 * 2. Chain-of-thought transitions where the model concludes internal reasoning with "Now produce final answer."
 */
export function extractThinking(content: string): ParsedThinkingResult {
  if (!content) {
    return { thinking: null, answer: "" };
  }

  // 1. Check for <think>...</think> or <thought>...</thought>
  const thinkTagRegex = /<(think|thought)>([\s\S]*?)(?:<\/\1>|$)/i;
  const match = content.match(thinkTagRegex);

  if (match && match.index !== undefined) {
    const tagName = match[1];
    const rawThinking = match[2]?.trim() || null;
    const closingTag = `</${tagName}>`;
    const closingTagIndex = content.toLowerCase().indexOf(closingTag.toLowerCase());

    const answer =
      closingTagIndex !== -1
        ? content.slice(closingTagIndex + closingTag.length).trimStart()
        : "";

    return {
      thinking: rawThinking,
      answer,
    };
  }

  // 2. Check for transition like "Now produce final answer."
  const finalAnswerRegex =
    /([\s\S]+?)(?:(?<=\.)\s+|\r?\n\s*|^)Now produce final answer\.?\s*([\s\S]*)$/i;
  const finalAnswerMatch = content.match(finalAnswerRegex);
  if (finalAnswerMatch && finalAnswerMatch[1]?.trim()) {
    return {
      thinking: finalAnswerMatch[1].trim(),
      answer: finalAnswerMatch[2].trimStart(),
    };
  }

  return {
    thinking: null,
    answer: content,
  };
}
