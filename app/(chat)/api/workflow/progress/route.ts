import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getWorkflowStatus, getTemporalClient } from '@/lib/temporal/client';
import type { WorkflowProgress, WorkflowStep } from '@/lib/types';

// Define workflow step mappings
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

    // Determine workflow type from workflowId
    const workflowType = workflowId.includes('document') ? 'document_processing' : 'semantic_search';
    const steps = WORKFLOW_STEPS[workflowType] || [];
    
    // Parse current progress from status
    const currentStepName = status.currentStep || status.step || 'unknown';
    const currentStepIndex = steps.findIndex(step => step.name === currentStepName);
    const completedSteps = currentStepIndex >= 0 ? currentStepIndex + (status.status === 'completed' ? 1 : 0) : 0;
    
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

    // Create step details
    const stepDetails: WorkflowStep[] = steps.map((step, index) => ({
      workflowId,
      stepName: step.name,
      stepIndex: index,
      status: getStepStatus(index, currentStepIndex, progress.status),
      details: {
        label: step.label,
        description: step.description
      }
    }));

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