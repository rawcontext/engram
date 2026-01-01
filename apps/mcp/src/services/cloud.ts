/**
 * Engram Cloud Client
 *
 * HTTP client for the Engram Cloud API that implements IEngramClient.
 * Used in cloud mode to proxy MCP tool calls to the Hetzner API.
 *
 * Supports two authentication methods:
 * 1. API Key - traditional Bearer token authentication
 * 2. OAuth - device flow tokens managed via TokenCache
 */

import type { MemoryNode, MemoryType } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { DeviceFlowClient } from "../auth/device-flow";
import type { TokenCache } from "../auth/token-cache";
import type {
	ContextItem,
	CreateMemoryInput,
	IEngramClient,
	RecallFilters,
	RecallResult,
	TenantContext,
} from "./interfaces";

export interface EngramCloudClientOptions {
	baseUrl: string;
	logger: Logger;
	/** Static API key (takes precedence over OAuth) */
	apiKey?: string;
	/** Token cache for OAuth authentication */
	tokenCache?: TokenCache;
	/** Device flow client for token refresh */
	deviceFlowClient?: DeviceFlowClient;
}

interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
	meta?: {
		usage?: unknown;
	};
}

export class EngramCloudClient implements IEngramClient {
	private readonly apiKey?: string;
	private readonly baseUrl: string;
	private readonly logger: Logger;
	private readonly tokenCache?: TokenCache;
	private readonly deviceFlowClient?: DeviceFlowClient;

	constructor(options: EngramCloudClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = options.baseUrl.replace(/\/$/, ""); // Remove trailing slash
		this.logger = options.logger;
		this.tokenCache = options.tokenCache;
		this.deviceFlowClient = options.deviceFlowClient;

		// Validate that we have at least one auth method
		if (!this.apiKey && !this.tokenCache) {
			throw new Error("EngramCloudClient requires either apiKey or tokenCache for authentication");
		}
	}

	// ==========================================================================
	// Authentication
	// ==========================================================================

	/**
	 * Get the current access token for API requests.
	 * Priority: API key > OAuth token (with automatic refresh)
	 */
	private async getAccessToken(): Promise<string> {
		// API key takes precedence (simpler, no refresh needed)
		if (this.apiKey) {
			return this.apiKey;
		}

		// Try to get a valid OAuth token
		if (this.deviceFlowClient) {
			const token = await this.deviceFlowClient.getValidAccessToken();
			if (token) {
				return token;
			}
		}

		// Check token cache directly (might have a valid token without needing refresh)
		if (this.tokenCache) {
			const token = this.tokenCache.getAccessToken();
			if (token) {
				return token;
			}
		}

		throw new Error(
			"No valid authentication token available. Please run device flow authentication.",
		);
	}

	// ==========================================================================
	// HTTP Helpers
	// ==========================================================================

	private async request<T>(
		method: "GET" | "POST" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const token = await this.getAccessToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		};

		this.logger.debug({ method, url, body }, "API request");

		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		const json = (await response.json()) as ApiResponse<T>;

		// Handle token expiration - try to refresh and retry once
		if (response.status === 401 && this.deviceFlowClient && !this.apiKey) {
			this.logger.debug("Access token expired, attempting refresh");
			const refreshResult = await this.deviceFlowClient.refreshToken();
			if (refreshResult.success && refreshResult.tokens) {
				// Retry the request with the new token
				const retryHeaders: Record<string, string> = {
					"Content-Type": "application/json",
					Authorization: `Bearer ${refreshResult.tokens.access_token}`,
				};
				const retryResponse = await fetch(url, {
					method,
					headers: retryHeaders,
					body: body ? JSON.stringify(body) : undefined,
				});
				const retryJson = (await retryResponse.json()) as ApiResponse<T>;
				if (retryResponse.ok && retryJson.success) {
					this.logger.debug(
						{ status: retryResponse.status },
						"API retry successful after token refresh",
					);
					return retryJson.data as T;
				}
			}

			// Both access token and refresh failed - clear cache and trigger new device flow
			this.logger.warn("Token refresh failed, triggering new device flow authentication");
			this.tokenCache?.clear();

			const deviceResult = await this.deviceFlowClient.startDeviceFlow({
				openBrowser: true,
				onDisplayCode: (code, url, urlComplete) => {
					// Use stderr for prompts (stdout reserved for MCP protocol)
					console.error("\n┌─────────────────────────────────────────────────────┐");
					console.error("│  SESSION EXPIRED - RE-AUTHENTICATION REQUIRED       │");
					console.error("│                                                     │");
					console.error(`│  Visit: ${url.padEnd(41)}│`);
					console.error(`│  Enter code: ${code.padEnd(37)}│`);
					console.error("│                                                     │");
					console.error(`│  Or open: ${urlComplete.slice(0, 39).padEnd(39)}│`);
					console.error("└─────────────────────────────────────────────────────┘\n");
				},
				onPolling: () => {
					console.error("Waiting for re-authorization...");
				},
				onSuccess: (email) => {
					console.error(`\n✓ Re-authenticated as ${email}\n`);
				},
			});

			if (deviceResult.success) {
				// Retry the original request with new credentials
				const newToken = await this.getAccessToken();
				const finalHeaders: Record<string, string> = {
					"Content-Type": "application/json",
					Authorization: `Bearer ${newToken}`,
				};
				const finalResponse = await fetch(url, {
					method,
					headers: finalHeaders,
					body: body ? JSON.stringify(body) : undefined,
				});
				const finalJson = (await finalResponse.json()) as ApiResponse<T>;
				if (finalResponse.ok && finalJson.success) {
					this.logger.info("API request successful after re-authentication");
					return finalJson.data as T;
				}
			}

			throw new Error("Authentication failed. Please restart the MCP server and try again.");
		}

