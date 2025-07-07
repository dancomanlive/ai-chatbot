import { auth, type UserType } from '@/app/(auth)/auth';
import type { NextRequest } from 'next/server';
import { getChatsByUserId } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Number.parseInt(searchParams.get('limit') || '10');
  const startingAfter = searchParams.get('starting_after');
  const endingBefore = searchParams.get('ending_before');

  if (startingAfter && endingBefore) {
    return new ChatSDKError(
      'bad_request:api',
      'Only one of starting_after or ending_before can be provided.',
    ).toResponse();
  }

  const session = await auth();
  const cookieStore = await cookies();
  
  // Check for guest user cookies if no session exists
  let userType: UserType;
  let userId: string;
  
  if (session?.user) {
    userType = session.user.type;
    userId = session.user.id;
  } else {
    const guestUserId = cookieStore.get('guest-user-id')?.value;
    const guestUserType = cookieStore.get('guest-user-type')?.value;
    
    if (guestUserId && guestUserType === 'guest') {
      userType = 'guest';
      userId = guestUserId;
    } else {
      // No session and no guest cookies - create a guest user on demand like chat API
      const { createGuestUser } = await import('@/lib/db/queries');
      const [guestUser] = await createGuestUser();
      
      userType = 'guest';
      userId = guestUser.id;
    }
  }

  console.log('History API - User ID:', userId);
  console.log('History API - User type:', userType);

  // For guest users, return empty history since they don't save to database
  if (userType === 'guest') {
    return Response.json({
      chats: [],
      hasMore: false,
    });
  }

  const chats = await getChatsByUserId({
    id: userId,
    limit,
    startingAfter,
    endingBefore,
  });

  return Response.json(chats);
}
