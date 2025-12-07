import { QdrantClient } from '@qdrant/js-client-rest';
import { TextEmbedder } from './text-embedder';
import { CodeEmbedder } from './code-embedder';

export interface IndexableNode {
  id: string;
  labels: string[];
  content?: string; // Thought content
  patch_content?: string; // DiffHunk content
  session_id?: string;
  file_path?: string;
  timestamp?: number; // created_at / vt_start
}

export class SearchIndexer {
  private client: QdrantClient;
  private textEmbedder: TextEmbedder;
  private codeEmbedder: CodeEmbedder;
  private collectionName = 'soul_memory';

  constructor(url: string = 'http://localhost:6333') {
    this.client = new QdrantClient({ url });
    this.textEmbedder = new TextEmbedder();
    this.codeEmbedder = new CodeEmbedder();
  }

  async indexNode(node: IndexableNode) {
    const isCode = node.labels.includes('DiffHunk') || node.labels.includes('CodeArtifact');
    const content = isCode ? node.patch_content : node.content;

    if (!content) return; // Nothing to index

    // Generate Vectors
    let denseVector: number[];
    if (isCode) {
        denseVector = await this.codeEmbedder.embed(content);
    } else {
        denseVector = await this.textEmbedder.embed(content);
    }

    // Sparse Vector (TODO: Implement actual sparse embedding)
    const sparseVector = { indices: [], values: [] };

    // Payload
    const payload = {
        content: content,
        node_id: node.id,
        session_id: node.session_id || 'unknown',
        type: isCode ? 'code' : 'thought',
        timestamp: node.timestamp || Date.now(),
        file_path: node.file_path
    };

    // Upsert
    await this.client.upsert(this.collectionName, {
        points: [
            {
                id: node.id, // Use Node ID as Point ID (must be UUID)
                vectors: {
                    dense: denseVector,
                    sparse: sparseVector
                },
                payload
            }
        ]
    });
  }
}
