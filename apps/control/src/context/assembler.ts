import type { SearchRetriever } from "@engram/search-core";
import type { FalkorClient } from "@engram/storage";

export class ContextAssembler {
	constructor(
		private search: SearchRetriever,
		private memory: FalkorClient,
	) {}

	async assembleContext(_sessionId: string, _query: string, _tokenLimit = 8000): Promise<string> {
		// 1. System Prompt (Fixed)
		// 2. Recent History (Sliding Window)
		// 3. Relevant Memories (Search)
		// 4. Active File (if any)
		// 5. Prune to fit tokenLimit

		// Stub implementation
		return "System: You are Engram.\nUser: Hello.";
	}
}
