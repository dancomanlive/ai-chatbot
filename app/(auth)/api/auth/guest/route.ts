import { NextResponse } from 'next/server';
import { createGuestUser } from '@/lib/db/queries';
import { signIn } from '@/app/(auth)/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('redirectUrl') || '/';

  console.log('Guest authentication requested, redirectUrl:', redirectUrl);

  try {
    // Simply redirect to the requested URL and let the chat API handle guest authentication
    console.log('Redirecting directly to:', redirectUrl);
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  } catch (error) {
    console.error('Guest user creation failed:', error);
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
