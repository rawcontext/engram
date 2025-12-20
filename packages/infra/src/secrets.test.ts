/**
 * Secret Management Tests
 *
 * Tests for Secret Manager secrets configuration.
 */

import { describe, expect, it } from "vitest";
// Import the infrastructure modules - mocks are already set up in vitest.setup.ts
import * as infra from "./secrets";
import { getResource, getResourcesByType } from "./testing";

/** Type for secret labels in GCP Secret Manager */
interface SecretLabels {
	project?: string;
	environment?: string;
	"managed-by"?: string;
}

describe("Secret Management", () => {
	describe("Google Generative AI API Key Secret", () => {
		it("should create a Google Generative AI API key secret", () => {
			const secretResource = getResource(
				"gcp:secretmanager/secret:Secret",
				"google-generative-ai-api-key",
			);
			expect(secretResource).toBeDefined();
		});

		it("should have the correct secret ID", () => {
			const secretResource = getResource(
				"gcp:secretmanager/secret:Secret",
				"google-generative-ai-api-key",
			);
			expect(secretResource?.inputs.secretId).toBe("google-generative-ai-api-key");
		});

		it("should use automatic replication", () => {
			const secretResource = getResource(
				"gcp:secretmanager/secret:Secret",
				"google-generative-ai-api-key",
			);
			expect(secretResource?.inputs.replication).toEqual({ auto: {} });
		});

		it("should have common labels", () => {
			const secretResource = getResource(
				"gcp:secretmanager/secret:Secret",
				"google-generative-ai-api-key",
			);
			const labels = secretResource?.inputs.labels as SecretLabels;
			expect(labels).toBeDefined();
			expect(labels.project).toBe("engram");
			expect(labels["managed-by"]).toBe("pulumi");
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 1 secret", () => {
			const secrets = getResourcesByType("gcp:secretmanager/secret:Secret");
			expect(secrets).toHaveLength(1);
		});

		it("should create the Google Generative AI API key secret", () => {
			const secrets = getResourcesByType("gcp:secretmanager/secret:Secret");
			const secretIds = secrets.map((s) => s.inputs.secretId);

			expect(secretIds).toContain("google-generative-ai-api-key");
		});
	});

	describe("Labeling Consistency", () => {
		it("should apply consistent labels to all secrets", () => {
			const secrets = getResourcesByType("gcp:secretmanager/secret:Secret");

			for (const secret of secrets) {
				const labels = secret.inputs.labels as SecretLabels;
				expect(labels).toBeDefined();
				expect(labels.project).toBe("engram");
				expect(labels.environment).toBe("test"); // Test stack
				expect(labels["managed-by"]).toBe("pulumi");
			}
		});
	});

	describe("Exports", () => {
		it("should export googleGenerativeAiApiKeySecret", () => {
			expect(infra.googleGenerativeAiApiKeySecret).toBeDefined();
		});
	});
});
