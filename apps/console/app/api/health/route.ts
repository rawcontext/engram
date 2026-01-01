import { type NextRequest, NextResponse } from "next/server";

/**
 * Health check endpoint for Console service.
 * Used by Docker healthcheck and service monitoring.
 */
export async function GET(_request: NextRequest) {
	return NextResponse.json({
		status: "healthy",
		service: "console",
		timestamp: new Date().toISOString(),
	});
}
