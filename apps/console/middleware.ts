import { getCookieCache } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { getClientToken, loadOAuthConfig } from "./lib/oauth";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/api/auth", "/api/debug", "/api/health", "/login", "/error"];

// Secret for validating cookie cache (must match auth config)
const secret = process.env.BETTER_AUTH_SECRET || "build-time-placeholder-not-for-production";

// =============================================================================
// OAuth Client Token Initialization
// =============================================================================

let tokenInitialized = false;

/**
 * Initialize OAuth client token for API calls.
 * Called once when the server starts.
 */
async function initializeClientToken() {
	if (tokenInitialized) return;
	tokenInitialized = true;

	const config = loadOAuthConfig();
	if (!config) {
		console.warn("[Console] No ENGRAM_CLIENT_TOKEN configured - API calls will fail");
		return;
	}

	try {
		await getClientToken(config);
		console.log("[Console] OAuth client token initialized successfully");
	} catch (error) {
		console.error("[Console] Failed to initialize OAuth client token:", error);
	}
}

// Initialize token on module load
initializeClientToken().catch((error) => {
	console.error("[Console] Unhandled error during token initialization:", error);
});

/**
 * Get the current client token, refreshing if needed.
 */
export async function getAPIClientToken(): Promise<string | null> {
	const config = loadOAuthConfig();
	if (!config) return null;

	try {
		// getClientToken handles caching and refresh internally
		return await getClientToken(config);
	} catch (error) {
		console.error("[Console] Failed to get client token:", error);
		return null;
	}
}

// =============================================================================
// Middleware
// =============================================================================

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Allow public routes
	if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
		return NextResponse.next();
	}

	// Validate session from cookie cache (no database call needed)
	const session = await getCookieCache(request, { secret });

	if (!session) {
		// Redirect to login
		const loginUrl = new URL("/login", request.url);
		loginUrl.searchParams.set("callbackUrl", pathname);
		return NextResponse.redirect(loginUrl);
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		// Match all routes except static files and api/auth
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};
