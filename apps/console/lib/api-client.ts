"use client";

import type { EnvironmentConfig } from "./environment";

export interface ServiceHealth {
	name: string;
	status: "online" | "warning" | "error" | "offline";
	latency?: number;
	port?: number;
	message?: string;
	version?: string;
}

export interface SystemMetrics {
	totalRequests: number;
	errorRate: number;
	avgLatency: number;
	activeSessions: number;
}

export interface MetricDataPoint {
	timestamp: number;
	value: number;
}

export interface MetricData {
	id: string;
	title: string;
	value: number;
	unit?: string;
	change: number;
	changeUnit?: string;
	trend: "up" | "down" | "stable";
	sparkline: MetricDataPoint[];
}

export interface ApiError extends Error {
	status: number;
	code?: string;
}

export class ApiClient {
	private baseUrl: string;
	private wsUrl: string;
	private useProxy: boolean;

	constructor(environment: EnvironmentConfig, _authToken?: string) {
		this.baseUrl = environment.apiUrl;
		this.wsUrl = environment.wsUrl;
		// Always use proxy for authenticated API calls - the proxy validates session
		// and adds service token for Engram API requests
		this.useProxy = true;
	}

	/**
	 * Make a request through the session-validated proxy
	 * Proxy validates session and adds Engram API auth token
	 */
	private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
		// Route through proxy which validates session and adds auth
		// Path should be like /v1/metrics -> /api/proxy/metrics
		const proxyPath = path.replace(/^\/v1\//, "/api/proxy/");
		const url = this.useProxy ? proxyPath : `${this.baseUrl}${path}`;

		const headers: HeadersInit = {
			"Content-Type": "application/json",
			...options.headers,
		};

		const response = await fetch(url, {
			...options,
			headers,
			credentials: "include", // Include session cookies for proxy
		});

		if (!response.ok) {
			const error = new Error(`API error: ${response.statusText}`) as ApiError;
			error.status = response.status;
			try {
				const body = await response.json();
				error.message = body.error?.message || body.message || error.message;
				error.code = body.error?.code || body.code;
			} catch {
				// Ignore JSON parse errors
			}
			throw error;
		}

		const json = await response.json();
		// Unwrap { success: true, data: T } responses from API
		if (json && typeof json === "object" && "success" in json && "data" in json) {
			return json.data as T;
		}
		return json as T;
	}

	// Health checks
	async checkHealth(): Promise<{ status: string; timestamp: string }> {
		return this.fetch("/v1/health");
	}

