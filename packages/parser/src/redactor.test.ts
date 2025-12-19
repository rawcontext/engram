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
});
