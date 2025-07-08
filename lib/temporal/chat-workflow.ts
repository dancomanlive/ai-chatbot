// Chat Session Workflow - Long-running workflow for chat conversations
import { Connection, WorkflowHandle, Client } from '@temporalio/client';

// Temporal client configuration
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';

let temporalClient: Client | null = null;

/**
 * Get or create Temporal client instance
 */
export async function getTemporalClient(): Promise<Client> {
  if (!temporalClient) {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    
    temporalClient = new Client({
      connection,
      namespace: TEMPORAL_NAMESPACE,
    });
  }
  
  return temporalClient;
}

/**
 * Chat message signal payload
 */
export interface ChatMessage {
  messageId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Chat session workflow state
 */
export interface ChatSessionState {
  sessionId: string;
  userId?: string;
  userType: 'guest' | 'authenticated';
  messageCount: number;
  isActive: boolean;
  lastActivity: string;
  metadata?: Record<string, any>;
}

/**
 * Response from chat workflow operations
 */
export interface ChatWorkflowResponse {
  success: boolean;
  messageId?: string;
  workflowId?: string;
  triggeredWorkflows?: string[];
  response?: string;
  error?: string;
  rateLimited?: boolean;
  shouldSubscribe?: boolean;
}

/**
 * Start a new chat session workflow
 */
export async function startChatSessionWorkflow(
  sessionId: string,
  userId?: string,
  userType: 'guest' | 'authenticated' = 'guest'
): Promise<{ workflowId: string; handle: WorkflowHandle }> {
  const client = await getTemporalClient();
  
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    // Try to get existing workflow first
    const handle = client.workflow.getHandle(workflowId);
    
    // Check if it's running
    const description = await handle.describe();
    if (description.status.name === 'RUNNING') {
      console.log(`Using existing chat session workflow: ${workflowId}`);
      return { workflowId, handle };
    }
  } catch (error) {
    // Workflow doesn't exist, will create new one below
  }
  
  // Start new chat session workflow
  console.log(`Starting new chat session workflow: ${workflowId}`);
  
  const handle = await client.workflow.start('ChatSessionWorkflow', {
    args: [{
      sessionId,
      userId,
      userType,
      messageCount: 0,
      isActive: true,
      lastActivity: new Date().toISOString(),
    }],
    taskQueue: 'chat-session-queue',
    workflowId,
    // Let chat sessions run for up to 24 hours of inactivity
    workflowExecutionTimeout: '24h',
    // Each individual task can take up to 5 minutes
    workflowTaskTimeout: '5m',
  });
  
  return { workflowId, handle };
}

/**
 * Send a message to an existing chat session workflow
 */
export async function sendMessageToChatSession(
  sessionId: string,
  message: ChatMessage
): Promise<ChatWorkflowResponse> {
  const client = await getTemporalClient();
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    const handle = client.workflow.getHandle(workflowId);
    
    // Send message as signal to the workflow
    await handle.signal('receiveMessage', message);
    
    console.log(`Message sent to chat session ${sessionId}: ${message.messageId}`);
    
    return {
      success: true,
      messageId: message.messageId,
      workflowId,
    };
    
  } catch (error: any) {
    console.error(`Error sending message to chat session ${sessionId}:`, error);
    return {
      success: false,
      error: error?.message || 'Failed to send message to chat session',
    };
  }
}

/**
 * Get chat session status
 */
export async function getChatSessionStatus(sessionId: string): Promise<ChatSessionState | null> {
  const client = await getTemporalClient();
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    const handle = client.workflow.getHandle(workflowId);
    const status = await handle.query('getSessionState') as ChatSessionState;
    return status;
  } catch (error: any) {
    console.error(`Error getting chat session status ${sessionId}:`, error);
    return null;
  }
}

/**
 * Terminate a chat session workflow
 */
export async function terminateChatSession(
  sessionId: string,
  reason: string = 'User ended session'
): Promise<boolean> {
  const client = await getTemporalClient();
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.terminate(reason);
    console.log(`Chat session ${sessionId} terminated: ${reason}`);
    return true;
  } catch (error: any) {
    console.error(`Error terminating chat session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Send workflow trigger signal to chat session
 */
export async function triggerWorkflowFromChat(
  sessionId: string,
  workflowEvent: any
): Promise<ChatWorkflowResponse> {
  const client = await getTemporalClient();
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    const handle = client.workflow.getHandle(workflowId);
    
    // Send workflow trigger signal
    await handle.signal('triggerWorkflow', workflowEvent);
    
    console.log(`Workflow trigger sent to chat session ${sessionId}`);
    
    return {
      success: true,
      workflowId,
    };
    
  } catch (error: any) {
    console.error(`Error triggering workflow from chat session ${sessionId}:`, error);
    return {
      success: false,
      error: error?.message || 'Failed to trigger workflow from chat session',
    };
  }
}

/**
 * Query chat session for message history
 */
export async function getChatSessionHistory(
  sessionId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  const client = await getTemporalClient();
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    const handle = client.workflow.getHandle(workflowId);
    const history = await handle.query('getMessageHistory', { limit }) as ChatMessage[];
    return history || [];
  } catch (error: any) {
    console.error(`Error getting chat session history ${sessionId}:`, error);
    return [];
  }
}

/**
 * Update user authentication status in chat session
 */
export async function updateChatSessionUser(
  sessionId: string,
  userId: string,
  userType: 'guest' | 'authenticated'
): Promise<boolean> {
  const client = await getTemporalClient();
  const workflowId = `chat-session-${sessionId}`;
  
  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('updateUser', { userId, userType });
    console.log(`Updated user for chat session ${sessionId}: ${userId} (${userType})`);
    return true;
  } catch (error: any) {
    console.error(`Error updating user for chat session ${sessionId}:`, error);
    return false;
  }
}
