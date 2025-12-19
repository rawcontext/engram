import { QdrantClient } from "@qdrant/js-client-rest";
import { CodeEmbedder } from "./code-embedder";
import { ColBERTEmbedder } from "./colbert-embedder";
import { TextEmbedder } from "./text-embedder";

export interface IndexableNode {
	id: string;
	labels: string[];
	content?: string; // Thought content (legacy)
	patch_content?: string; // DiffHunk content
	session_id?: string;
	file_path?: string;
	timestamp?: number; // created_at / vt_start
	// Properties bag from memory service
	properties?: {
		content?: string;
		role?: string;
		type?: string;
	};
}

export class SearchIndexer {
	private client: QdrantClient;
	private textEmbedder: TextEmbedder;
	private codeEmbedder: CodeEmbedder;
	private colbertEmbedder: ColBERTEmbedder;
	private collectionName = "engram_memory";

	constructor(url: string = "http://localhost:6333") {
		this.client = new QdrantClient({ url });
		this.textEmbedder = new TextEmbedder();
		this.codeEmbedder = new CodeEmbedder();
		this.colbertEmbedder = new ColBERTEmbedder();
	}

	async indexNode(node: IndexableNode) {
		const isCode = node.labels.includes("DiffHunk") || node.labels.includes("CodeArtifact");
		// Support both direct content and properties.content (from memory service)
		const content = isCode ? node.patch_content : node.content || node.properties?.content;

		if (!content || content.trim() === "") return; // Nothing to index

		// Generate sparse vector for hybrid search (BM25-based keyword matching)
		const sparseVector = await this.textEmbedder.embedSparse(content);

		// Generate ColBERT token embeddings for late interaction reranking
		const colbertEmbeddingsRaw = await this.colbertEmbedder.encodeDocument(content);
		// Convert Float32Array[] to number[][] for Qdrant multivector compatibility
		const colbertEmbeddings = colbertEmbeddingsRaw.map((token) => Array.from(token));

		// Payload
		const payload = {
			content: content,
			node_id: node.id,
			session_id: node.session_id || "unknown",
			type: isCode ? "code" : "thought",
			timestamp: node.timestamp || Date.now(),
			file_path: node.file_path,
		};

		// Generate vector and use the appropriate named vector field
		// Code uses code_dense (768d nomic-embed-text-v1)
		// Text uses text_dense (384d e5-small)
		// Both use colbert multivector (128d per token, jina-colbert-v2)
		if (isCode) {
			const codeVector = await this.codeEmbedder.embed(content);
			await this.client.upsert(this.collectionName, {
				points: [
					{
						id: node.id,
						vector: {
							code_dense: codeVector,
							sparse: sparseVector,
							colbert: colbertEmbeddings,
						},
						payload,
					},
				],
			});
		} else {
			const textVector = await this.textEmbedder.embed(content);
			await this.client.upsert(this.collectionName, {
				points: [
					{
						id: node.id,
						vector: {
							text_dense: textVector,
							sparse: sparseVector,
							colbert: colbertEmbeddings,
						},
						payload,
					},
				],
			});
		}
	}
}
