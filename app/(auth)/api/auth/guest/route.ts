import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { signIn } from '@/app/(auth)/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('redirectUrl') || '/';

  try {
    // Use NextAuth signIn with the guest provider, which should handle everything
    const result = await signIn('guest', { 
      redirectTo: redirectUrl,
      redirect: true
    });

    // This shouldn't be reached if redirect: true works
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  } catch (error) {
    console.error('Guest user creation failed:', error);
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
