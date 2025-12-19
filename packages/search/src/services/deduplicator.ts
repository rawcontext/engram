import { QdrantClient } from "@qdrant/js-client-rest";
import { TextEmbedder } from "./text-embedder";

export class Deduplicator {
	private client: QdrantClient;
	private textEmbedder: TextEmbedder;
	private collectionName = "engram_memory";
	// Threshold for considering content "duplicate"
	// 0.95 is usually very close for high-dimensional embeddings
	private threshold = 0.95;

	constructor(url: string = "http://localhost:6333") {
		this.client = new QdrantClient({ url });
		this.textEmbedder = new TextEmbedder();
	}

	/**
	 * Checks if semantically identical content exists.
	 * @param content The text content to check.
	 * @param vectorName The named vector to search against (default: text_dense).
	 * @returns The ID of the existing document if found, or null.
	 */
	async findDuplicate(
		content: string,
		vectorName: "text_dense" | "code_dense" = "text_dense",
	): Promise<string | null> {
		const vector = await this.textEmbedder.embed(content);

		// Use query API with named vector specification
		const results = await this.client.query(this.collectionName, {
			query: vector,
			using: vectorName,
			limit: 1,
			score_threshold: this.threshold,
			with_payload: true,
		});

		if (results.points.length > 0) {
			// Double check? For now, trust the vector similarity.
			// We could compare exact string if payload allows.
			return results.points[0].id as string;
		}

		return null;
	}
}
