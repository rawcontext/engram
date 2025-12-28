import { createAuthClient } from "better-auth/react";

const getBaseURL = () => {
	if (process.env.NEXT_PUBLIC_BETTER_AUTH_URL) {
		return process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
	}
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	return "http://localhost:6182";
};

export const authClient = createAuthClient({
	baseURL: getBaseURL(),
});

export const { signIn, signOut, useSession } = authClient;
