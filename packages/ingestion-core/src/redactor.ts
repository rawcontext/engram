export class Redactor {
	private static PATTERNS = {
		// Basic email regex
		EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

		// SSN (US)
		SSN: /\b\d{3}-\d{2}-\d{4}\b/g,

		// Credit Cards (Simple Check, followed by Luhn potentially, but sticking to regex for speed)
		CREDIT_CARD: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,

		// Secrets / Keys
		OPENAI_KEY: /sk-[a-zA-Z0-9]{48}/g,
		ANTHROPIC_KEY: /sk-ant-[a-zA-Z0-9-_]+/g,
		AWS_KEY: /(?<![A-Z0-9])[A-Z0-9]{20}(?![A-Z0-9])/g, // Basic ID check, secrets are harder
		GENERIC_SECRET: /[a-zA-Z0-9]{32,}/g, // High entropy strings (careful with this one)
	};

	public redact(text: string): string {
		if (!text) return text;
		let redacted = text;

		// Emails
		redacted = redacted.replace(Redactor.PATTERNS.EMAIL, "[EMAIL]");

		// SSNs
		redacted = redacted.replace(Redactor.PATTERNS.SSN, "[SSN]");

		// Credit Cards
		redacted = redacted.replace(Redactor.PATTERNS.CREDIT_CARD, "[CREDIT_CARD]");

		// Secrets
		redacted = redacted.replace(Redactor.PATTERNS.OPENAI_KEY, "[OPENAI_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.ANTHROPIC_KEY, "[ANTHROPIC_KEY_REDACTED]");

		// Phones (using a ReDoS-safe pattern)
		// Note: The original regex had nested optional groups causing catastrophic backtracking.
		// This pattern is simpler and avoids ReDoS while still catching most phone formats.
		// For production use with untrusted input, consider using libphonenumber-js library.
		if ((redacted.match(/\d/g) || []).length >= 7) {
			// ReDoS-safe phone pattern:
			// - Matches optional + prefix
			// - Matches 7-15 digits with optional separators
			// - No nested quantifiers or optional groups
			redacted = redacted.replace(/\+?\d[\d\s().-]{6,18}\d/g, (match) => {
				// Only redact if the match contains 7-15 digits (valid phone number range)
				const digitCount = (match.match(/\d/g) || []).length;
				if (digitCount >= 7 && digitCount <= 15) {
					return "[PHONE]";
				}
				return match;
			});
		}

		return redacted;
	}
}
