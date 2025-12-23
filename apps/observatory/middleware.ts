import { auth } from "@lib/auth";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware to protect API routes with BetterAuth session validation.
 *
 * Public routes (no auth required):
 * - /api/auth/* - BetterAuth endpoints
 * - /sign-in - Sign in page
 *
 * Protected routes (auth required):
 * - /api/* - All other API routes
 * - /keys - API keys management
 */
export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Skip auth routes - BetterAuth handles these
	if (pathname.startsWith("/api/auth")) {
		return NextResponse.next();
	}

	// For API routes, validate session
	if (pathname.startsWith("/api/")) {
		const session = await auth.api.getSession({
			headers: await headers(),
		});

		if (!session) {
			return NextResponse.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				{ status: 401 },
			);
		}
	}

	return NextResponse.next();
}

export const config = {
	// Apply to all API routes except auth
	matcher: ["/api/:path*"],
};
