/**
 * Engram API Proxy
 *
 * Validates the user session and forwards requests to the Engram API
 * with a service token. This allows the console to make authenticated
 * API calls without exposing tokens to the client.
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Get the Engram API URL from environment
const ENGRAM_API_URL = process.env.ENGRAM_API_URL || "http://localhost:6174";
const ENGRAM_API_KEY = process.env.ENGRAM_API_KEY || "engram_dev_console";

interface ProxyParams {
	params: Promise<{ path: string[] }>;
}

async function proxyRequest(request: NextRequest, { params }: ProxyParams) {
	// Validate session
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return NextResponse.json(
			{
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Not authenticated",
				},
			},
			{ status: 401 },
		);
	}

	const { path } = await params;
	const apiPath = `/v1/${path.join("/")}`;
	const url = new URL(apiPath, ENGRAM_API_URL);

	// Copy query parameters
	const searchParams = request.nextUrl.searchParams;
	searchParams.forEach((value, key) => {
		url.searchParams.set(key, value);
	});

	// Prepare headers
	const proxyHeaders: HeadersInit = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${ENGRAM_API_KEY}`,
	};

	// Forward the request
	const fetchOptions: RequestInit = {
		method: request.method,
		headers: proxyHeaders,
	};

	// Include body for non-GET requests
	if (request.method !== "GET" && request.method !== "HEAD") {
		try {
			const body = await request.text();
			if (body) {
				fetchOptions.body = body;
			}
		} catch {
			// No body to forward
		}
	}

	try {
		const response = await fetch(url.toString(), fetchOptions);
		const data = await response.json();

		return NextResponse.json(data, {
			status: response.status,
			headers: {
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		console.error("[Console API Proxy] Error:", error);
		return NextResponse.json(
			{
				success: false,
				error: {
					code: "PROXY_ERROR",
					message: "Failed to connect to Engram API",
				},
			},
			{ status: 502 },
		);
	}
}

export async function GET(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function POST(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function PUT(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function PATCH(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}

export async function DELETE(request: NextRequest, params: ProxyParams) {
	return proxyRequest(request, params);
}
