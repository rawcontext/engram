/**
 * POST /api/auth/device/verify - Verify user code and authorize device
 *
 * Called from the /activate page when user submits their code.
 * Links the device code to the authenticated user.
 *
 * @see docs/design/oauth-device-flow.md
 */

import { apiError, apiSuccess } from "@lib/api-response";
import { auth } from "@lib/auth";
import { authorizeDeviceCode, findDeviceCodeByUserCode, normalizeUserCode } from "@lib/device-auth";

/**
 * Verify a user code and authorize the device.
 *
 * Request body:
 * {
 *   "user_code": "WDJB-MJHT"
 * }
 *
 * Response (success):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "Device authorized. You can close this window."
 *   }
 * }
 *
 * Response (error):
 * {
 *   "success": false,
 *   "error": {
 *     "code": "invalid_code",
 *     "message": "Code not found or expired."
 *   }
 * }
 */
export async function POST(request: Request) {
	// Require authentication
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		return apiError("You must be logged in to authorize a device", "UNAUTHORIZED", 401);
	}

	try {
		const body = await request.json();
		const { user_code } = body;

		if (!user_code || typeof user_code !== "string") {
			return apiError("User code is required", "VALIDATION_ERROR", 400);
		}

		// Normalize and validate code format
		const normalizedCode = normalizeUserCode(user_code);
		if (normalizedCode.length !== 8) {
			return apiError("Invalid code format. Expected XXXX-XXXX.", "INVALID_CODE", 400);
		}

		// Find the device code
		const deviceCode = await findDeviceCodeByUserCode(user_code);

		if (!deviceCode) {
			return apiError("Code not found. Please check and try again.", "INVALID_CODE", 400);
		}

		// Check if expired
		if (new Date(deviceCode.expires_at) < new Date()) {
			return apiError(
				"This code has expired. Please request a new code from your device.",
				"EXPIRED_CODE",
				400,
			);
		}

		// Check if already used
		if (deviceCode.status !== "pending") {
			const messages: Record<string, string> = {
				authorized: "This code has already been used.",
				denied: "This code was denied.",
				expired: "This code has expired.",
				used: "This code has already been used.",
			};
			return apiError(
				messages[deviceCode.status] || "This code is no longer valid.",
				"ALREADY_USED",
				400,
			);
		}

		// Authorize the device
		const authorized = await authorizeDeviceCode(user_code, session.user.id);

		if (!authorized) {
			return apiError("Failed to authorize device. Please try again.", "AUTHORIZATION_FAILED", 500);
		}

		return apiSuccess({
			message:
				"Device authorized successfully! You can close this window and return to your terminal.",
			device_authorized: true,
		});
	} catch (error) {
		console.error("Error verifying device code:", error);
		return apiError("Failed to verify code", "VERIFICATION_FAILED", 500);
	}
}
