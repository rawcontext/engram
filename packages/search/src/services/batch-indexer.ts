import PQueue from "p-queue";
import type { IndexableNode, SearchIndexer } from "./indexer";

export class BatchIndexer {
	private queue: PQueue;
	private buffer: IndexableNode[] = [];
	private batchSize: number;
	private flushInterval: number;
	private timer: NodeJS.Timeout | null = null;

	constructor(
		private indexer: SearchIndexer,
		options: { batchSize?: number; concurrency?: number; flushInterval?: number } = {},
	) {
		this.batchSize = options.batchSize || 32;
		this.flushInterval = options.flushInterval || 5000; // 5 seconds
		this.queue = new PQueue({ concurrency: options.concurrency || 4 });
	}

	public add(node: IndexableNode) {
		this.buffer.push(node);
		if (this.buffer.length >= this.batchSize) {
			// Fire-and-forget with explicit error handling to prevent unhandled rejections
			void this.flush().catch((err) => {
				console.error("[BatchIndexer] Background flush failed:", err);
			});
		} else if (!this.timer) {
			this.timer = setTimeout(() => {
				void this.flush().catch((err) => {
					console.error("[BatchIndexer] Scheduled flush failed:", err);
				});
			}, this.flushInterval);
		}
	}

	private async flush() {
		if (this.buffer.length === 0) return;

		// Swap buffer
		const batch = [...this.buffer];
		this.buffer = [];

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		await this.queue.add(async () => {
			console.log(`[BatchIndexer] Processing batch of ${batch.length} items`);
			// TODO: Implement bulk indexNode in Indexer for efficiency
			// For V1, we iterate in parallel up to Qdrant limits (handled by indexNode or queue here)
			// Actually, Qdrant supports batch upsert. We should extend Indexer to support batching.
			// But for now, we just map.
			await Promise.all(batch.map((node) => this.indexer.indexNode(node)));
		});
	}

	public async shutdown() {
		if (this.timer) clearTimeout(this.timer);
		await this.flush();
		await this.queue.onIdle();
	}
}
