import type { SearchRetriever } from "@the-soul/search-core";
import type { FalkorClient } from "@the-soul/storage";

export class ContextAssembler {
  // biome-ignore lint/complexity/noUselessConstructor: Parameters are required for future implementation
  constructor(_search: SearchRetriever, _memory: FalkorClient) {}

  async assembleContext(_sessionId: string, _query: string, _tokenLimit = 8000): Promise<string> {
    // 1. System Prompt (Fixed)
    // 2. Recent History (Sliding Window)
    // 3. Relevant Memories (Search)
    // 4. Active File (if any)
    // 5. Prune to fit tokenLimit

    // Stub implementation
    return "System: You are The Soul.\nUser: Hello.";
  }
}
