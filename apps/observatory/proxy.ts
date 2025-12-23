import { auth } from "@lib/auth";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Proxy to protect routes with BetterAuth session validation.
 *
 * Public routes (no auth required):
 * - /api/auth/* - BetterAuth endpoints
 * - /sign-in - Sign in page
 * - /_next/* - Next.js static assets
 *
 * Protected routes (auth required):
 * - /api/* - All other API routes (returns 401 JSON)
 * - /* - All other pages (redirects to sign-in)
 */
export default async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Skip auth routes - BetterAuth handles these
	if (pathname.startsWith("/api/auth")) {
		return NextResponse.next();
	}

	try {
		const session = await auth.api.getSession({
			headers: await headers(),
		});

		if (!session) {
			// For API routes, return 401 JSON
			if (pathname.startsWith("/api/")) {
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

			// For pages, redirect to sign-in
			return NextResponse.redirect(new URL("/sign-in", request.url));
		}

		return NextResponse.next();
	} catch (error) {
		console.error("[proxy] Auth check failed:", error);

		// For API routes, return 500 JSON
		if (pathname.startsWith("/api/")) {
			return NextResponse.json(
				{
					success: false,
					error: {
						code: "AUTH_ERROR",
						message: "Authentication check failed",
					},
				},
				{ status: 500 },
			);
		}

		return NextResponse.redirect(new URL("/sign-in", request.url));
	}
}

export const config = {
	matcher: ["/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
