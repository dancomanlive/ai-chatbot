import { streamText, convertToCoreMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { auth } from '@/app/(auth)/auth';
import { 
  getMessageCountByUserId,
  saveChat,
  saveMessages
} from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema } from './schema';

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session || !session.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const json = await request.json();
    const { success, data, error } = postRequestBodySchema.safeParse(json);

    if (!success) {
      return Response.json({ error: error.issues }, { status: 400 });
    }

    const { id, message, selectedChatModel, selectedVisibilityType } = data;

    // Check message count and entitlements
    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    const entitlements = entitlementsByUserType[session.user.type];

    if (messageCount >= entitlements.maxMessagesPerDay) {
      return Response.json(
        { 
          error: 'Rate limit exceeded',
          type: 'rate_limit',
          userType: session.user.type 
        },
        { status: 429 }
      );
    }

    // Create or update the chat
    const chatId = id || generateUUID();
    
    // Save the chat and user message
    await saveChat({
      id: chatId,
      userId: session.user.id,
      title: 'New Chat',
      visibility: selectedVisibilityType || 'private'
    });

    await saveMessages({
      messages: [
        {
          id: message.id,
          chatId,
          role: message.role,
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        }
      ],
    });

    // Extract text from message parts for AI processing
    const messageText = message.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join(' ');

    // Create the AI response using streaming
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      messages: convertToCoreMessages([
        {
          role: 'system',
          parts: [{ type: 'text', text: `You are a helpful AI assistant. You provide clear, accurate, and helpful responses to user questions across a wide range of topics.` }]
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: messageText }]
        }
      ]),
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Unexpected error in chat API:', error);
    return Response.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
