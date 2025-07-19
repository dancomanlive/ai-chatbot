// Workflow progress tracking tool for real-time updates
import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { getWorkflowStatus, getTemporalClient } from '@/lib/temporal/client';
import type { WorkflowProgress, WorkflowStep } from '@/lib/types';

interface WorkflowProgressToolProps {
  session: Session;
  dataStream: any;
}

// Define workflow step mappings for different workflow types
const WORKFLOW_STEPS = {
  document_processing: [
    { name: 'validation', label: 'Validating Document', description: 'Checking document format and accessibility' },
    { name: 'download', label: 'Downloading Document', description: 'Retrieving document content' },
    { name: 'text_extraction', label: 'Extracting Text', description: 'Converting document to text format' },
    { name: 'chunking', label: 'Chunking Text', description: 'Breaking text into manageable segments' },
    { name: 'embedding', label: 'Generating Embeddings', description: 'Creating vector representations' },
    { name: 'storage', label: 'Storing Results', description: 'Saving processed data to index' }
  ],
  semantic_search: [
    { name: 'embed_query', label: 'Processing Query', description: 'Converting search query to vector' },
    { name: 'retrieve_chunks', label: 'Searching Index', description: 'Finding relevant document chunks' },
    { name: 'generate_response', label: 'Generating Response', description: 'Creating final answer from results' }
  ]
};

/**
 * Tool for tracking workflow progress in real-time
 */
export const trackWorkflowProgress = ({ session, dataStream }: WorkflowProgressToolProps) =>
  tool({
    description: `
      Track the progress of a running workflow in real-time. Use this to:
      - Monitor workflow execution status
      - Show live progress updates to users
      - Display detailed step information
      - Handle workflow completion or failures
    `,
    inputSchema: z.object({
      workflowId: z.string().describe('The workflow ID to track'),
      enableLiveUpdates: z.boolean().default(true).describe('Whether to enable real-time progress streaming'),
    }),
    execute: async ({ workflowId, enableLiveUpdates }) => {
      try {
        // Get initial workflow status
        const status = await getWorkflowStatus(workflowId);
        
        if (!status || status.status === 'unknown') {
          return {
            success: false,
            error: 'Workflow not found or status unavailable',
            workflowId
          };
        }

        // Determine workflow type from workflowId
        const workflowType = workflowId.includes('document') ? 'document_processing' : 'semantic_search';
        const steps = WORKFLOW_STEPS[workflowType] || [];
        
        // Parse current progress from status
        const currentStepName = status.currentStep || status.step || 'unknown';
        const currentStepIndex = steps.findIndex(step => step.name === currentStepName);
        const completedSteps = currentStepIndex >= 0 ? currentStepIndex : 0;
        
        const progress: WorkflowProgress = {
          workflowId,
          workflowType,
          status: mapTemporalStatus(status.status),
          currentStep: currentStepName,
          totalSteps: steps.length,
          completedSteps,
          startTime: status.startTime || new Date().toISOString(),
          estimatedDuration: estimateRemainingTime(workflowType, completedSteps, steps.length)
        };

        // Stream progress data to UI
        if (dataStream) {
          dataStream.writeData({
            type: 'workflowProgress',
            workflowId,
            progress
          });
          
          // Stream step details
          steps.forEach((step, index) => {
            dataStream.writeData({
              type: 'workflowStep',
              workflowId,
              step: {
                workflowId,
                stepName: step.name,
                stepIndex: index,
                status: getStepStatus(index, currentStepIndex, progress.status),
                details: {
                  label: step.label,
                  description: step.description
                }
              }
            });
          });
        }

        // If live updates are enabled, start progress monitoring
        if (enableLiveUpdates && progress.status === 'running') {
          return {
            success: true,
            progress,
            steps: steps.map((step, index) => ({
              workflowId,
              stepName: step.name,
              stepIndex: index,
              status: getStepStatus(index, currentStepIndex, progress.status),
              details: {
                label: step.label,
                description: step.description
              }
            } as WorkflowStep)),
            message: `Workflow ${workflowId} is ${progress.status}. Currently on step: ${currentStepName}`,
            shouldPoll: true,
            pollInterval: 2000 // Poll every 2 seconds
          };
        }

        return {
          success: true,
          progress,
          steps: steps.map((step, index) => ({
            workflowId,
            stepName: step.name,
            stepIndex: index,
            status: getStepStatus(index, currentStepIndex, progress.status),
            details: {
              label: step.label,
              description: step.description
            }
          } as WorkflowStep)),
          message: `Workflow ${workflowId} status: ${progress.status}`
        };
        
      } catch (error: any) {
        console.error('Error tracking workflow progress:', error);
        return {
          success: false,
          error: error?.message || 'Unknown error',
          workflowId
        };
      }
    },
  });

/**
 * Tool for getting detailed information about a specific workflow step
 */
export const getWorkflowStepDetails = ({ session }: { session: Session }) =>
  tool({
    description: `
      Get detailed information about a specific workflow step.
      Use this when users click on a step to see what happened.
    `,
    inputSchema: z.object({
      workflowId: z.string().describe('The workflow ID'),
      stepName: z.string().describe('The name of the step to get details for'),
    }),
    execute: async ({ workflowId, stepName }) => {
      try {
        const client = await getTemporalClient();
        const handle = client.workflow.getHandle(workflowId);
        
        // Try to get step-specific details from workflow history
        const history = await handle.fetchHistory();
        const stepEvents = history.events?.filter(event => 
          event.activityTaskScheduledEventAttributes?.activityType?.name?.includes(stepName) ||
          event.activityTaskCompletedEventAttributes
        ) || [];
        
        // Extract step details from events
        const stepDetails = {
          stepName,
          workflowId,
          events: stepEvents.length,
          details: stepEvents.map(event => ({
            eventType: event.eventType,
            timestamp: event.eventTime,
            details: event.activityTaskCompletedEventAttributes?.result ||
                    event.activityTaskFailedEventAttributes?.failure ||
                    event.activityTaskScheduledEventAttributes
          }))
        };
        
        return {
          success: true,
          stepDetails,
          message: `Retrieved details for step: ${stepName}`
        };
        
      } catch (error: any) {
        console.error('Error getting step details:', error);
        return {
          success: false,
          error: error?.message || 'Unknown error',
          workflowId,
          stepName
        };
      }
    },
  });

// Helper functions
function mapTemporalStatus(status: string): WorkflowProgress['status'] {
  switch (status?.toLowerCase()) {
    case 'running':
    case 'started':
      return 'running';
    case 'completed':
    case 'finished':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'running';
  }
}

function getStepStatus(stepIndex: number, currentStepIndex: number, workflowStatus: string): WorkflowStep['status'] {
  if (workflowStatus === 'failed' && stepIndex === currentStepIndex) {
    return 'failed';
  }
  if (stepIndex < currentStepIndex) {
    return 'completed';
  }
  if (stepIndex === currentStepIndex && workflowStatus === 'running') {
    return 'running';
  }
  return 'pending';
}

function estimateRemainingTime(workflowType: string, completedSteps: number, totalSteps: number): number {
  // Rough estimates based on workflow type
  const baseTimes = {
    document_processing: 120, // 2 minutes
    semantic_search: 30 // 30 seconds
  };
  
  const baseTime = baseTimes[workflowType as keyof typeof baseTimes] || 60;
  const remainingSteps = totalSteps - completedSteps;
  const timePerStep = baseTime / totalSteps;
  
  return remainingSteps * timePerStep;
}