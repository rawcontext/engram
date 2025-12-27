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
	private authToken?: string;

	constructor(environment: EnvironmentConfig, authToken?: string) {
		this.baseUrl = environment.apiUrl;
		this.wsUrl = environment.wsUrl;
		this.authToken = authToken;
	}

	private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: HeadersInit = {
			"Content-Type": "application/json",
			...options.headers,
		};

		if (this.authToken) {
			(headers as Record<string, string>).Authorization = `Bearer ${this.authToken}`;
		}

		const response = await fetch(url, {
			...options,
			headers,
		});

		if (!response.ok) {
			const error = new Error(`API error: ${response.statusText}`) as ApiError;
			error.status = response.status;
			try {
				const body = await response.json();
				error.message = body.message || error.message;
				error.code = body.code;
			} catch {
				// Ignore JSON parse errors
			}
			throw error;
		}

		return response.json();
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

	// Check multiple services health
	async getAllServicesHealth(): Promise<ServiceHealth[]> {
		const services = [
			{ name: "API", port: 6174, path: "/v1/health" },
			{ name: "Ingestion", port: 6175, path: "/health" },
			{ name: "Search", port: 6176, path: "/v1/search/health" },
			{ name: "Tuner", port: 6177, path: "/v1/tuner/health" },
			{ name: "Observatory", port: 6178, path: "/api/health" },
		];

		const results = await Promise.allSettled(
			services.map(async (service) => {
				const url = this.baseUrl.replace(/:(\d+)/, `:${service.port}`);
				const start = performance.now();

				try {
					const response = await fetch(`${url}${service.path}`, {
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

		try {
			// Try to fetch real metrics from API
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
		} catch {
			// Return simulated metrics if API endpoint doesn't exist yet
			return [
				{
					id: "requests",
					title: "Total Requests",
					value: 1234567,
					change: 12.3,
					changeUnit: "%",
					trend: "up",
					sparkline: generateSparkline(1200, 300),
				},
				{
					id: "errors",
					title: "Error Rate",
					value: 0.12,
					unit: "%",
					change: -0.08,
					changeUnit: "%",
					trend: "up",
					sparkline: generateSparkline(0.15, 0.05),
				},
				{
					id: "latency",
					title: "Avg Latency",
					value: 23,
					unit: "ms",
					change: -5,
					changeUnit: "ms",
					trend: "up",
					sparkline: generateSparkline(28, 8),
				},
				{
					id: "sessions",
					title: "Active Sessions",
					value: 847,
					change: 23,
					trend: "up",
					sparkline: generateSparkline(820, 50),
				},
			];
		}
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
