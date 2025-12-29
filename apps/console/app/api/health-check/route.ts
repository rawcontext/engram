/**
 * Health Check Proxy
 *
 * Proxies health checks to backend services to avoid CORS issues.
 * The console makes requests to this endpoint, which then fetches
 * from the actual service health endpoints.
 */

import { NextResponse } from "next/server";

// Service configuration for production
const SERVICES = {
	api: {
		url: process.env.ENGRAM_API_URL || "http://api:6174",
		path: "/v1/health",
	},
	search: {
		url: process.env.ENGRAM_API_URL || "http://api:6174",
		path: "/v1/search/health",
	},
	tuner: {
		url: process.env.ENGRAM_API_URL || "http://api:6174",
		path: "/v1/tuner/health",
	},
	observatory: {
		url: process.env.OBSERVATORY_URL || "http://observatory:3000",
		path: "/api/health",
	},
} as const;

interface ServiceHealthResult {
	name: string;
	status: "online" | "warning" | "offline";
	latency?: number;
	message?: string;
}

async function checkService(
	name: string,
	baseUrl: string,
	path: string,
): Promise<ServiceHealthResult> {
	const start = performance.now();
	try {
		const response = await fetch(`${baseUrl}${path}`, {
			method: "GET",
			signal: AbortSignal.timeout(5000),
		});
		const latency = Math.round(performance.now() - start);

		if (response.ok) {
			return { name, status: "online", latency };
		}
		return { name, status: "warning", latency, message: `HTTP ${response.status}` };
	} catch (error) {
		return {
			name,
			status: "offline",
			message: error instanceof Error ? error.message : "Connection failed",
		};
	}
}

export async function GET() {
	const results = await Promise.all([
		checkService("API", SERVICES.api.url, SERVICES.api.path),
		checkService("Search", SERVICES.search.url, SERVICES.search.path),
		checkService("Tuner", SERVICES.tuner.url, SERVICES.tuner.path),
		checkService("Observatory", SERVICES.observatory.url, SERVICES.observatory.path),
	]);

	// Add Ingestion as "not exposed" - it only has /ingest endpoint
	results.push({
		name: "Ingestion",
		status: "offline",
		message: "Not exposed",
	});

	return NextResponse.json(results, {
		headers: {
			"Cache-Control": "no-store, max-age=0",
		},
	});
}
