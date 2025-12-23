import { createAuthClient } from "better-auth/react";

// Determine base URL: explicit env var > local dev default
const getBaseURL = () => {
	if (process.env.NEXT_PUBLIC_BETTER_AUTH_URL) {
		return process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
	}
	// In browser, use current origin (works for any port)
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	// SSR fallback
	return "http://localhost:6178";
};

export const authClient = createAuthClient({
	baseURL: getBaseURL(),
});

export const { signIn, signOut, useSession } = authClient;
