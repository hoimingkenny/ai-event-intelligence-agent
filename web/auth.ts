import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { isAnalystAllowed } from '../src/auth/analyst-allowlist';

export type AppSessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  githubLogin?: string | null;
  isAnalyst?: boolean;
};

declare module 'next-auth' {
  interface Session {
    user: AppSessionUser;
  }
}

type AppToken = {
  githubLogin?: string;
  isAnalyst?: boolean;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
  callbacks: {
    async jwt({ token, profile }) {
      const appToken = token as typeof token & AppToken;
      if (profile && typeof profile === 'object' && 'login' in profile) {
        const login = typeof profile.login === 'string' ? profile.login : undefined;
        if (login) appToken.githubLogin = login;
      }
      if (appToken.githubLogin) {
        appToken.isAnalyst = isAnalystAllowed(appToken.githubLogin, process.env.ANALYST_GITHUB_USERS);
      }
      return appToken;
    },
    async session({ session, token }) {
      const appToken = token as typeof token & AppToken;
      if (session.user) {
        session.user.githubLogin = appToken.githubLogin ?? null;
        session.user.isAnalyst = Boolean(appToken.isAnalyst);
      }
      return session;
    },
  },
});
