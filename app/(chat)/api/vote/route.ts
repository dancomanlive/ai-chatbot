import { auth, type UserType } from '@/app/(auth)/auth';
import { getChatById, getVotesByChatId, voteMessage } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return new ChatSDKError(
      'bad_request:api',
      'Parameter chatId is required.',
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

  // For guest users, return empty votes since they don't save to database
  if (userType === 'guest') {
    return Response.json([], { status: 200 });
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatSDKError('not_found:chat').toResponse();
  }

  if (chat.userId !== userId) {
    return new ChatSDKError('forbidden:vote').toResponse();
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
}

export async function PATCH(request: Request) {
  const {
    chatId,
    messageId,
    type,
  }: { chatId: string; messageId: string; type: 'up' | 'down' } =
    await request.json();

  if (!chatId || !messageId || !type) {
    return new ChatSDKError(
      'bad_request:api',
      'Parameters chatId, messageId, and type are required.',
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

  // For guest users, accept the vote but don't save to database
  if (userType === 'guest') {
    return new Response('Message voted (guest)', { status: 200 });
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatSDKError('not_found:vote').toResponse();
  }

  if (chat.userId !== userId) {
    return new ChatSDKError('forbidden:vote').toResponse();
  }

  await voteMessage({
    chatId,
    messageId,
    type: type,
  });

  return new Response('Message voted', { status: 200 });
}
