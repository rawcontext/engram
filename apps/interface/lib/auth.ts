import { auth } from "@clerk/nextjs/server";

interface ClerkMetadata {
	role?: string;
}

export const checkRole = async (role: string) => {
	const { sessionClaims } = await auth();
	const metadata = sessionClaims?.metadata as ClerkMetadata | undefined;
	if (metadata?.role !== role) {
		throw new Error("Forbidden");
	}
};
