export type ExecutionErrorType = "UserError" | "SystemError";

export interface ExecutionError {
	type: ExecutionErrorType;
	message: string;
	details?: unknown;
}

export const isUserError = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return false;

	const error = err as Error;

	// System errors (not user-caused)
	const systemErrorPatterns = [
		/ECONNREFUSED/, // Connection refused
		/ETIMEDOUT/, // Timeout
		/ENOTFOUND/, // DNS lookup failed
		/sandbox crash/i, // Sandbox infrastructure failure
		/out of memory/i, // OOM errors
		/ENOMEM/, // No memory
		/segmentation fault/i, // Segfault
		/core dumped/i, // Core dump
	];

	const errorMessage = error.message || String(err);

	// Check if it's a system error
	for (const pattern of systemErrorPatterns) {
		if (pattern.test(errorMessage)) {
			return false; // System error, not user error
		}
	}

	// User errors (code/syntax issues)
	const userErrorPatterns = [
		/SyntaxError/,
		/ReferenceError/,
		/TypeError/,
		/RangeError/,
		/EvalError/,
		/URIError/,
		/undefined is not/i,
		/cannot read propert/i,
		/is not a function/i,
		/is not defined/i,
	];

	for (const pattern of userErrorPatterns) {
		if (pattern.test(errorMessage) || pattern.test(error.constructor.name)) {
			return true;
		}
	}

	// Default: treat as user error (original behavior)
	return true;
};
