import { createAuthClient } from "better-auth/react";

const getBaseURL = () => {
	// In browser, auth API is always on the same origin (Next.js API route)
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	// SSR fallback
	if (process.env.NEXT_PUBLIC_BETTER_AUTH_URL) {
		return process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
	}
	return "http://localhost:6185";
};

export const authClient = createAuthClient({
	baseURL: getBaseURL(),
});

export const { signIn, signOut, useSession } = authClient;
