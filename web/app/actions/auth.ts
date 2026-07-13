'use server';

import { signIn, signOut } from '@/auth';

export async function signInWithGitHub(callbackUrl?: string) {
  await signIn('github', { redirectTo: callbackUrl || '/workspace' });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/events' });
}
