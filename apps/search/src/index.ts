import { SchemaManager, SearchIndexer, SearchRetriever } from "@the-soul/search-core";
import { createKafkaClient } from "@the-soul/storage";

import { SchemaManager, SearchIndexer, SearchRetriever } from "@the-soul/search-core";
import { createKafkaClient } from "@the-soul/storage";

export class SearchService {
	constructor(
		private retriever: SearchRetriever,
		private indexer: SearchIndexer,
		private schemaManager: SchemaManager,
		private kafkaClient: any,
	) {}

	async initialize() {
		await this.schemaManager.ensureCollection();
		await this.startConsumer();
	}

	async startConsumer() {
		const consumer = await this.kafkaClient.createConsumer("search-group");
		await consumer.subscribe({ topic: "memory.node_created", fromBeginning: false });

		await consumer.run({
			eachMessage: async ({
				topic: _topic,
				partition: _partition,
				message,
			}: { topic: any; partition: any; message: any }) => {
				try {
					const value = message.value?.toString();
					if (!value) return;
					const node = JSON.parse(value);
					if (
						node.labels &&
						(node.labels.includes("Thought") || node.labels.includes("CodeArtifact"))
					) {
						await this.indexer.indexNode(node);
						console.log(`Indexed node ${node.id}`);
					}
				} catch (e) {
					console.error("Indexing error", e);
				}
			},
		});
	}

	async handleRequest(req: Request) {
		const url = new URL(req.url);
		if (url.pathname === "/health") return new Response("OK");

		if (url.pathname === "/search" && req.method === "POST") {
			try {
				const body = await req.json();
				const results = await this.retriever.search(body);
				return new Response(JSON.stringify(results), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (e: unknown) {
				const message = e instanceof Error ? e.message : String(e);
				return new Response(JSON.stringify({ error: message }), { status: 400 });
			}
		}
		return new Response("Not Found", { status: 404 });
	}
}

if (import.meta.main) {
	const schemaManager = new SchemaManager();
	const indexer = new SearchIndexer();
	const retriever = new SearchRetriever();
	const kafka = createKafkaClient("search-service");

	const service = new SearchService(retriever, indexer, schemaManager, kafka);
	await service.initialize();

	const server = Bun.serve({
		port: 8080,
		fetch: service.handleRequest.bind(service),
	});

	console.log(`Search Service running on port ${server.port}`);
}
