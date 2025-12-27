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

// Hook for using the API client with environment context
import { useEnvironment } from "./environment";
import { useMemo } from "react";

export function useApiClient(authToken?: string): ApiClient {
	const { environment } = useEnvironment();

	return useMemo(() => {
		return new ApiClient(environment, authToken);
	}, [environment, authToken]);
}