	async getServiceHealth(service: string): Promise<ServiceHealth> {
		try {
			const start = performance.now();
			const result = await this.fetch<{ status: string }>(`/v1/health`);
			const latency = Math.round(performance.now() - start);

			return {
				name: service,
				status: result.status === "ok" ? "online" : "warning",
				latency,
			};
		} catch (error) {
			return {
				name: service,
				status: "offline",
				message: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Check if this is a production environment (no port in URL)
	 */
	private isProduction(): boolean {
		// Production URLs don't have ports (e.g., https://api.engram.rawcontext.com)
		// Local URLs have ports (e.g., http://localhost:6174)
		return !/:(\d+)/.test(this.baseUrl);
	}

	/**
	 * Get the health check URL for a service based on environment
	 * Production routing is defined in configs/Caddyfile
	 */
	private getServiceHealthUrl(
		name: string,
		port: number,
		localPath: string,
	): { url: string; skip: boolean } {
		const isProd = this.isProduction();

		if (isProd) {
			// In production, services are behind Caddy reverse proxy
			switch (name) {
				case "API":
					return { url: `${this.baseUrl}/v1/health`, skip: false };
				case "Search":
					return { url: `${this.baseUrl}/v1/search/health`, skip: false };
				case "Tuner":
					return { url: `${this.baseUrl}/v1/tuner/health`, skip: false };
				case "Observatory":
					// Observatory has its own subdomain
					return {
						url: `${this.baseUrl.replace("api.", "observatory.")}/api/health`,
						skip: false,
					};
				case "Ingestion":
					// Ingestion only exposes /ingest in production, no health check
					return { url: "", skip: true };
				default:
					return { url: `${this.baseUrl}${localPath}`, skip: false };
			}
		}

		// In local dev, each service runs on its own port
		const url = `${this.baseUrl.replace(/:(\d+)/, `:${port}`)}${localPath}`;
		return { url, skip: false };
	}

	// Check multiple services health
	// In production, uses server-side proxy to avoid CORS issues
	// In local dev, makes direct requests to each service
	async getAllServicesHealth(): Promise<ServiceHealth[]> {
		// In production, use the health-check proxy to avoid CORS
		if (this.isProduction()) {
			try {
				const response = await fetch("/api/health-check", {
					method: "GET",
					signal: AbortSignal.timeout(10000),
				});
				if (response.ok) {
					const results = (await response.json()) as Array<{
						name: string;
						status: "online" | "warning" | "offline";
						latency?: number;
						message?: string;
					}>;
					// Add port numbers for display
					const portMap: Record<string, number> = {
						API: 6174,
						Ingestion: 6175,
						Search: 6176,
						Tuner: 6177,
						Observatory: 6178,
					};
					return results.map((r) => ({
						...r,
						port: portMap[r.name],
					}));
				}
			} catch {
				// Fall through to return all offline
			}
			return [
				{ name: "API", port: 6174, status: "offline", message: "Health check failed" },
				{ name: "Ingestion", port: 6175, status: "offline", message: "Not exposed" },
				{ name: "Search", port: 6176, status: "offline", message: "Health check failed" },
				{ name: "Tuner", port: 6177, status: "offline", message: "Health check failed" },
				{ name: "Observatory", port: 6178, status: "offline", message: "Health check failed" },
			];
		}

		// In local dev, make direct requests to each service
		const services = [
			{ name: "API", port: 6174, localPath: "/v1/health" },
			{ name: "Ingestion", port: 6175, localPath: "/health" },
			{ name: "Search", port: 6176, localPath: "/v1/search/health" },
			{ name: "Tuner", port: 6177, localPath: "/v1/tuner/health" },
			{ name: "Observatory", port: 6178, localPath: "/api/health" },
		];

		const results = await Promise.allSettled(
			services.map(async (service) => {
				const { url, skip } = this.getServiceHealthUrl(
					service.name,
					service.port,
					service.localPath,
				);

				// Skip services without production health endpoints
				if (skip) {
					return {
						name: service.name,
						port: service.port,
						status: "offline" as const,
						message: "Not exposed",
					};
				}

				const start = performance.now();

				try {
					const response = await fetch(url, {
						method: "GET",
						signal: AbortSignal.timeout(5000),
					});
					const latency = Math.round(performance.now() - start);

					if (response.ok) {
						return {
							name: service.name,
							port: service.port,
							status: "online" as const,
							latency,
						};
					}
					return {
						name: service.name,
						port: service.port,
						status: "warning" as const,
						latency,
						message: `HTTP ${response.status}`,
					};
				} catch {
					return {
						name: service.name,
						port: service.port,
						status: "offline" as const,
						message: "Connection failed",
					};
				}
			}),
		);

		return results.map((result, i) =>
			result.status === "fulfilled"
				? result.value
				: {
						name: services[i].name,
						port: services[i].port,
						status: "offline" as const,
						message: "Check failed",
					},
		);
	}

	// Infrastructure services (databases, message queues)
	async getInfraHealth(): Promise<ServiceHealth[]> {
		const infra = [
			{ name: "FalkorDB", port: 6179 },
			{ name: "Qdrant", port: 6180 },
			{ name: "NATS", port: 6181 },
			{ name: "PostgreSQL", port: 6183 },
		];

		// For infrastructure, we check via the API's health endpoint which reports on dependencies
		try {
			const health = await this.fetch<{
				dependencies?: Record<string, { status: string; latency?: number }>;
			}>("/v1/health");

			return infra.map((service) => {
				const dep = health.dependencies?.[service.name.toLowerCase()];
				return {
					name: service.name,
					port: service.port,
					status: dep?.status === "ok" ? ("online" as const) : ("offline" as const),
					latency: dep?.latency,
				};
			});
		} catch {
			// If API is down, mark all infra as unknown
			return infra.map((service) => ({
				name: service.name,
				port: service.port,
				status: "offline" as const,
				message: "API unreachable",
			}));
		}
	}

	// System metrics
	async getSystemMetrics(): Promise<MetricData[]> {
		// Generate sparkline data (last 24 hours, hourly points)
		const generateSparkline = (baseValue: number, variance: number): MetricDataPoint[] => {
			const now = Date.now();
			const hourMs = 60 * 60 * 1000;
			return Array.from({ length: 24 }, (_, i) => ({
				timestamp: now - (23 - i) * hourMs,
				value: baseValue + (Math.random() - 0.5) * variance * 2,
			}));
		};

		// Fetch real metrics from API
		const metrics = await this.fetch<{
			requests?: { total: number; change: number };
			errors?: { rate: number; change: number };
			latency?: { avg: number; change: number };
			sessions?: { active: number; change: number };
		}>("/v1/metrics");

		return [
			{
				id: "requests",
				title: "Total Requests",
				value: metrics.requests?.total ?? 0,
				change: metrics.requests?.change ?? 0,
				trend: (metrics.requests?.change ?? 0) >= 0 ? "up" : "down",
				sparkline: generateSparkline(metrics.requests?.total ?? 1000, 200),
			},
			{
				id: "errors",
				title: "Error Rate",
				value: metrics.errors?.rate ?? 0,
				unit: "%",
				change: metrics.errors?.change ?? 0,
				changeUnit: "%",
				trend: (metrics.errors?.change ?? 0) <= 0 ? "up" : "down",
				sparkline: generateSparkline(metrics.errors?.rate ?? 0.1, 0.05),
			},
			{
				id: "latency",
				title: "Avg Latency",
				value: metrics.latency?.avg ?? 0,
				unit: "ms",
				change: metrics.latency?.change ?? 0,
				changeUnit: "ms",
				trend: (metrics.latency?.change ?? 0) <= 0 ? "up" : "down",
				sparkline: generateSparkline(metrics.latency?.avg ?? 25, 10),
			},
			{
				id: "sessions",
				title: "Active Sessions",
				value: metrics.sessions?.active ?? 0,
				change: metrics.sessions?.change ?? 0,
				trend: (metrics.sessions?.change ?? 0) >= 0 ? "up" : "down",
				sparkline: generateSparkline(metrics.sessions?.active ?? 100, 30),
			},
		];
	}

	// Log entries
	async getLogEntries(filters?: {
		services?: string[];
		levels?: string[];
		search?: string;
		timeRange?: string;
	}): Promise<
		Array<{
			id: string;
			timestamp: number;
			service: string;
			level: "debug" | "info" | "warn" | "error";
			message: string;
			metadata?: Record<string, unknown>;
		}>
	> {
		const params = new URLSearchParams();
		if (filters?.services?.length) params.set("services", filters.services.join(","));
		if (filters?.levels?.length) params.set("levels", filters.levels.join(","));
		if (filters?.search) params.set("search", filters.search);
		if (filters?.timeRange) params.set("range", filters.timeRange);

		return this.fetch(`/v1/logs?${params.toString()}`);
	}

	// Deployments
	async getDeployments(environment?: string): Promise<
		Array<{
			id: string;
			status: "success" | "failed" | "in_progress" | "pending" | "cancelled";
			commitHash: string;
			commitMessage: string;
			branch: string;
			environment: "production" | "staging" | "development";
			duration?: number;
			deployedAt: number;
			deployedBy: string;
			version?: string;
		}>
	> {
		const params = environment ? `?environment=${environment}` : "";
		return this.fetch(`/v1/deployments${params}`);
	}

	// Performance metrics
	async getPerformanceMetrics(timeRange = "24h"): Promise<{
		percentiles: Array<{
			id: string;
			label: string;
			value: number;
			change: number;
			sparkline: { index: number; value: number }[];
			threshold?: number;
		}>;
		latencyDistribution: Array<{
			range: string;
			count: number;
			percentage: number;
		}>;
		strategyComparison: Array<{
			timestamp: string;
			dense: number;
			sparse: number;
			hybrid: number;
		}>;
		lastUpdated: number;
	}> {
		return this.fetch(`/v1/metrics/performance?range=${timeRange}`);
	}

	// Memory operations
	async recall(query: string, options?: { limit?: number; type?: string }) {
		return this.fetch("/v1/memory/recall", {
			method: "POST",
			body: JSON.stringify({ query, ...options }),
		});
	}

	async remember(content: string, options?: { type?: string; tags?: string[] }) {
		return this.fetch("/v1/memory/remember", {
			method: "POST",
			body: JSON.stringify({ content, ...options }),
		});
	}

	// WebSocket URL for real-time updates
	getWebSocketUrl(path: string): string {
		return `${this.wsUrl}${path}`;
	}

	// Admin Tools - Graph Query Executor
	async executeGraphQuery(
		query: string,
		params?: Record<string, unknown>,
	): Promise<{
		results: Array<Record<string, unknown>>;
		executionTime: number;
		nodeCount: number;
		relationshipCount: number;
	}> {
		return this.fetch("/v1/memory/query", {
			method: "POST",
			body: JSON.stringify({ cypher: query, params }),
		});
	}

	// Admin Tools - Vector Search
	async vectorSearch(
		query: string,
		options: {
			strategy?: "dense" | "sparse" | "hybrid";
			rerank?: boolean;
			rerank_tier?: "fast" | "accurate" | "code" | "llm";
			limit?: number;
		} = {},
	): Promise<{
		results: Array<{
			id: string;
			content: string;
			score: number;
			type?: string;
			metadata?: Record<string, unknown>;
		}>;
		latency: number;
		strategy: string;
	}> {
		return this.fetch("/v1/memory/recall", {
			method: "POST",
			body: JSON.stringify({ query, ...options }),
		});
	}

	// Admin Tools - Cache Management
	async clearCache(cacheType: "embedding" | "query" | "all"): Promise<{
		success: boolean;
		clearedKeys: number;
		timestamp: number;
	}> {
		return this.fetch("/v1/admin/cache/clear", {
			method: "POST",
			body: JSON.stringify({ type: cacheType }),
		});
	}

	// Admin Tools - NATS Consumer Reset
	async resetConsumer(stream: string): Promise<{
		success: boolean;
		stream: string;
		consumer: string;
		timestamp: number;
	}> {
		return this.fetch("/v1/admin/consumers/reset", {
			method: "POST",
			body: JSON.stringify({ stream }),
		});
	}

	// Admin Tools - Get available NATS streams
	async getStreams(): Promise<{
		streams: Array<{
			name: string;
			messages: number;
			consumers: number;
		}>;
	}> {
		return this.fetch("/v1/admin/streams");
	}

	// Alert Configuration - Alert Rules
	async getAlertRules(): Promise<{
		rules: Array<{
			id: string;
			name: string;
			metric: string;
			condition: "greater_than" | "less_than" | "equals";
			threshold: number;
			duration: number;
			severity: "critical" | "warning" | "info";
			enabled: boolean;
			status: "active" | "triggered" | "muted";
			channels: string[];
			lastTriggered?: number;
		}>;
	}> {
		return this.fetch("/v1/alerts/rules");
	}

	async createAlertRule(rule: {
		name: string;
		metric: string;
		condition: "greater_than" | "less_than" | "equals";
		threshold: number;
		duration: number;
		severity: "critical" | "warning" | "info";
		channels: string[];
	}): Promise<{ id: string; success: boolean }> {
		return this.fetch("/v1/alerts/rules", {
			method: "POST",
			body: JSON.stringify(rule),
		});
	}

	async updateAlertRule(
		id: string,
		updates: Partial<{
			name: string;
			metric: string;
			condition: "greater_than" | "less_than" | "equals";
			threshold: number;
			duration: number;
			severity: "critical" | "warning" | "info";
			enabled: boolean;
			channels: string[];
		}>,
	): Promise<{ success: boolean }> {
		return this.fetch(`/v1/alerts/rules/${id}`, {
			method: "PATCH",
			body: JSON.stringify(updates),
		});
	}

	async deleteAlertRule(id: string): Promise<{ success: boolean }> {
		return this.fetch(`/v1/alerts/rules/${id}`, { method: "DELETE" });
	}

	// Alert Configuration - Notification Channels
	async getNotificationChannels(): Promise<{
		channels: Array<{
			id: string;
			name: string;
			type: "slack" | "email" | "webhook" | "pagerduty";
			config: Record<string, string>;
			verified: boolean;
			createdAt: number;
		}>;
	}> {
		return this.fetch("/v1/alerts/channels");
	}

	async createNotificationChannel(channel: {
		name: string;
		type: "slack" | "email" | "webhook" | "pagerduty";
		config: Record<string, string>;
	}): Promise<{ id: string; success: boolean }> {
		return this.fetch("/v1/alerts/channels", {
			method: "POST",
			body: JSON.stringify(channel),
		});
	}

	async testNotificationChannel(id: string): Promise<{ success: boolean; message: string }> {
		return this.fetch(`/v1/alerts/channels/${id}/test`, { method: "POST" });
	}

	async deleteNotificationChannel(id: string): Promise<{ success: boolean }> {
		return this.fetch(`/v1/alerts/channels/${id}`, { method: "DELETE" });
	}

	// Alert Configuration - Alert History
	async getAlertHistory(limit = 50): Promise<{
		alerts: Array<{
			id: string;
			ruleId: string;
			ruleName: string;
			severity: "critical" | "warning" | "info";
			state: "firing" | "resolved";
			triggeredAt: number;
			resolvedAt?: number;
			acknowledged: boolean;
			acknowledgedBy?: string;
		}>;
	}> {
		return this.fetch(`/v1/alerts/history?limit=${limit}`);
	}

	async acknowledgeAlert(id: string): Promise<{ success: boolean }> {
		return this.fetch(`/v1/alerts/history/${id}/acknowledge`, { method: "POST" });
	}

	// Server Metrics
	async getServerMetrics(
		serverId?: string,
		timeRange: "1h" | "6h" | "24h" | "7d" = "1h",
	): Promise<{
		current: {
			cpu: { usage: number; cores: number };
			memory: { used: number; total: number; percentage: number };
			disk: { read: number; write: number };
			network: { in: number; out: number };
		};
		history: Array<{
			timestamp: number;
			cpu: number;
			memory: number;
			diskRead: number;
			diskWrite: number;
			networkIn: number;
			networkOut: number;
		}>;
		thresholds?: {
			cpu: { warning: number; critical: number };
			memory: { warning: number; critical: number };
		};
	}> {
		const params = new URLSearchParams({ range: timeRange });
		if (serverId) params.set("serverId", serverId);
		return this.fetch(`/v1/metrics/server?${params.toString()}`);
	}
}

import { useMemo } from "react";
// Hook for using the API client with environment context
import { useEnvironment } from "./environment";

export function useApiClient(authToken?: string): ApiClient {
	const { environment } = useEnvironment();

	return useMemo(() => {
		return new ApiClient(environment, authToken);
	}, [environment, authToken]);
}
