import { betterAuth } from "better-auth";
import { Pool } from "pg";

// Console app base URL - prefer Console-specific var, fallback to Better Auth URL, then localhost
const baseURL =
	process.env.CONSOLE_AUTH_URL || process.env.BETTER_AUTH_URL || "http://localhost:6185";

// Use a build-time placeholder secret when env var is not set (during next build)
const secret = process.env.BETTER_AUTH_SECRET || "build-time-placeholder-not-for-production";

export const auth = betterAuth({
	database: new Pool({
		connectionString: process.env.AUTH_DATABASE_URL,
	}),
	baseURL,
	secret,
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
			redirectURI: `${baseURL}/api/auth/callback/google`,
		},
	},
	user: {
		additionalFields: {
			role: {
				type: "string",
				required: false,
				defaultValue: "user",
				input: false,
			},
		},
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // Update session every 24 hours
		cookieCache: {
			enabled: true,
			maxAge: 60 * 5, // 5 minutes
		},
	},
	trustedOrigins: [
		"http://localhost:6185",
		"http://localhost:6178", // Observatory
		...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
	],
	onAPIError: {
		onError: (error) => {
			const err = error as Error;
			console.error("[Console Auth] API Error:", err.message);
		},
	},
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
