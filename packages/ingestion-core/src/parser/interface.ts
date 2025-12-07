export interface StreamDelta {
  content?: string;
  thought?: string;
  diff?: string; // Added diff field
  toolCall?: {
    index?: number;
    id?: string;
    name?: string;
    args?: string; // Partial JSON
  };
  usage?: {
    input?: number;
    output?: number;
  };
  stopReason?: string;
}

export interface ParserStrategy {
  parse(payload: unknown): StreamDelta | null;
}
