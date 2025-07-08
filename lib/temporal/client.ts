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
 * Event payload structure for triggering workflows
 */
export interface TemporalEvent {
  eventType: string;
  source: string;
  message?: string;
  metadata?: Record<string, any>;
  chatId?: string;
  userId?: string;
  timestamp?: string;
  workflowType?: 'incident' | 'document_processing' | 'data_processing';
}

/**
 * Trigger a specific workflow directly based on event type
 */
export async function triggerWorkflow(
  event: TemporalEvent,
  workflowId?: string
): Promise<{ workflowId: string; runId: string; workflowType: string }> {
  const client = await getTemporalClient();
  
  // Determine workflow type based on event
  const workflowType = determineWorkflowType(event);
  const actualWorkflowId = workflowId || `${workflowType}-${event.chatId || Date.now()}`;
  
  try {
    let handle: WorkflowHandle;
    
    switch (workflowType) {
      case 'incident':
        handle = await client.workflow.start('IncidentWorkflow', {
          args: [{
            incident_id: `incident-${Date.now()}`,
            source: event.source,
            severity: event.metadata?.severity || 'medium',
            message: event.message || 'Incident reported from chat',
            event_type: event.eventType,
            timestamp: event.timestamp || new Date().toISOString(),
            additional_context: {
              ...event.metadata,
              chatId: event.chatId,
              userId: event.userId
            }
          }],
          taskQueue: 'incident_workflow-queue',
          workflowId: actualWorkflowId,
        });
        break;
        
      case 'document_processing':
        handle = await client.workflow.start('DocumentProcessingWorkflow', {
          args: [{
            document_uri: event.metadata?.documentUri || event.metadata?.document_uri,
            source: event.source,
            event_type: event.eventType,
            bucket: event.metadata?.bucket,
            key: event.metadata?.key,
            container: event.metadata?.container,
            blob_name: event.metadata?.blobName,
            size: event.metadata?.size,
            content_type: event.metadata?.contentType,
            timestamp: event.timestamp || new Date().toISOString(),
            additional_context: {
              ...event.metadata,
              chatId: event.chatId,
              userId: event.userId
            }
          }],
          taskQueue: 'document_processing-queue',
          workflowId: actualWorkflowId,
        });
        break;
        
      default:
        throw new Error(`Unsupported workflow type: ${workflowType}`);
    }
    
    console.log(`Started ${workflowType} workflow: ${actualWorkflowId}`);
    
    return {
      workflowId: actualWorkflowId,
      runId: handle.workflowId,
      workflowType
    };
    
  } catch (error: any) {
    console.error(`Error starting ${workflowType} workflow:`, error);
    throw error;
  }
}

/**
 * Determine workflow type based on event characteristics
 */
function determineWorkflowType(event: TemporalEvent): string {
  // If explicitly specified
  if (event.workflowType) {
    return event.workflowType;
  }
  
  // Determine based on event type
  if (event.eventType.includes('incident') || 
      event.eventType.includes('alert') || 
      event.eventType.includes('error')) {
    return 'incident';
  }
  
  if (event.eventType.includes('ObjectCreated') || 
      event.eventType.includes('BlobCreated') || 
      event.eventType.includes('document') ||
      event.source === 's3' ||
      event.source === 'azure-blob') {
    return 'document_processing';
  }
  
  // Default to incident workflow for unknown types
  return 'incident';
}

/**
 * Query workflow status
 */
export async function getWorkflowStatus(workflowId: string): Promise<any> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  
  try {
    // Try to get status from different workflow types
    const description = await handle.describe();
    
    // Try to query workflow-specific status
    let status;
    try {
      if (workflowId.includes('incident')) {
        status = await handle.query('getIncidentStatus');
      } else if (workflowId.includes('document')) {
        status = await handle.query('getProcessingStatus');
      } else {
        status = await handle.query('getStatus');
      }
    } catch (queryError) {
      // If query fails, use basic description
      status = {
        status: description.status.name,
        workflowId: description.workflowId,
        startTime: description.startTime,
        executionTime: description.executionTime
      };
    }
    
    return status;
  } catch (error: any) {
    console.error(`Error querying workflow ${workflowId}:`, error);
    return { status: 'unknown', error: error?.message || 'Unknown error' };
  }
}

/**
 * Get workflow execution result
 */
export async function getWorkflowResult(workflowId: string): Promise<any> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  
  try {
    const result = await handle.result();
    return result;
  } catch (error: any) {
    console.error(`Error getting workflow result ${workflowId}:`, error);
    return { error: error?.message || 'Unknown error' };
  }
}
