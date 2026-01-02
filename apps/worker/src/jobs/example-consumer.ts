/**
 * Example Job Consumer
 *
 * Demonstrates how to extend BaseJobConsumer for specific job types.
 * This is a reference implementation - delete or modify as needed.
 */

import { BaseJobConsumer } from "./base";

/**
 * Example job data structure
 */
interface ExampleJob {
	id: string;
	type: string;
	payload: {
		message: string;
		timestamp: number;
	};
}

/**
 * Example consumer that processes jobs from worker.example subject
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const consumer = new ExampleJobConsumer(logger);
 *
 * await consumer.subscribe();
 * ```
 */
export class ExampleJobConsumer extends BaseJobConsumer<ExampleJob> {
	readonly subject = "worker.example";
	readonly consumerName = "example-job-worker";

	/**
	 * Process an example job
	 *
	 * Implements the abstract process method from BaseJobConsumer.
	 * This method is called for each message received from NATS.
	 *
	 * @param job - The parsed job data
	 */
	async process(job: ExampleJob): Promise<void> {
		this.logger.info(
			{
				jobId: job.id,
				jobType: job.type,
				message: job.payload.message,
			},
			"Processing example job",
		);

		// Simulate some work
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Job processing logic goes here
		// If this throws an error, BaseJobConsumer will:
		// 1. Log the error with context
		// 2. Retry with exponential backoff (10ms, 100ms, 1s)
		// 3. Send to DLQ after 3 failed attempts

		this.logger.info({ jobId: job.id }, "Example job completed");
	}
}
