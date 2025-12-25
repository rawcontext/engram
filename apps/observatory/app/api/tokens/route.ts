/**
 * OAuth Token Management API
 *
 * GET  /api/tokens - List user's OAuth tokens
 * DELETE /api/tokens?id=xxx - Revoke a token
 */

import { auth } from "@lib/auth";
import { listUserTokens, revokeToken } from "@lib/device-auth";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

interface TokenResponse {
	id: string;
	accessTokenPrefix: string;
	clientId: string;
	scopes: string[];
	accessTokenExpiresAt: string;
	refreshTokenExpiresAt: string;
	createdAt: string;
	lastUsedAt: string | null;
	userAgent: string | null;
	ipAddress: string | null;
}

function formatResponse<T>(success: boolean, data?: T, error?: { code: string; message: string }) {
	return NextResponse.json({ success, data, error }, { status: success ? 200 : 400 });
}

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return formatResponse(false, undefined, {
			code: "UNAUTHORIZED",
			message: "Not authenticated",
		});
	}

	const tokens = await listUserTokens(session.user.id);

	const formattedTokens: TokenResponse[] = tokens.map((t) => ({
		id: t.id,
		accessTokenPrefix: t.access_token_prefix,
		clientId: t.client_id,
		scopes: t.scopes,
		accessTokenExpiresAt: t.access_token_expires_at.toISOString(),
		refreshTokenExpiresAt: t.refresh_token_expires_at.toISOString(),
		createdAt: t.created_at.toISOString(),
		lastUsedAt: t.last_used_at?.toISOString() || null,
		userAgent: t.user_agent,
		ipAddress: t.ip_address,
	}));

	return formatResponse(true, { tokens: formattedTokens });
}

export async function DELETE(request: NextRequest) {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user) {
		return formatResponse(false, undefined, {
			code: "UNAUTHORIZED",
			message: "Not authenticated",
		});
	}

	const tokenId = request.nextUrl.searchParams.get("id");

	if (!tokenId) {
		return formatResponse(false, undefined, {
			code: "BAD_REQUEST",
			message: "Token ID required",
		});
	}

	const success = await revokeToken(tokenId, "User revoked via settings");

	if (!success) {
		return formatResponse(false, undefined, {
			code: "NOT_FOUND",
			message: "Token not found or already revoked",
		});
	}

	return formatResponse(true, { revoked: true });
}
