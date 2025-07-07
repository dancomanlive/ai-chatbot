// Temporal integration for Next.js chat
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
 * Event payload structure for Root Orchestrator
 */
export interface TemporalEvent {
  eventType: string;
  source: string;
  message?: string;
  metadata?: Record<string, any>;
  chatId?: string;
  userId?: string;
  timestamp?: string;
}

/**
 * Start or signal the Root Orchestrator workflow with a chat-derived event
 */
export async function triggerRootOrchestrator(
  event: TemporalEvent,
  workflowId?: string
): Promise<{ workflowId: string; runId: string }> {
  const client = await getTemporalClient();
  
  // Generate workflow ID if not provided
  const actualWorkflowId = workflowId || `chat-orchestrator-${event.chatId || Date.now()}`;
  
  try {
    // Try to get existing workflow
    const handle = client.workflow.getHandle(actualWorkflowId);
    
    // Signal existing workflow
    await handle.signal('trigger', event);
    console.log(`Signaled existing workflow: ${actualWorkflowId}`);
    
    return {
      workflowId: actualWorkflowId,
      runId: 'existing'
    };
    
  } catch (error) {
    // Workflow doesn't exist, start new one
    console.log(`Starting new workflow: ${actualWorkflowId}`);
    
    const handle = await client.workflow.start('RootOrchestratorWorkflow', {
      args: [{}], // Empty initial input
      taskQueue: 'root_orchestrator-queue',
      workflowId: actualWorkflowId,
    });
    
    // Send the initial event signal
    await handle.signal('trigger', event);
    
    return {
      workflowId: actualWorkflowId,
      runId: handle.workflowId // Use workflowId as runId for simplicity
    };
  }
}

/**
 * Query workflow status
 */
export async function getWorkflowStatus(workflowId: string): Promise<any> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  
  try {
    // You can add custom queries to your workflow and call them here
    const status = await handle.query('getStatus');
    return status;
  } catch (error: any) {
    console.error(`Error querying workflow ${workflowId}:`, error);
    return { status: 'unknown', error: error?.message || 'Unknown error' };
  }
}

/**
 * Get workflow execution history
 */
export async function getWorkflowHistory(workflowId: string): Promise<any[]> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  
  try {
    const result = await handle.result();
    return result;
  } catch (error: any) {
    console.error(`Error getting workflow history ${workflowId}:`, error);
    return [];
  }
}
