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
		AWS_ACCESS_KEY: /\bAKIA[0-9A-Z]{16}\b/g,
		AWS_SECRET_KEY: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
		GITHUB_TOKEN:
			/\b(ghp_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36}|ghu_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,})\b/g,
		GOOGLE_API_KEY: /\bAIzaSy[A-Za-z0-9_-]{33}\b/g,
		JWT_TOKEN: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
		NPM_TOKEN: /\bnpm_[A-Za-z0-9]{36}\b/g,
		PRIVATE_KEY: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
		DATABASE_URL: /\b(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"']+/gi,
		BEARER_TOKEN: /\bBearer\s+[A-Za-z0-9._\-]+\b/g,
		PASSWORD_FIELD: /(?:password|passwd|pwd|secret)\s*[:=]\s*["']?[^\s"']+["']?/gi,
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

		// Secrets and API Keys
		redacted = redacted.replace(Redactor.PATTERNS.OPENAI_KEY, "[OPENAI_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.ANTHROPIC_KEY, "[ANTHROPIC_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.AWS_ACCESS_KEY, "[AWS_ACCESS_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.AWS_SECRET_KEY, "[AWS_SECRET_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.GITHUB_TOKEN, "[GITHUB_TOKEN_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.GOOGLE_API_KEY, "[GOOGLE_API_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.JWT_TOKEN, "[JWT_TOKEN_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.NPM_TOKEN, "[NPM_TOKEN_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.PRIVATE_KEY, "[PRIVATE_KEY_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.DATABASE_URL, "[DATABASE_URL_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.BEARER_TOKEN, "[BEARER_TOKEN_REDACTED]");
		redacted = redacted.replace(Redactor.PATTERNS.PASSWORD_FIELD, "[PASSWORD_REDACTED]");

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
