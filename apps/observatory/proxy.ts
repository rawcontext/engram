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
		 * - /api/auth/* (auth API routes)
		 * - /_next/* (Next.js internals)
		 * - /favicon.ico, /robots.txt (static files)
		 */
		"/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)",
	],
};
