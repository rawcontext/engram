import { ParserStrategy, StreamDelta } from "./interface";

export class OpenAIParser implements ParserStrategy {
  parse(payload: any): StreamDelta | null {
    // OpenAI Structure: choices[0].delta or usage (final chunk)

    // Check for Usage (Stream Options)
    if (payload.usage) {
      return {
        usage: {
          input: payload.usage.prompt_tokens,
          output: payload.usage.completion_tokens,
        },
      };
    }

    const choice = payload.choices?.[0];
    if (!choice) return null;

    const delta = choice.delta;
    if (!delta) return null;

    // Content
    if (delta.content) {
      return { content: delta.content };
    }

    // Tool Calls
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      const toolCall = delta.tool_calls[0];
      return {
        toolCall: {
          index: toolCall.index,
          id: toolCall.id, // Only present in first chunk usually
          name: toolCall.function?.name, // Only present in first chunk usually
          args: toolCall.function?.arguments, // Partial JSON
        },
      };
    }

    if (choice.finish_reason) {
      return { stopReason: choice.finish_reason };
    }

    return null;
  }
}
