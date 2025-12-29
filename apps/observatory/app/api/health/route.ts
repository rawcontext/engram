import { type NextRequest, NextResponse } from "next/server";

/**
 * Health check endpoint for Observatory service.
 * Used by Docker healthcheck and service monitoring.
 */
export async function GET(_request: NextRequest) {
	return NextResponse.json({
		status: "healthy",
		service: "observatory",
		timestamp: new Date().toISOString(),
	});
}
