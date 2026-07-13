import { NextResponse } from 'next/server';
import { auth } from './auth';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/workspace')) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const login = new URL('/login', req.nextUrl.origin);
    login.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(login);
  }

  if (!req.auth.user?.isAnalyst) {
    return NextResponse.redirect(new URL('/auth/denied', req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/workspace/:path*'],
};
