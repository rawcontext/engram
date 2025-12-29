import { auth } from "@lib/auth";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session) {
		return NextResponse.redirect(new URL("/sign-in", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		/*
		 * Match all paths except:
		 * - /sign-in (auth page)
		 * - /activate (device flow activation page)
		 * - /api/auth/* (auth API routes)
		 * - /api/well-known/* (OAuth metadata - rewrites from /.well-known/*)
		 * - /.well-known/* (OAuth discovery endpoints)
		 * - /_next/* (Next.js internals)
		 * - /favicon.ico, /robots.txt (static files)
		 */
		"/((?!sign-in|activate|api/auth|api/well-known|\\.well-known|_next/static|_next/image|favicon.ico|robots.txt).*)",
	],
};
