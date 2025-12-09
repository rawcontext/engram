import { createServer } from "node:http";
import { SchemaManager, SearchIndexer, SearchRetriever } from "@engram/search-core";
import { createKafkaClient } from "@engram/storage";

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
			}: {
				topic: any;
				partition: any;
				message: any;
			}) => {
				try {
					const value = message.value?.toString();
					if (!value) return;
					const node = JSON.parse(value);
					if (
						node.labels &&
						(node.labels.includes("Thought") || node.labels.includes("CodeArtifact") || node.labels.includes("Turn"))
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

	async handleRequest(req: Request): Promise<Response> {
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

// Main execution
const PORT = 5002;

const schemaManager = new SchemaManager();
const indexer = new SearchIndexer();
const retriever = new SearchRetriever();
const kafka = createKafkaClient("search-service");

const service = new SearchService(retriever, indexer, schemaManager, kafka);
await service.initialize();

const server = createServer(async (req, res) => {
	const url = new URL(req.url || "", `http://localhost:${PORT}`);

	if (url.pathname === "/health") {
		res.writeHead(200);
		res.end("OK");
		return;
	}

	if (url.pathname === "/search" && req.method === "POST") {
		let body = "";

		req.on("data", (chunk) => {
			body += chunk.toString();
		});

		req.on("end", async () => {
			try {
				const parsed = JSON.parse(body);
				const results = await retriever.search(parsed);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(results));
			} catch (e: unknown) {
				const message = e instanceof Error ? e.message : String(e);
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: message }));
			}
		});
		return;
	}

	res.writeHead(404);
	res.end("Not Found");
});

server.listen(PORT, () => {
	console.log(`Search Service running on port ${PORT}`);
});
