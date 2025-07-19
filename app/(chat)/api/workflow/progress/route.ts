import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getWorkflowStatus } from '@/lib/temporal/client';
import { getTemporalClient } from '@/lib/temporal/client';
import { WorkflowProgress, WorkflowStep } from '@/lib/types';
import { 
  WORKFLOW_STEPS,
  createWorkflowProgress,
  createWorkflowSteps,
  determineWorkflowType
} from '@/lib/workflow/progress-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');
    
    if (!workflowId) {
      return NextResponse.json({ error: 'Workflow ID is required' }, { status: 400 });
    }

    // Get workflow status from Temporal
    const status = await getWorkflowStatus(workflowId);
    
    if (!status || status.status === 'unknown') {
      return NextResponse.json({ 
        error: 'Workflow not found or status unavailable',
        workflowId 
      }, { status: 404 });
    }

    // Create workflow progress using shared utility
    const progress = createWorkflowProgress(workflowId, status);
    
    // Determine workflow type and current step index
    const workflowType = determineWorkflowType(workflowId);
    const steps = WORKFLOW_STEPS[workflowType] || [];
    const currentStepName = status.currentStep || status.step || 'unknown';
    const currentStepIndex = steps.findIndex(step => step.name === currentStepName);
    
    // Create step details using shared utility
    const stepDetails = createWorkflowSteps(workflowId, workflowType, currentStepIndex, progress.status);

    return NextResponse.json({
      success: true,
      progress,
      steps: stepDetails,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('Error getting workflow progress:', error);
    return NextResponse.json({
      error: error?.message || 'Internal server error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { workflowId, stepName } = body;
    
    if (!workflowId || !stepName) {
      return NextResponse.json({ 
        error: 'Workflow ID and step name are required' 
      }, { status: 400 });
    }

    // Get detailed step information
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    
    try {
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
      
      return NextResponse.json({
        success: true,
        stepDetails,
        message: `Retrieved details for step: ${stepName}`
      });
      
    } catch (historyError) {
      // Fallback to basic step information
      return NextResponse.json({
        success: true,
        stepDetails: {
          stepName,
          workflowId,
          message: 'Step details not available in workflow history'
        }
      });
    }
    
  } catch (error: any) {
    console.error('Error getting step details:', error);
    return NextResponse.json({
      error: error?.message || 'Internal server error'
    }, { status: 500 });
  }
}