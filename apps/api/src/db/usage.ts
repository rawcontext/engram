import type { PostgresClient } from "@engram/storage";

export interface UsagePeriod {
	apiKeyId: string;
	periodStart: Date;
	periodEnd: Date;
	requestCount: number;
	errorCount: number;
	operations: Record<string, number>;
	createdAt: Date;
	updatedAt: Date;
}

interface DbUsagePeriod {
	api_key_id: string;
	period_start: Date;
	period_end: Date;
	request_count: number;
	error_count: number;
	operations: Record<string, number>;
	created_at: Date;
	updated_at: Date;
}

/**
 * Repository for API usage tracking operations
 */
export class UsageRepository {
	constructor(private readonly db: PostgresClient) {}

	/**
	 * Track a request for an API key
	 */
	async trackRequest(apiKeyId: string, operation: string, isError = false): Promise<void> {
		const now = new Date();
		const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
		const periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000); // 1 hour period

		await this.db.query(
			`
			INSERT INTO api_usage (api_key_id, period_start, period_end, request_count, error_count, operations)
			VALUES ($1, $2, $3, 1, $4, $5::jsonb)
			ON CONFLICT (api_key_id, period_start)
			DO UPDATE SET
				request_count = api_usage.request_count + 1,
				error_count = api_usage.error_count + $4,
				operations = jsonb_set(
					api_usage.operations,
					ARRAY[$6],
					to_jsonb(COALESCE((api_usage.operations->$6)::int, 0) + 1)
				)
			`,
			[
				apiKeyId,
				periodStart,
				periodEnd,
				isError ? 1 : 0,
				JSON.stringify({ [operation]: 1 }),
				operation,
			],
		);
	}

	/**
	 * Get usage statistics for an API key
	 */
	async getUsageStats(
		apiKeyId: string,
		options?: {
			startDate?: Date;
			endDate?: Date;
			limit?: number;
		},
	): Promise<UsagePeriod[]> {
		const startDate = options?.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
		const endDate = options?.endDate ?? new Date();
		const limit = options?.limit ?? 100;

		const rows = await this.db.queryMany<DbUsagePeriod>(
			`
			SELECT
				api_key_id, period_start, period_end, request_count, error_count,
				operations, created_at, updated_at
			FROM api_usage
			WHERE api_key_id = $1
			AND period_start >= $2
			AND period_start <= $3
			ORDER BY period_start DESC
			LIMIT $4
			`,
			[apiKeyId, startDate, endDate, limit],
		);

		return rows.map((row) => this.mapFromDb(row));
	}

	/**
	 * Get aggregated usage summary for an API key
	 */
	async getUsageSummary(
		apiKeyId: string,
		options?: {
			startDate?: Date;
			endDate?: Date;
		},
	): Promise<{
		totalRequests: number;
		totalErrors: number;
		operations: Record<string, number>;
		periodStart: Date;
		periodEnd: Date;
	}> {
		const startDate = options?.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const endDate = options?.endDate ?? new Date();

		const result = await this.db.queryOne<{
			total_requests: number;
			total_errors: number;
			operations: Record<string, number>;
		}>(
			`
			SELECT
				SUM(request_count)::int AS total_requests,
				SUM(error_count)::int AS total_errors,
				jsonb_object_agg(
					op_key,
					op_value
				) FILTER (WHERE op_key IS NOT NULL) AS operations
			FROM api_usage,
			LATERAL jsonb_each_text(operations) AS op(op_key, op_value)
			WHERE api_key_id = $1
			AND period_start >= $2
			AND period_start <= $3
			GROUP BY api_key_id
			`,
			[apiKeyId, startDate, endDate],
		);

		return {
			totalRequests: result?.total_requests ?? 0,
			totalErrors: result?.total_errors ?? 0,
			operations: result?.operations ?? {},
			periodStart: startDate,
			periodEnd: endDate,
		};
	}

	/**
	 * Map database row to UsagePeriod
	 */
	private mapFromDb(row: DbUsagePeriod): UsagePeriod {
		return {
			apiKeyId: row.api_key_id,
			periodStart: row.period_start,
			periodEnd: row.period_end,
			requestCount: row.request_count,
			errorCount: row.error_count,
			operations: row.operations,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
