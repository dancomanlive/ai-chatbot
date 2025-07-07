import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { triggerWorkflow, checkWorkflowStatus } from '@/lib/ai/tools/trigger-workflow';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';
import { cookies } from 'next/headers';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();
    const cookieStore = await cookies();
    
    // Track cookies to set in response headers
    const responseCookies: string[] = [];
    
    // Check for guest user cookies if no session exists
    let userType: UserType;
    let userId: string;
    let effectiveSession: any; // Session object for tools
    
    if (session?.user) {
      userType = session.user.type;
      userId = session.user.id;
      effectiveSession = session;
    } else {
      const guestUserId = cookieStore.get('guest-user-id')?.value;
      const guestUserType = cookieStore.get('guest-user-type')?.value;
      
      console.log('Debug - Guest cookies check:', { guestUserId, guestUserType });
      
      if (guestUserId && guestUserType === 'guest') {
        userType = 'guest';
        userId = guestUserId;
        // Create a mock session for guest users
        effectiveSession = {
          user: {
            id: guestUserId,
            type: 'guest' as UserType,
            email: `guest-${guestUserId}@temp.local`,
            name: 'Guest User'
          }
        };
        console.log('Chat API - Using guest cookies - User type:', userType, 'User ID:', userId);
      } else {
        // No session and no guest cookies - create a guest user on demand
        const { createGuestUser } = await import('@/lib/db/queries');
        const [guestUser] = await createGuestUser();
        
        userType = 'guest';
        userId = guestUser.id;
        
        console.log('Debug - Setting guest cookies for user:', guestUser.id);
        
        // Set guest user cookies for future requests
        cookieStore.set('guest-user-id', guestUser.id, { 
          secure: false, // Allow non-HTTPS in development
          sameSite: 'lax',
          maxAge: 60 * 60 * 24, // 24 hours
          path: '/'
        });
        cookieStore.set('guest-user-type', 'guest', { 
          secure: false, // Allow non-HTTPS in development
          sameSite: 'lax',
          maxAge: 60 * 60 * 24, // 24 hours
          path: '/'
        });
        cookieStore.set('guest-message-count', '0', {
          secure: false, // Allow non-HTTPS in development
          sameSite: 'lax',
          maxAge: 60 * 60 * 24, // 24 hours
          path: '/'
        });
        
        // Also add to response headers manually for better reliability
        responseCookies.push(`guest-user-id=${guestUser.id}; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
        responseCookies.push(`guest-user-type=guest; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
        responseCookies.push(`guest-message-count=0; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
        
        console.log('Debug - Cookies set, verifying:', {
          setGuestUserId: guestUser.id,
          readGuestUserId: cookieStore.get('guest-user-id')?.value
        });
        
        // Create a mock session for guest users
        effectiveSession = {
          user: {
            id: guestUser.id,
            type: 'guest' as UserType,
            email: guestUser.email,
            name: 'Guest User'
          }
        };
        console.log('Chat API - Created guest user on demand - User type:', userType, 'User ID:', userId);
      }
    }

    console.log('Chat API - User type:', userType, 'User ID:', userId);

    // Skip database operations for guest users
    if (userType !== 'guest') {
      const chat = await getChatById({ id });

      if (!chat) {
        const title = await generateTitleFromUserMessage({
          message,
        });

        await saveChat({
          id,
          userId: userId,
          title,
          visibility: selectedVisibilityType,
        });
      } else {
        if (chat.userId !== userId) {
          return new ChatSDKError('forbidden:chat').toResponse();
        }
      }
    }

    // For guests, use empty message history; for registered users, get from DB
    const messagesFromDb = userType === 'guest' ? [] : await getMessagesByChatId({ id });
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    // Handle message counting for rate limiting (moved here to access uiMessages)
    let messageCount = 0;
    if (userType !== 'guest') {
      // For regular users, count messages from database
      messageCount = await getMessageCountByUserId({
        id: userId,
        differenceInHours: 24,
      });
    } else {
      // For guest users, use and increment cookie-based counter
      const guestMessageCountCookie = cookieStore.get('guest-message-count')?.value;
      messageCount = guestMessageCountCookie ? parseInt(guestMessageCountCookie, 10) + 1 : 1;
      
      // Update the cookie for the next request
      cookieStore.set('guest-message-count', messageCount.toString(), {
        secure: false, // Allow non-HTTPS in development
        sameSite: 'lax',
        maxAge: 60 * 60 * 24, // 24 hours
        path: '/'
      });
      
      // Also add to response headers manually
      responseCookies.push(`guest-message-count=${messageCount}; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
      
      console.log('Guest user message count (cookie-based):', messageCount);
    }

    console.log('Final messageCount for rate limiting:', messageCount, 'userType:', userType);
    
    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      console.log('Rate limit triggered! messageCount:', messageCount, 'limit:', entitlementsByUserType[userType].maxMessagesPerDay);
      return new ChatSDKError('rate_limit:chat').toResponse();
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    // Save initial user message (skip for guests)
    if (userType !== 'guest') {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: 'user',
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const streamId = generateUUID();
    if (userType !== 'guest') {
      await createStreamId({ streamId, chatId: id });
    }

    console.log(JSON.stringify(uiMessages, null, 2));

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? []
              : [
                  'getWeather',
                  'createDocument',
                  'updateDocument',
                  'requestSuggestions',
                  'triggerWorkflow',
                  'checkWorkflowStatus',
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: {
            getWeather,
            createDocument: createDocument({ session: effectiveSession, dataStream }),
            updateDocument: updateDocument({ session: effectiveSession, dataStream }),
            requestSuggestions: requestSuggestions({
              session: effectiveSession,
              dataStream,
            }),
            triggerWorkflow: triggerWorkflow({ session: effectiveSession, chatId: id }),
            checkWorkflowStatus: checkWorkflowStatus({ session: effectiveSession, chatId: id }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          }),
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        // Save AI response messages (skip for guests)
        if (userType !== 'guest') {
          await saveMessages({
            messages: messages.map((message) => ({
              id: message.id,
              role: message.role,
              parts: message.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        console.log(error);
        return 'Oops, an error occurred!';
      },
    });

    const streamContext = getStreamContext();

    // Prepare headers with cookies
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    // Add Set-Cookie headers if we have any (multiple Set-Cookie headers)
    if (responseCookies.length > 0) {
      responseCookies.forEach(cookie => {
        headers.append('Set-Cookie', cookie);
      });
    }

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
        { headers }
      );
    } else {
      // Return the stream with proper transformation for compatibility
      return new Response(
        stream.pipeThrough(new JsonToSseTransformStream()),
        { headers }
      );
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    
    console.error('Unexpected error in chat API:', error);
    return new ChatSDKError('bad_request:chat', 'An unexpected error occurred').toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
