import { auth } from '@clerk/nextjs/server';

export const checkRole = (role: string) => {
  const { sessionClaims } = auth();
  // @ts-ignore - Clerk types need config
  if (sessionClaims?.metadata?.role !== role) {
    throw new Error('Forbidden');
  }
};
