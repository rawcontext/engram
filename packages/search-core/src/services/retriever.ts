import { QdrantClient } from "@qdrant/js-client-rest";
import { DEFAULT_SEARCH_CONFIG } from "../config";
import type { SearchQuery } from "../models/schema";
import { QueryClassifier } from "./classifier";
import { TextEmbedder } from "./text-embedder";

export class SearchRetriever {
  private client: QdrantClient;
  private textEmbedder: TextEmbedder;
  private classifier: QueryClassifier;
  private collectionName = "soul_memory";

  constructor(url: string = "http://localhost:6333") {
    this.client = new QdrantClient({ url });
    this.textEmbedder = new TextEmbedder();
    this.classifier = new QueryClassifier();
  }

  async search(query: SearchQuery) {
    const {
      text,
      limit = DEFAULT_SEARCH_CONFIG.limits.defaultResults,
      strategy: userStrategy,
      filters,
      threshold,
    } = query;

    // Determine strategy using classifier if not provided
    let strategy = userStrategy;
    if (!strategy) {
      const classification = this.classifier.classify(text);
      strategy = classification.strategy;
      // We could use classification.alpha for hybrid weighting later
    }

    const effectiveThreshold = threshold ?? DEFAULT_SEARCH_CONFIG.minScore[strategy];

    const vector = await this.textEmbedder.embedQuery(text);

    // Build Filter
    const filter: Record<string, unknown> = {};
    if (filters) {
      const conditions = [];
      if (filters.session_id) {
        conditions.push({ key: "session_id", match: { value: filters.session_id } });
      }
      if (filters.type) {
        conditions.push({ key: "type", match: { value: filters.type } });
      }
      if (conditions.length > 0) {
        filter.must = conditions;
      }
    }

    // Dense Search
    if (strategy === "dense" || strategy === "hybrid") {
      const denseResults = await this.client.search(this.collectionName, {
        vector: {
          name: "dense",
          vector: vector,
        },
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        limit,
        with_payload: true,
        score_threshold: effectiveThreshold,
      });

      if (strategy === "dense") return denseResults;

      // If hybrid, we would also do sparse search and fuse.
      // For V1, we return dense results filtered by threshold.
      return denseResults;
    }

    // Sparse Search (TODO)
    if (strategy === "sparse") {
      // ...
      return [];
    }
  }
}
