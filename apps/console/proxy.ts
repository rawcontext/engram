import { getCookieCache } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/api/auth", "/login", "/error"];

// Secret for validating cookie cache (must match auth config)
const secret = process.env.BETTER_AUTH_SECRET || "build-time-placeholder-not-for-production";

export async function proxy(request: NextRequest) {
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
