import { ParserStrategy, StreamDelta } from "./interface";

export class AnthropicParser implements ParserStrategy {
  parse(payload: any): StreamDelta | null {
    // Anthropic Event Types
    const type = payload.type;

    if (type === "message_start") {
      return {
        usage: {
          input: payload.message?.usage?.input_tokens || 0,
        },
      };
    }

    if (type === "content_block_start") {
      if (payload.content_block?.type === "tool_use") {
        return {
          toolCall: {
            index: payload.index,
            id: payload.content_block.id,
            name: payload.content_block.name,
            args: "", // Start with empty args
          },
        };
      }
    }

    if (type === "content_block_delta") {
      const delta = payload.delta;
      if (delta?.type === "text_delta") {
        return { content: delta.text };
      }
      if (delta?.type === "input_json_delta") {
        return {
          toolCall: {
            index: payload.index,
            args: delta.partial_json,
          },
        };
      }
    }

    if (type === "message_delta") {
      const delta: StreamDelta = {};
      if (payload.usage?.output_tokens) {
        delta.usage = { output: payload.usage.output_tokens };
      }
      if (payload.delta?.stop_reason) {
        delta.stopReason = payload.delta.stop_reason;
      }
      return Object.keys(delta).length > 0 ? delta : null;
    }

    return null;
  }
}
