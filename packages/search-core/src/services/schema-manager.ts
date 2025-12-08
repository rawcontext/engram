import { QdrantClient } from "@qdrant/js-client-rest";

// Vector dimensions for different embedding models
export const VECTOR_DIMENSIONS = {
	text: 384, // e5-small
	code: 768, // nomic-embed-text-v1
} as const;

export class SchemaManager {
	private client: QdrantClient;
	private collectionName = "engram_memory";

	constructor(url: string = "http://localhost:6333") {
		this.client = new QdrantClient({ url });
	}

	async ensureCollection() {
		const response = await this.client.getCollections();
		const exists = response.collections.some((c) => c.name === this.collectionName);

		if (!exists) {
			console.log(`Creating collection ${this.collectionName}...`);
			await this.client.createCollection(this.collectionName, {
				vectors: {
					// Separate vector fields for different content types
					text_dense: {
						size: VECTOR_DIMENSIONS.text, // e5-small: 384 dimensions
						distance: "Cosine",
					},
					code_dense: {
						size: VECTOR_DIMENSIONS.code, // nomic-embed-text-v1: 768 dimensions
						distance: "Cosine",
					},
				},
				sparse_vectors: {
					sparse: {
						index: {
							on_disk: false,
							datatype: "float16",
						},
					},
				},
			});
			console.log(`Collection ${this.collectionName} created.`);
		} else {
			console.log(`Collection ${this.collectionName} already exists.`);
		}
	}

	/**
	 * Migrate existing collection to new schema with separate text/code vectors.
	 * This will delete and recreate the collection - use with caution!
	 */
	async migrateToMultiVectorSchema() {
		const response = await this.client.getCollections();
		const exists = response.collections.some((c) => c.name === this.collectionName);

		if (exists) {
			console.log(`Deleting existing collection ${this.collectionName} for migration...`);
			await this.client.deleteCollection(this.collectionName);
		}

		await this.ensureCollection();
		console.log("Migration complete. Re-index all data to populate new vector fields.");
	}
}
