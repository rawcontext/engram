import { createServer } from "node:http";
import { createNodeLogger, type Logger } from "@engram/logger";
import { SchemaManager, SearchIndexer, SearchRetriever } from "@engram/search-core";
import { createKafkaClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";

/**
 * Dependencies for SearchService construction.
 * Supports dependency injection for testability.
 */
export interface SearchServiceDeps {
	/** Search retriever for query execution. Defaults to new SearchRetriever. */
	retriever?: SearchRetriever;
	/** Search indexer for indexing nodes. Defaults to new SearchIndexer. */
	indexer?: SearchIndexer;
	/** Schema manager for collection management. Defaults to new SchemaManager. */
	schemaManager?: SchemaManager;
	/** Kafka client for event streaming. */
	kafkaClient?: ReturnType<typeof createKafkaClient>;
	/** Logger instance. */
	logger?: Logger;
}

export class SearchService {
	private retriever: SearchRetriever;
	private indexer: SearchIndexer;
	private schemaManager: SchemaManager;
	private kafkaClient: ReturnType<typeof createKafkaClient>;
	private logger: Logger;

	/**
	 * Create a SearchService with injectable dependencies.
	 * @param deps - Optional dependencies. Defaults are used when not provided.
	 */
	constructor(deps?: SearchServiceDeps);
	/** @deprecated Use SearchServiceDeps object instead */
	constructor(
		retriever: SearchRetriever,
		indexer: SearchIndexer,
		schemaManager: SchemaManager,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		kafkaClient: any,
	);
	constructor(
		depsOrRetriever?: SearchServiceDeps | SearchRetriever,
		indexerArg?: SearchIndexer,
		schemaManagerArg?: SchemaManager,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		kafkaClientArg?: any,
	) {
		if (
			depsOrRetriever === undefined ||
			(typeof depsOrRetriever === "object" &&
				"retriever" in depsOrRetriever === false &&
				"search" in depsOrRetriever === false &&
				indexerArg === undefined)
		) {
			// New deps object constructor or empty
			const deps = (depsOrRetriever ?? {}) as SearchServiceDeps;
			this.retriever = deps.retriever ?? new SearchRetriever();
			this.indexer = deps.indexer ?? new SearchIndexer();
			this.schemaManager = deps.schemaManager ?? new SchemaManager();
			this.kafkaClient = deps.kafkaClient ?? createKafkaClient("search-service");
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "search-service",
					base: { component: "main" },
				});
		} else if (
			"search" in depsOrRetriever &&
			typeof (depsOrRetriever as SearchRetriever).search === "function"
		) {
			// Legacy constructor: positional args
			this.retriever = depsOrRetriever as SearchRetriever;
			if (!indexerArg) throw new Error("indexer required for legacy constructor");
			if (!schemaManagerArg) throw new Error("schemaManager required for legacy constructor");
			if (!kafkaClientArg) throw new Error("kafkaClient required for legacy constructor");
			this.indexer = indexerArg;
			this.schemaManager = schemaManagerArg;
			this.kafkaClient = kafkaClientArg;
			this.logger = createNodeLogger({
				service: "search-service",
				base: { component: "main" },
			});
		} else {
			// Deps object
			const deps = depsOrRetriever as SearchServiceDeps;
			this.retriever = deps.retriever ?? new SearchRetriever();
			this.indexer = deps.indexer ?? new SearchIndexer();
			this.schemaManager = deps.schemaManager ?? new SchemaManager();
			this.kafkaClient = deps.kafkaClient ?? createKafkaClient("search-service");
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "search-service",
					base: { component: "main" },
				});
		}
	}

	async initialize() {
		await this.schemaManager.ensureCollection();
		await this.startConsumer();
	}

	async startConsumer() {
		const consumer = await this.kafkaClient.createConsumer("search-group");
		await consumer.subscribe({ topic: "memory.node_created", fromBeginning: false });

		// Publish consumer ready status to Redis
		const redis = createRedisPublisher();
		await redis.publishConsumerStatus("consumer_ready", "search-group", "search-service");
		this.logger.info("Published consumer_ready status for search-group");

		// Periodic heartbeat every 10 seconds
		const heartbeatInterval = setInterval(async () => {
			try {
				await redis.publishConsumerStatus("consumer_heartbeat", "search-group", "search-service");
			} catch (e) {
				this.logger.error({ err: e }, "Failed to publish heartbeat");
			}
		}, 10000);

		// Cleanup heartbeat on process exit
		process.on("SIGTERM", () => {
			clearInterval(heartbeatInterval);
			redis.publishConsumerStatus("consumer_disconnected", "search-group", "search-service");
		});
		process.on("SIGINT", () => {
			clearInterval(heartbeatInterval);
			redis.publishConsumerStatus("consumer_disconnected", "search-group", "search-service");
		});

		await consumer.run({
			eachMessage: async ({
				topic: _topic,
				partition: _partition,
				message,
			}: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				topic: any;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				partition: any;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				message: any;
			}) => {
				try {
					const value = message.value?.toString();
					if (!value) return;
					const node = JSON.parse(value);
					if (
						node.labels &&
						(node.labels.includes("Thought") ||
							node.labels.includes("CodeArtifact") ||
							node.labels.includes("Turn"))
					) {
						await this.indexer.indexNode(node);
						this.logger.info({ nodeId: node.id }, "Indexed node");
					}
				} catch (e) {
					this.logger.error({ err: e }, "Indexing error");
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

	/**
	 * Get the retriever instance (for external access in HTTP handlers)
	 */
	getRetriever(): SearchRetriever {
		return this.retriever;
	}
}

/**
 * Factory function for creating SearchService instances.
 * Supports dependency injection for testability.
 *
 * @example
 * // Production usage (uses defaults)
 * const service = createSearchService();
 *
 * @example
 * // Test usage (inject mocks)
 * const service = createSearchService({
 *   retriever: mockRetriever,
 *   indexer: mockIndexer,
 *   kafkaClient: mockKafka,
 * });
 */
export function createSearchService(deps?: SearchServiceDeps): SearchService {
	return new SearchService(deps);
}

// Main execution
const PORT = 5002;

const logger = createNodeLogger({
	service: "search-service",
	base: { component: "main" },
});

const service = createSearchService({ logger });
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
				const results = await service.getRetriever().search(parsed);
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
	logger.info({ port: PORT }, "Search Service running");
});
