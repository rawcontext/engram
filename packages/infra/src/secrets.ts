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
