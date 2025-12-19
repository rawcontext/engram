import * as gcp from "@pulumi/gcp";
import { commonLabels } from "./config";

/**
 * Engram Secret Management
 *
 * Defines Secret Manager secrets for sensitive configuration.
 * Note: This creates the secret containers only. Secret values must be
 * added via the GCP Console or CLI after deployment:
 *
 *   echo -n "your-api-key" | gcloud secrets versions add SECRET_NAME --data-file=-
 */

const replication = {
	auto: {},
};

/**
 * OpenAI API key for LLM operations
 */
export const openaiApiKeySecret = new gcp.secretmanager.Secret("openai-api-key", {
	secretId: "openai-api-key",
	replication,
	labels: commonLabels,
});

/**
 * Anthropic API key for Claude operations
 */
export const anthropicApiKeySecret = new gcp.secretmanager.Secret("anthropic-api-key", {
	secretId: "anthropic-api-key",
	replication,
	labels: commonLabels,
});

/**
 * xAI API key for Grok models (legacy, being phased out)
 */
export const xaiApiKeySecret = new gcp.secretmanager.Secret("xai-api-key", {
	secretId: "xai-api-key",
	replication,
	labels: commonLabels,
});

/**
 * Google Generative AI API key for Gemini models (reranking, query expansion)
 */
export const googleGenerativeAiApiKeySecret = new gcp.secretmanager.Secret(
	"google-generative-ai-api-key",
	{
		secretId: "google-generative-ai-api-key",
		replication,
		labels: commonLabels,
	},
);
