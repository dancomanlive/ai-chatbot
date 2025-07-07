import { NextResponse } from 'next/server';
import { signOut } from '@/app/(auth)/auth';

export async function GET(request: Request) {
  try {
    await signOut({ redirectTo: '/' });
    return NextResponse.json({ success: true, message: 'Signed out successfully' });
  } catch (error) {
    console.error('Error signing out:', error);
    return NextResponse.json({ success: false, error: 'Failed to sign out' }, { status: 500 });
  }
}
