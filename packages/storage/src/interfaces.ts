/**
 * Storage Interface Layer
 *
 * These interfaces decouple application components from concrete storage implementations,
 * enabling dependency injection, testing, and future infrastructure changes.
 */

// =============================================================================
// Message Queue Types (defined here to avoid circular dependencies)
// =============================================================================

/**
 * Kafka message structure
 */
export type KafkaMessage = {
	key?: Buffer;
	value: Buffer;
	offset: string;
	timestamp?: string;
	headers?: Record<string, Buffer | string | undefined>;
};

/**
 * Kafka consumer interface with KafkaJS-compatible API
 */
export type Consumer = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	subscribe(opts: { topic: string; fromBeginning?: boolean }): Promise<void>;
	run(opts: {
		eachMessage: (payload: {
			topic: string;
			partition: number;
			message: KafkaMessage;
		}) => Promise<void>;
	}): void;
};

/**
 * Kafka producer interface
 */
export type Producer = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(opts: { topic: string; messages: Array<{ key: string; value: string }> }): Promise<void>;
};

// =============================================================================
// Graph Database Interface
// =============================================================================

/**
 * GraphClient abstracts graph database operations (e.g., FalkorDB).
 * Enables switching between graph backends without changing consumer code.
 */
export interface GraphClient {
	/**
	 * Establish connection to the graph database.
	 */
	connect(): Promise<void>;

	/**
	 * Close the graph database connection.
	 */
	disconnect(): Promise<void>;

	/**
	 * Execute a typed Cypher query against the graph.
	 * @template T - The expected row shape of the result
	 * @param cypher - The Cypher query string
	 * @param params - Optional query parameters
	 * @returns Typed array of result rows
	 */
	query<T = Record<string, unknown>>(
		cypher: string,
		params?: Record<string, unknown>,
	): Promise<T[]>;

	/**
	 * Check if the client is currently connected.
	 */
	isConnected(): boolean;
}

// =============================================================================
// Message Queue Interface
// =============================================================================

/**
 * Configuration for creating a consumer.
 */
export interface ConsumerConfig {
	groupId: string;
}

/**
 * MessageClient abstracts message queue operations (e.g., NATS JetStream).
 * Enables switching between message brokers without changing consumer code.
 */
export interface MessageClient {
	/**
	 * Get or create a producer instance.
	 * The producer is typically a singleton per client.
	 */
	getProducer(): Promise<Producer>;

	/**
	 * Create a new consumer with the specified configuration.
	 * @param config - Consumer configuration including group ID
	 */
	getConsumer(config: ConsumerConfig): Promise<Consumer>;

	/**
	 * Disconnect all producers and consumers.
	 */
	disconnect(): Promise<void>;
}

// =============================================================================
// Blob Storage Interface
// =============================================================================

/**
 * BlobStore abstracts blob/file storage operations (e.g., filesystem, GCS, S3).
 * Content is stored by hash for deduplication.
 */
export interface BlobStore {
	/**
	 * Save content to blob storage.
	 * @param content - The content to store (string or binary)
	 * @returns URI pointing to the stored blob (e.g., file://, gs://)
	 */
	save(content: string | Buffer): Promise<string>;

	/**
	 * Load content from blob storage.
	 * @param uri - The URI returned from save()
	 * @returns The stored content
	 */
	load(uri: string): Promise<string>;
}

// =============================================================================
// Redis Pub/Sub Interface
// =============================================================================

/**
 * RedisPublisher abstracts Redis pub/sub publishing operations.
 * Used for real-time session updates to connected clients.
 */
export interface RedisPublisher {
	/**
	 * Publish an update to a session-specific channel.
	 * @param sessionId - The session to publish to
	 * @param event - The event payload
	 */
	publishSessionUpdate(sessionId: string, event: unknown): Promise<void>;

	/**
	 * Close the Redis connection.
	 */
	disconnect(): Promise<void>;
}
