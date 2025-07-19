// Workflow progress tracking tool for real-time updates
import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { getWorkflowStatus, getTemporalClient } from '@/lib/temporal/client';
import type { WorkflowProgress, WorkflowStep } from '@/lib/types';
import {
  WORKFLOW_STEPS,
  createWorkflowProgress,
  createWorkflowSteps,
  determineWorkflowType
} from '@/lib/workflow/progress-utils';

interface WorkflowProgressToolProps {
  session: Session;
  dataStream: any;
}

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

        // Create workflow progress using shared utility
        const progress = createWorkflowProgress(workflowId, status);
        
        // Determine workflow type and current step index for streaming
        const workflowType = determineWorkflowType(workflowId);
        const steps = WORKFLOW_STEPS[workflowType] || [];
        const currentStepName = status.currentStep || status.step || 'unknown';
        const currentStepIndex = steps.findIndex(step => step.name === currentStepName);

        // Stream progress data to UI
        if (dataStream) {
          dataStream.writeData({
            type: 'workflowProgress',
            workflowId,
            progress
          });
          
          // Stream step details using shared utility
          const stepDetails = createWorkflowSteps(workflowId, workflowType, currentStepIndex, progress.status);
          stepDetails.forEach((step) => {
            dataStream.writeData({
              type: 'workflowStep',
              workflowId,
              step
            });
          });
        }

        // Create step details using shared utility
        const stepDetails = createWorkflowSteps(workflowId, workflowType, currentStepIndex, progress.status);

        // If live updates are enabled, start progress monitoring
        if (enableLiveUpdates && progress.status === 'running') {
          return {
            success: true,
            progress,
            steps: stepDetails,
            message: `Workflow ${workflowId} is ${progress.status}. Currently on step: ${currentStepName}`,
            shouldPoll: true,
            pollInterval: 2000 // Poll every 2 seconds
          };
        }

        return {
          success: true,
          progress,
          steps: stepDetails,
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