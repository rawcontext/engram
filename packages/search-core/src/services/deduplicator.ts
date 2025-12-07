import { QdrantClient } from "@qdrant/js-client-rest";
import { TextEmbedder } from "./text-embedder";

export class Deduplicator {
	private client: QdrantClient;
	private textEmbedder: TextEmbedder;
	private collectionName = "soul_memory";
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
	 * @returns The ID of the existing document if found, or null.
	 */
	async findDuplicate(content: string): Promise<string | null> {
		const vector = await this.textEmbedder.embed(content);

		const results = await this.client.search(this.collectionName, {
			vector: vector,
			limit: 1,
			score_threshold: this.threshold,
            with_payload: true,
		});

		if (results.length > 0) {
            // Double check? For now, trust the vector similarity.
            // We could compare exact string if payload allows.
			return results[0].id as string;
		}

		return null;
	}
}
