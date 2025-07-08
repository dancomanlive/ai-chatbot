// Updated chat API integration with ChatSessionWorkflow
import {
  startChatSessionWorkflow,
  sendMessageToChatSession,
  getChatSessionStatus,
  updateChatSessionUser
} from '@/lib/temporal/chat-workflow';

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
          secure: false,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24,
          path: '/'
        });
        cookieStore.set('guest-user-type', 'guest', { 
          secure: false,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24,
          path: '/'
        });
        cookieStore.set('guest-message-count', '0', {
          secure: false,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24,
          path: '/'
        });
        
        responseCookies.push(`guest-user-id=${guestUser.id}; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
        responseCookies.push(`guest-user-type=guest; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
        responseCookies.push(`guest-message-count=0; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
        
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

    // 🚀 NEW: Initialize or get chat session workflow
    let chatWorkflowStarted = false;
    try {
      // First, try to start/get the chat session workflow
      // Map userType to workflow expected values
      const workflowUserType = userType === 'regular' ? 'authenticated' : 'guest';
      const { workflowId, handle } = await startChatSessionWorkflow(
        id, // Use chat ID as session ID
        userId,
        workflowUserType
      );
      
      console.log(`Chat session workflow: ${workflowId}`);
      
      // Update user info in workflow if session exists
      if (session?.user) {
        await updateChatSessionUser(id, userId, workflowUserType);
      }
      
      chatWorkflowStarted = true;
    } catch (error) {
      console.error('Failed to start chat session workflow:', error);
      // Continue with traditional approach if workflow fails
    }

    // Load existing messages for context
    let existingMessages: ChatMessage[] = [];
    
    if (userType !== 'guest') {
      // For authenticated users, use database
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

      // Get and convert database messages to UI format
      const dbMessages = await getMessagesByChatId({ id });
      existingMessages = convertToUIMessages(dbMessages);
    } else if (chatWorkflowStarted) {
      // For guest users with workflow, get history from workflow
      try {
        const { getChatSessionHistory } = await import('@/lib/temporal/chat-workflow');
        const workflowHistory = await getChatSessionHistory(id, 50);
        
        // Convert workflow history to ChatMessage format
        existingMessages = workflowHistory.map(msg => ({
          id: msg.messageId,
          chatId: id,
          role: msg.role as 'user' | 'assistant' | 'system',
          parts: [{ type: 'text' as const, text: msg.content }],
          metadata: { createdAt: msg.timestamp },
          createdAt: new Date(msg.timestamp),
        }));
      } catch (error) {
        console.error('Failed to get workflow history:', error);
        existingMessages = [];
      }
    }

    // 🚀 NEW: Send message to chat session workflow
    if (chatWorkflowStarted) {
      try {
        const messageId = generateUUID();
        await sendMessageToChatSession(id, {
          messageId,
          content: message.parts?.find(part => part.type === 'text')?.text || '',
          role: 'user',
          timestamp: new Date().toISOString(),
          userId,
          metadata: {
            selectedChatModel,
            selectedVisibilityType,
          }
        });
        
        console.log(`Message sent to chat workflow: ${messageId}`);
      } catch (error) {
        console.error('Failed to send message to workflow:', error);
      }
    }

    // Check rate limiting after loading messages
    if (userType === 'guest') {
      let messageCount = 0;
      
      if (chatWorkflowStarted) {
        // Get count from workflow
        try {
          const sessionStatus = await getChatSessionStatus(id);
          messageCount = sessionStatus?.messageCount || 0;
        } catch (error) {
          console.error('Failed to get session status from workflow:', error);
          // Fallback to cookie-based counting
          messageCount = parseInt(cookieStore.get('guest-message-count')?.value || '0', 10);
        }
      } else {
        // Fallback to cookie-based counting
        messageCount = parseInt(cookieStore.get('guest-message-count')?.value || '0', 10);
      }
      
      console.log('Debug - Current guest message count:', messageCount);
      
      // Check if user has exceeded the limit (3 messages for guests)
      const entitlements = entitlementsByUserType[userType];
      if (messageCount >= entitlements.maxMessagesPerDay) {
        console.log('Debug - Guest user hit rate limit:', { messageCount, limit: entitlements.maxMessagesPerDay });
        
        return new Response(
          JSON.stringify({
            error: 'rate_limited',
            message: 'You have reached the maximum number of messages for guest users. Please create an account to continue chatting.',
            limit: entitlements.maxMessagesPerDay,
            current: messageCount,
            upgrade_required: true
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              ...(responseCookies.length > 0 && {
                'Set-Cookie': responseCookies.join(', ')
              })
            },
          }
        );
      }
      
      // Increment and update guest message count
      const newCount = messageCount + 1;
      console.log('Debug - Incrementing guest message count to:', newCount);
      
      cookieStore.set('guest-message-count', newCount.toString(), {
        secure: false,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24,
        path: '/'
      });
      
      responseCookies.push(`guest-message-count=${newCount}; Path=/; SameSite=lax; Max-Age=${60 * 60 * 24}`);
    }

    // Continue with the rest of the existing chat logic...
    const allMessages = [...existingMessages, message];
    const modelMessages = convertToModelMessages(allMessages);

    const { longitude, latitude, city, country } = isProductionEnvironment ? geolocation(request) : { longitude: '0', latitude: '0', city: '', country: '' };

    const requestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    const streamContext = getStreamContext();

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: modelMessages,
          stopWhen: stepCountIs(5),
          experimental_activeTools: stepCountIs(0) ? [
            'triggerWorkflow',
            'checkWorkflowStatus',
            'getWeather'
          ] : undefined,
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: {
            getWeather,
            triggerWorkflow: triggerWorkflow({ session: effectiveSession, chatId: id }),
            checkWorkflowStatus: checkWorkflowStatus({ session: effectiveSession, chatId: id }),
          },
          experimental_telemetry: {
            isEnabled: true,
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
        try {
          const lastMessage = messages[messages.length - 1];
          const responseContent = lastMessage?.parts?.find(part => part.type === 'text')?.text || '';
          
          // 🚀 NEW: Send AI response to chat session workflow
          if (chatWorkflowStarted) {
            try {
              await sendMessageToChatSession(id, {
                messageId: generateUUID(),
                content: responseContent,
                role: 'assistant',
                timestamp: new Date().toISOString(),
                userId: 'system',
                metadata: {
                  model: selectedChatModel,
                  finishReason: 'stop',
                }
              });
            } catch (error) {
              console.error('Failed to send AI response to workflow:', error);
            }
          }

          // Save to database for authenticated users
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
        } catch (error) {
          console.error('Error in onFinish:', error);
        }
      },
      onError: (error) => {
        console.log(error);
        return 'Oops, an error occurred!';
      },
    });

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
      const streamId = generateUUID();
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
    console.error('Chat API error:', error);
    return new ChatSDKError('bad_request:chat').toResponse();
  }
}
