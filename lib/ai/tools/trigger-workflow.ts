// Temporal workflow trigger tool for AI chat
import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { triggerWorkflow as startWorkflow, getWorkflowStatus } from '@/lib/temporal/client';
import { extractEventFromMessage, createTemporalEvent } from '@/lib/temporal/event-extraction';

interface TemporalToolProps {
  session: Session;
  chatId: string;
}

/**
 * AI tool for triggering Temporal workflows from chat
 */
export const triggerWorkflow = ({ session, chatId }: TemporalToolProps) =>
  tool({
    description: `
      Trigger a Temporal workflow based on user requests. Use this when users want to:
      - Report incidents or system issues
      - Process documents or files
      - Start data processing jobs
      - Run any workflow-based automation
      
      Examples:
      - "We have a critical system outage"
      - "Process the document at s3://bucket/file.pdf"
      - "Run the daily data pipeline"
    `,
    inputSchema: z.object({
      userMessage: z.string().describe('The original user message'),
    }),
    execute: async ({ userMessage }) => {
      try {
        // Extract event information from natural language
        const extractedEvent = await extractEventFromMessage(userMessage);
        
        if (!extractedEvent.isWorkflowEvent) {
          return {
            success: false,
            message: `This doesn't appear to be a workflow request. ${extractedEvent.reasoning}`,
            workflowTriggered: false,
          };
        }
        
        // Create Temporal event payload using session data
        const temporalEvent = createTemporalEvent(
          extractedEvent, 
          userMessage, 
          chatId, 
          session.user?.id
        );
        
        if (!temporalEvent) {
          return {
            success: false,
            message: 'Could not create workflow event from this message.',
            workflowTriggered: false,
          };
        }
        
        // Trigger the Root Orchestrator workflow
        const result = await startWorkflow(temporalEvent);
        
        return {
          success: true,
          message: `Workflow triggered successfully! I've ${extractedEvent.eventType === 'incident' ? 'started incident response' : 
            extractedEvent.eventType?.includes('document') ? 'begun document processing' :
            'initiated workflow processing'} for your request.`,
          workflowId: result.workflowId,
          runId: result.runId,
          eventType: extractedEvent.eventType,
          priority: extractedEvent.priority,
          workflowTriggered: true,
          details: {
            eventType: temporalEvent.eventType,
            source: temporalEvent.source,
            metadata: temporalEvent.metadata,
          }
        };
        
      } catch (error: any) {
        console.error('Error triggering workflow:', error);
        return {
          success: false,
          message: `Failed to trigger workflow: ${error?.message || 'Unknown error'}`,
          workflowTriggered: false,
          error: error?.message || 'Unknown error',
        };
      }
    },
  });

/**
 * AI tool for checking workflow status
 */
export const checkWorkflowStatus = ({ session, chatId }: TemporalToolProps) =>
  tool({
    description: `
      Check the status of a running Temporal workflow. Use this when users ask about:
      - Status of their requests
      - Progress of document processing
      - Incident response updates
      - Any workflow they've previously started
    `,
    inputSchema: z.object({
      workflowId: z.string().describe('The workflow ID to check'),
    }),
    execute: async ({ workflowId }) => {
      try {
        const status = await getWorkflowStatus(workflowId);
        
        return {
          success: true,
          workflowId,
          status,
          message: `Workflow ${workflowId} status retrieved successfully.`,
        };
        
      } catch (error: any) {
        console.error('Error checking workflow status:', error);
        return {
          success: false,
          workflowId,
          message: `Could not retrieve status for workflow ${workflowId}: ${error?.message || 'Unknown error'}`,
          error: error?.message || 'Unknown error',
        };
      }
    },
  });
