import { QdrantClient } from '@qdrant/js-client-rest';
import { TextEmbedder } from './text-embedder';
import { SearchQuery } from '../models/schema';

export class SearchRetriever {
  private client: QdrantClient;
  private textEmbedder: TextEmbedder;
  private collectionName = 'soul_memory';

  constructor(url: string = 'http://localhost:6333') {
    this.client = new QdrantClient({ url });
    this.textEmbedder = new TextEmbedder();
  }

  async search(query: SearchQuery) {
    const { text, limit = 10, strategy, filters } = query;
    const vector = await this.textEmbedder.embedQuery(text);

    // Build Filter
    const filter: any = {};
    if (filters) {
        const conditions = [];
        if (filters.session_id) {
            conditions.push({ key: 'session_id', match: { value: filters.session_id } });
        }
        if (filters.type) {
            conditions.push({ key: 'type', match: { value: filters.type } });
        }
        if (conditions.length > 0) {
            filter.must = conditions;
        }
    }

    // Dense Search
    if (strategy === 'dense' || strategy === 'hybrid') {
         const denseResults = await this.client.search(this.collectionName, {
             vector: {
                 name: 'dense',
                 vector: vector
             },
             filter: Object.keys(filter).length > 0 ? filter : undefined,
             limit,
             with_payload: true
         });
         
         if (strategy === 'dense') return denseResults;
         
         // If hybrid, we would also do sparse search and fuse.
         // For V1, we return dense results. 
         // Implementation of RRF fusion would go here.
         return denseResults;
    }

    // Sparse Search (TODO)
    if (strategy === 'sparse') {
        // ...
        return [];
    }
  }
}
