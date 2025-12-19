/**
 * Error thrown when the Engram Cloud API returns an error
 */
export class EngramApiError extends Error {
	public readonly code: string;
	public readonly statusCode: number;
	public readonly details?: unknown;

	constructor(code: string, message: string, statusCode: number, details?: unknown) {
		super(message);
		this.name = "EngramApiError";
		this.code = code;
		this.statusCode = statusCode;
		this.details = details;

		// Ensure proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, EngramApiError.prototype);
	}

	/**
	 * Check if this is a rate limit error
	 */
	isRateLimitError(): boolean {
		return this.code === "RATE_LIMIT_EXCEEDED" || this.statusCode === 429;
	}

	/**
	 * Check if this is an authentication error
	 */
	isAuthError(): boolean {
		return this.code === "UNAUTHORIZED" || this.statusCode === 401;
	}

	/**
	 * Check if this is a validation error
	 */
	isValidationError(): boolean {
		return this.code === "VALIDATION_ERROR" || this.statusCode === 400;
	}

	/**
	 * Convert to a user-friendly message
	 */
	toUserMessage(): string {
		if (this.isRateLimitError()) {
			return "Rate limit exceeded. Please wait and try again.";
		}
		if (this.isAuthError()) {
			return "Invalid or missing API key. Please check your ENGRAM_API_KEY.";
		}
		if (this.isValidationError()) {
			return `Invalid request: ${this.message}`;
		}
		return this.message;
	}
}
