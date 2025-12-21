import { NextResponse } from "next/server";

export type ApiSuccess<T> = {
	success: true;
	data: T;
	meta?: Record<string, unknown>;
};

export type ApiError = {
	success: false;
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/**
 * Returns a standardized success response.
 * @param data The payload to return.
 * @param status HTTP status code (default 200).
 * @param meta Optional metadata.
 */
export function apiSuccess<T>(data: T, status = 200, meta?: Record<string, unknown>): NextResponse {
	const body: ApiSuccess<T> = {
		success: true,
		data,
		meta,
	};
	return NextResponse.json(body, { status });
}

/**
 * Returns a standardized error response.
 * @param message Human readable error message.
 * @param code Machine readable error code (default 'INTERNAL_ERROR').
 * @param status HTTP status code (default 500).
 * @param details Optional error details (e.g. validation errors).
 */
export function apiError(
	message: string,
	code = "INTERNAL_ERROR",
	status = 500,
	details?: unknown,
): NextResponse {
	const body: ApiError = {
		success: false,
		error: {
			code,
			message,
			details,
		},
	};
	return NextResponse.json(body, { status });
}
