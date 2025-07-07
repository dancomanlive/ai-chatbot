import { cookies } from 'next/headers';

import { Chat } from '@/components/chat';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { generateUUID } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { auth, type UserType } from '../(auth)/auth';
import { redirect } from 'next/navigation';
import type { Session } from 'next-auth';

export default async function Page() {
  const session = await auth();

  // For guest users, create a mock session
  let effectiveSession: Session;
  if (!session) {
    // Create a temporary guest user for this session
    const { createGuestUser } = await import('@/lib/db/queries');
    const [guestUser] = await createGuestUser();
    
    effectiveSession = {
      user: {
        id: guestUser.id,
        type: 'guest' as UserType,
        email: guestUser.email,
        name: 'Guest User'
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
    };
  } else {
    effectiveSession = session;
  }

  const id = generateUUID();

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('chat-model');

  if (!modelIdFromCookie) {
    return (
      <>
        <Chat
          key={id}
          id={id}
          initialMessages={[]}
          initialChatModel={DEFAULT_CHAT_MODEL}
          initialVisibilityType="private"
          isReadonly={false}
          session={effectiveSession}
          autoResume={false}
        />
        <DataStreamHandler />
      </>
    );
  }

  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        initialChatModel={modelIdFromCookie.value}
        initialVisibilityType="private"
        isReadonly={false}
        session={effectiveSession}
        autoResume={false}
      />
      <DataStreamHandler />
    </>
  );
}
