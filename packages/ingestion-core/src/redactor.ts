import { PhoneNumberUtil } from "google-libphonenumber";

export class Redactor {
  private phoneUtil = PhoneNumberUtil.getInstance();

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

    // Phones (using library for better accuracy)
    // Note: Parsing every string for phones is expensive.
    // Optimization: check if string contains at least 7 digits.
    if ((redacted.match(/\d/g) || []).length >= 7) {
      // Ideally we iterator over potential matches, but libphonenumber is complex to use
      // for "find all in text". We will use a fallback regex for speed in V1
      // or assume the caller handles phone numbers specifically.
      // For strict PII, we'll use a broad phone regex:
      redacted = redacted.replace(
        /\b\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
        (match) => {
          // Basic heuristic to avoid year numbers like 2024 or simple ints
          if (match.replace(/\D/g, "").length < 7) return match;
          return "[PHONE]";
        },
      );
    }

    return redacted;
  }
}