		if (!response.ok || !json.success) {
			const error = json.error ?? { code: "UNKNOWN_ERROR", message: "Request failed" };
			this.logger.error({ status: response.status, error }, "API error");
			throw new Error(`${error.code}: ${error.message}`);
		}

		this.logger.debug({ status: response.status, data: json.data }, "API response");
		return json.data as T;
	}

	// ==========================================================================
	// IMemoryStore Implementation
	// ==========================================================================

	async createMemory(input: CreateMemoryInput): Promise<MemoryNode> {
		const result = await this.request<{ id: string; stored: boolean; duplicate: boolean }>(
			"POST",
			"/v1/memory/remember",
			{
				content: input.content,
				type: input.type,
				tags: input.tags,
				project: input.project,
				tenant: input.tenant,
			},
		);

		// The API returns a minimal response; construct a MemoryNode-like object
		// Note: This is a best-effort construction since the API doesn't return full node data
		const now = Date.now();
		const memoryNode: MemoryNode = {
			id: result.id,
			labels: ["Memory"],
			content: input.content,
			content_hash: "", // Not returned by API
			type: (input.type ?? "context") as MemoryType,
			tags: input.tags ?? [],
			source: input.source ?? "user",
			project: input.project,
			working_dir: input.workingDir,
			source_session_id: input.sourceSessionId,
			source_turn_id: input.sourceTurnId,
			vt_start: now,
			vt_end: 253402300799000,
			tt_start: now,
			tt_end: 253402300799000,
		};

		this.logger.info(
			{ id: result.id, stored: result.stored, duplicate: result.duplicate },
			"Memory created via cloud API",
		);
		return memoryNode;
	}

	async getMemory(id: string): Promise<MemoryNode | null> {
		// Not available in current API - use query endpoint as fallback
		try {
			const results = await this.query<MemoryNode>(
				"MATCH (m:Memory {id: $id}) WHERE m.tt_end > timestamp() RETURN m",
				{ id },
			);
			return results[0] ?? null;
		} catch (error) {
			this.logger.warn({ id, error }, "getMemory not available in cloud mode");
			return null;
		}
	}

	async listMemories(options?: {
		type?: MemoryType;
		project?: string;
		limit?: number;
	}): Promise<MemoryNode[]> {
		// Not directly available - use query endpoint
		try {
			const limit = options?.limit ?? 20;
			let cypher = "MATCH (m:Memory) WHERE m.tt_end > timestamp()";

			if (options?.type) {
				cypher += " AND m.type = $type";
			}
			if (options?.project) {
				cypher += " AND m.project = $project";
			}

			cypher += " RETURN m ORDER BY m.vt_start DESC LIMIT $limit";

			return await this.query<MemoryNode>(cypher, {
				type: options?.type,
				project: options?.project,
				limit,
			});
		} catch (error) {
			this.logger.warn({ options, error }, "listMemories not available in cloud mode");
			return [];
		}
	}

	async deleteMemory(id: string): Promise<boolean> {
		// Not available in current API
		this.logger.warn({ id }, "deleteMemory not available in cloud mode");
		return false;
	}

	async connect(): Promise<void> {
		// HTTP client doesn't need connection management
		this.logger.debug("Cloud client connected (no-op)");
	}

	async disconnect(): Promise<void> {
		// HTTP client doesn't need connection management
		this.logger.debug("Cloud client disconnected (no-op)");
	}

	// ==========================================================================
	// IMemoryRetriever Implementation
	// ==========================================================================

	async recall(query: string, limit = 5, filters?: RecallFilters): Promise<RecallResult[]> {
		// API returns camelCase but our interface uses snake_case
		interface ApiMemoryResult {
			id: string;
			content: string;
			type: string;
			tags: string[];
			score?: number;
			createdAt: string;
		}

		const result = await this.request<{ memories: ApiMemoryResult[] }>(
			"POST",
			"/v1/memory/recall",
			{
				query,
				limit,
				filters: filters
					? {
							type: filters.type,
							project: filters.project,
							after: filters.since,
							vtEndAfter: filters.vtEndAfter ?? Date.now(),
						}
					: { vtEndAfter: Date.now() },
				tenant: filters?.tenant,
			},
		);

		// Map API response to RecallResult interface
		return result.memories.map((m) => ({
			id: m.id,
			content: m.content,
			score: m.score ?? 0,
			type: m.type,
			created_at: m.createdAt,
			project: filters?.project,
		}));
	}

	// ==========================================================================
	// IEngramClient Additional Methods
	// ==========================================================================

	async query<T = unknown>(
		cypher: string,
		params?: Record<string, unknown>,
		tenant?: TenantContext,
	): Promise<T[]> {
		const result = await this.request<{ results: T[] }>("POST", "/v1/memory/query", {
			cypher,
			params,
			tenant,
		});

		return result.results;
	}

	async getContext(
		task: string,
		files?: string[],
		depth: "shallow" | "medium" | "deep" = "medium",
		tenant?: TenantContext,
	): Promise<ContextItem[]> {
		const result = await this.request<{ context: ContextItem[] }>("POST", "/v1/memory/context", {
			task,
			files,
			depth,
			tenant,
		});

		return result.context;
	}
}
