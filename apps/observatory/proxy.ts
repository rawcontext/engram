import { auth } from "@lib/auth";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

export default async function proxy(request: NextRequest) {
	try {
		const session = await auth.api.getSession({
			headers: await headers(),
		});

		if (!session) {
			return NextResponse.redirect(new URL("/sign-in", request.url));
		}

		return NextResponse.next();
	} catch (error) {
		console.error("[proxy] Auth check failed:", error);
		return NextResponse.redirect(new URL("/sign-in", request.url));
	}
}

export const config = {
	matcher: ["/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
