import { NextResponse, type NextRequest } from "next/server";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/api/auth", "/login", "/error"];

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Allow public routes
	if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
		return NextResponse.next();
	}

	// Check for session cookie
	const sessionCookie = request.cookies.get("better-auth.session_token");

	if (!sessionCookie) {
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
