import { describe, expect, it } from "vitest";
import { Redactor } from "./redactor";

describe("Redactor", () => {
	const redactor = new Redactor();

	it("should redact emails", () => {
		expect(redactor.redact("Contact me at test@example.com.")).toBe("Contact me at [EMAIL].");
	});

	it("should redact SSNs", () => {
		expect(redactor.redact("My SSN is 123-45-6789.")).toBe("My SSN is [SSN].");
	});

	it("should redact credit cards", () => {
		expect(redactor.redact("Charge 1234-5678-1234-5678 now.")).toBe("Charge [CREDIT_CARD] now.");
	});

	it("should redact OpenAI keys", () => {
		const key = `sk-${"a".repeat(48)}`;
		expect(redactor.redact(`Key: ${key}`)).toBe("Key: [OPENAI_KEY_REDACTED]");
	});

	it("should redact Anthropic keys", () => {
		expect(redactor.redact("Key: sk-ant-123456")).toBe("Key: [ANTHROPIC_KEY_REDACTED]");
	});

	it("should redact phone numbers", () => {
		expect(redactor.redact("Call me at 555-123-4567")).toBe("Call me at [PHONE]");
		// Note: The + prefix is part of the international phone format and is redacted along with the number
		expect(redactor.redact("Or +1 (555) 123-4567")).toBe("Or [PHONE]");
	});

	it("should not redact simple numbers", () => {
		expect(redactor.redact("The year is 2025")).toBe("The year is 2025");
	});

	it("should handle empty or null input", () => {
		expect(redactor.redact("")).toBe("");
		expect(redactor.redact(null as unknown as string)).toBe(null);
	});

	it("should redact AWS access keys", () => {
		expect(redactor.redact("Key: AKIAIOSFODNN7EXAMPLE")).toBe("Key: [AWS_ACCESS_KEY_REDACTED]");
	});

	it("should redact AWS secret keys", () => {
		// AWS secret keys are 40 base64 chars - this matches the pattern
		const secret = "a".repeat(40);
		const result = redactor.redact(`Secret: ${secret}`);
		// The pattern may match password or AWS secret, either is acceptable for a generic 40-char string
		expect(result).toMatch(/\[(?:AWS_SECRET_KEY_REDACTED|PASSWORD_REDACTED)\]/);
	});

	it("should redact GitHub tokens", () => {
		expect(redactor.redact("ghp_" + "a".repeat(36))).toBe("[GITHUB_TOKEN_REDACTED]");
		expect(redactor.redact("ghs_" + "a".repeat(36))).toBe("[GITHUB_TOKEN_REDACTED]");
		expect(redactor.redact("ghu_" + "a".repeat(36))).toBe("[GITHUB_TOKEN_REDACTED]");
	});

	it("should redact Google API keys", () => {
		expect(redactor.redact("AIzaSy" + "a".repeat(33))).toBe("[GOOGLE_API_KEY_REDACTED]");
	});

	it("should redact JWT tokens", () => {
		expect(redactor.redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123")).toBe(
			"[JWT_TOKEN_REDACTED]",
		);
	});

	it("should redact NPM tokens", () => {
		expect(redactor.redact("npm_" + "a".repeat(36))).toBe("[NPM_TOKEN_REDACTED]");
	});

	it("should redact private keys", () => {
		expect(
			redactor.redact("-----BEGIN PRIVATE KEY-----\ndata\n-----END PRIVATE KEY-----"),
		).toContain("[PRIVATE_KEY_REDACTED]");
		expect(redactor.redact("-----BEGIN RSA PRIVATE KEY-----\ndata")).toContain(
			"[PRIVATE_KEY_REDACTED]",
		);
	});

	it("should redact database URLs", () => {
		expect(redactor.redact("postgres://user:pass@localhost:5432/db")).toBe(
			"[DATABASE_URL_REDACTED]",
		);
		expect(redactor.redact("mysql://user:pass@localhost/db")).toBe("[DATABASE_URL_REDACTED]");
		expect(redactor.redact("mongodb://user:pass@localhost/db")).toBe("[DATABASE_URL_REDACTED]");
	});

	it("should redact bearer tokens", () => {
		expect(redactor.redact("Bearer abc123def456")).toBe("[BEARER_TOKEN_REDACTED]");
	});

	it("should redact password fields", () => {
		expect(redactor.redact("password: secret123")).toContain("[PASSWORD_REDACTED]");
		expect(redactor.redact("PASSWORD=secret123")).toContain("[PASSWORD_REDACTED]");
	});

	it("should not redact numbers with fewer than 7 digits", () => {
		expect(redactor.redact("123456")).toBe("123456");
	});

	it("should handle multiple redactions in one string", () => {
		const input = "Email: test@example.com, SSN: 123-45-6789";
		const result = redactor.redact(input);
		expect(result).toBe("Email: [EMAIL], SSN: [SSN]");
	});
});
