import { QdrantClient } from "@qdrant/js-client-rest";

export class SchemaManager {
  private client: QdrantClient;
  private collectionName = "soul_memory";

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
          dense: {
            size: 384, // e5-small dimension
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
}
