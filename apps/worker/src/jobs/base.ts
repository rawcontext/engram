/**
 * Base Job Consumer for NATS JetStream
 *
 * Provides common functionality for job consumers:
 * - JetStream subscription with consumer.consume()
 * - Message acknowledgment with msg.ack()
 * - Error handling with exponential backoff retries (10ms, 100ms, 1s)
 * - Max 3 retries before DLQ
 * - Publish to dlq.worker.{subject} on final failure
 * - Structured error logging with job context
 */

import type { Logger } from "@engram/logger";
import { type JsMsg, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";

/**
 * Retry configuration for exponential backoff
 */
const RETRY_DELAYS_MS = [10, 100, 1000] as const;
const MAX_RETRIES = 3;

/**
 * Base class for all job consumers
 *
 * Handles NATS JetStream subscription, message processing, error handling, and retries.
 *
 * @example
 * ```typescript
 * class SessionSummaryConsumer extends BaseJobConsumer<SessionSummaryJob> {
 *   readonly subject = "worker.session_summary";
 *   readonly consumerName = "session-summary-worker";
 *
 *   async process(job: SessionSummaryJob): Promise<void> {
 *     // Process job logic here
 *   }
 * }
 * ```
 */
export abstract class BaseJobConsumer<T> {
	/** NATS subject to subscribe to (e.g., "worker.session_summary") */
	abstract readonly subject: string;

	/** Consumer name for durable subscription (e.g., "session-summary-worker") */
	abstract readonly consumerName: string;

	/** Stream name (defaults to "WORKER") */
	protected readonly streamName: string = "WORKER";

	/** NATS connection */
	private nc: NatsConnection | null = null;

	/** Base logger instance */
	protected baseLogger: Logger;

	/** Consumer-specific logger (lazy initialized) */
	private _logger: Logger | null = null;

	/** NATS URL */
	private natsUrl: string;

	/**
	 * Process a single job.
	 * Implement this method in subclasses with job-specific logic.
	 *
	 * @param job - Parsed job data
	 */
	abstract process(job: T): Promise<void>;

	/**
	 * Create a new job consumer
	 *
	 * @param logger - Logger instance
	 * @param natsUrl - NATS connection URL (defaults to env NATS_URL or localhost)
	 */
	constructor(logger: Logger, natsUrl?: string) {
		this.baseLogger = logger;
		this.natsUrl = natsUrl || process.env.NATS_URL || "nats://localhost:6181";
	}

	/**
	 * Get the logger instance (lazy initialized with consumer name)
	 */
	protected get logger(): Logger {
		if (!this._logger) {
			this._logger = this.baseLogger.child({ consumer: this.consumerName });
		}
		return this._logger;
	}

	/**
	 * Start consuming messages from NATS JetStream
	 *
	 * Establishes connection, creates consumer if needed, and begins processing messages.
	 */
	async subscribe(): Promise<void> {
		try {
			// Connect to NATS
			this.nc = await connect({ servers: this.natsUrl });
			this.logger.info({ subject: this.subject, stream: this.streamName }, "Connected to NATS");

			const js = jetstream(this.nc);
			const jsm = await jetstreamManager(this.nc);

			// Ensure consumer exists
			try {
				await jsm.consumers.add(this.streamName, {
					durable_name: this.consumerName,
					filter_subject: this.subject,
					ack_policy: "explicit",
					deliver_policy: "all",
					max_deliver: MAX_RETRIES + 1, // Original + retries
					ack_wait: 60_000_000_000, // 60 seconds in nanoseconds
				});
				this.logger.info({ consumer: this.consumerName }, "Consumer created or verified");
			} catch (err) {
				// Consumer may already exist, that's fine
				const error = err as Error;
				if (!error.message?.includes("already exists")) {
					throw err;
				}
				this.logger.debug({ consumer: this.consumerName }, "Consumer already exists");
			}

			// Get consumer and start consuming
			const consumer = await js.consumers.get(this.streamName, this.consumerName);
			const messages = await consumer.consume();

			this.logger.info({ subject: this.subject }, "Started consuming messages");

			// Process messages as they arrive
			for await (const msg of messages) {
				await this.handleMessage(msg);
			}
		} catch (err) {
			this.logger.error({ error: err }, "Failed to subscribe to NATS");
			throw err;
		}
	}

	/**
	 * Handle a single message with error handling and retries
	 *
	 * @param msg - JetStream message
	 */
	private async handleMessage(msg: JsMsg): Promise<void> {
		const msgContext = {
			subject: msg.subject,
			seq: msg.seq,
			deliveryCount: msg.info.deliveryCount,
			stream: msg.info.stream,
		};

		try {
			// Parse job data
			const jobData = JSON.parse(msg.string()) as T;

			this.logger.debug(msgContext, "Processing message");

			// Process the job
			await this.process(jobData);

			// Acknowledge successful processing
			msg.ack();

			this.logger.info(msgContext, "Message processed successfully");
		} catch (err) {
			await this.handleError(err as Error, msg);
		}
	}

	/**
	 * Handle processing errors with exponential backoff and DLQ
	 *
	 * @param err - Error that occurred
	 * @param msg - JetStream message
	 */
	private async handleError(err: Error, msg: JsMsg): Promise<void> {
		const deliveryCount = msg.info.deliveryCount;
		const msgContext = {
			subject: msg.subject,
			seq: msg.seq,
			deliveryCount,
			error: {
				name: err.name,
				message: err.message,
				stack: err.stack,
			},
		};

		this.logger.error(msgContext, "Message processing failed");

		// Check if we've exhausted retries
		if (deliveryCount >= MAX_RETRIES) {
			// Send to DLQ and terminate
			await this.sendToDLQ(msg, err);
			msg.term();
			this.logger.warn({ ...msgContext, dlqSubject: this.getDLQSubject() }, "Message sent to DLQ");
		} else {
			// Retry with exponential backoff
			const delayMs = RETRY_DELAYS_MS[deliveryCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

			// Negative acknowledge with delay
			msg.nak(delayMs);

			this.logger.info(
				{ ...msgContext, delayMs, nextRetry: deliveryCount + 1 },
				"Message negatively acknowledged, will retry",
			);
		}
	}

	/**
	 * Send failed message to Dead Letter Queue
	 *
	 * @param msg - Original message
	 * @param err - Error that caused failure
	 */
	private async sendToDLQ(msg: JsMsg, err: Error): Promise<void> {
		if (!this.nc) {
			this.logger.error("Cannot send to DLQ: NATS connection not available");
			return;
		}

		try {
			const js = jetstream(this.nc);
			const dlqSubject = this.getDLQSubject();

			// Construct DLQ message with error context
			const dlqMessage = {
				originalSubject: msg.subject,
				originalSeq: msg.seq,
				originalData: msg.string(),
				error: {
					name: err.name,
					message: err.message,
					stack: err.stack,
				},
				deliveryCount: msg.info.deliveryCount,
				timestamp: Date.now(),
			};

			await js.publish(dlqSubject, JSON.stringify(dlqMessage), {
				msgID: `dlq-${msg.seq}-${Date.now()}`,
			});

			this.logger.info(
				{
					dlqSubject,
					originalSubject: msg.subject,
					seq: msg.seq,
				},
				"Message published to DLQ",
			);
		} catch (dlqErr) {
			this.logger.error(
				{
					error: dlqErr,
					originalError: err,
					subject: msg.subject,
					seq: msg.seq,
				},
				"Failed to publish message to DLQ",
			);
		}
	}

	/**
	 * Get the DLQ subject for this consumer
	 *
	 * @returns DLQ subject (e.g., "dlq.worker.session_summary")
	 */
	private getDLQSubject(): string {
		return `dlq.${this.subject}`;
	}

	/**
	 * Disconnect from NATS and clean up resources
	 */
	async disconnect(): Promise<void> {
		if (this.nc) {
			await this.nc.drain();
			await this.nc.close();
			this.nc = null;
			this.logger.info("Disconnected from NATS");
		}
	}
}
