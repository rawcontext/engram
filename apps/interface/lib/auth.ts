import { auth } from "@clerk/nextjs/server";

export const checkRole = async (role: string) => {
  const { sessionClaims } = await auth();
  // @ts-ignore - Clerk types need config
  if (sessionClaims?.metadata?.role !== role) {
    throw new Error("Forbidden");
  }
};
