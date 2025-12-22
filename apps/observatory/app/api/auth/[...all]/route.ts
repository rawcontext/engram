import { auth } from "@lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { type NextRequest, NextResponse } from "next/server";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

export async function GET(request: NextRequest) {
	try {
		return await authGET(request);
	} catch (error) {
		console.error("[Auth GET] Unhandled error:", error);
		return NextResponse.json(
			{
				error: "Internal server error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}

export async function POST(request: NextRequest) {
	try {
		return await authPOST(request);
	} catch (error) {
		console.error("[Auth POST] Unhandled error:", error);
		return NextResponse.json(
			{
				error: "Internal server error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}
