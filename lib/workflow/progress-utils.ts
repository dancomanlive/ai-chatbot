import { WorkflowProgress, WorkflowStep } from '@/lib/types';

// Workflow step definitions
export const WORKFLOW_STEPS = {
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

// Helper function to map Temporal status to our workflow status
export function mapTemporalStatus(status: string): WorkflowProgress['status'] {
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

// Helper function to determine step status
export function getStepStatus(
  stepIndex: number, 
  currentStepIndex: number, 
  workflowStatus: string
): WorkflowStep['status'] {
  // If workflow is completed, all steps should be marked as completed
  if (workflowStatus === 'completed') {
    return 'completed';
  }
  
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

// Helper function to estimate remaining time
export function estimateRemainingTime(
  workflowType: string, 
  completedSteps: number, 
  totalSteps: number
): number {
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

// Helper function to determine workflow type from workflowId
export function determineWorkflowType(workflowId: string): keyof typeof WORKFLOW_STEPS {
  if (workflowId.includes('document')) {
    return 'document_processing';
  }
  return 'semantic_search';
}

// Helper function to calculate completed steps
export function calculateCompletedSteps(
  currentStepIndex: number,
  workflowStatus: string,
  totalSteps: number
): number {
  if (workflowStatus === 'completed') {
    return totalSteps;
  }
  return currentStepIndex >= 0 ? currentStepIndex : 0;
}

// Main function to create workflow progress object
export function createWorkflowProgress(
  workflowId: string,
  status: any,
  startTime?: string
): WorkflowProgress {
  const workflowType = determineWorkflowType(workflowId);
  const steps = WORKFLOW_STEPS[workflowType] || [];
  const currentStepName = status.currentStep || status.step || 'unknown';
  const currentStepIndex = steps.findIndex(step => step.name === currentStepName);
  const mappedStatus = mapTemporalStatus(status.status);
  const completedSteps = calculateCompletedSteps(currentStepIndex, mappedStatus, steps.length);

  return {
    workflowId,
    workflowType,
    status: mappedStatus,
    currentStep: currentStepName,
    totalSteps: steps.length,
    completedSteps,
    startTime: startTime || status.startTime || new Date().toISOString(),
    estimatedDuration: estimateRemainingTime(workflowType, completedSteps, steps.length)
  };
}

// Main function to create workflow step details
export function createWorkflowSteps(
  workflowId: string,
  workflowType: keyof typeof WORKFLOW_STEPS,
  currentStepIndex: number,
  workflowStatus: string
): WorkflowStep[] {
  const steps = WORKFLOW_STEPS[workflowType] || [];
  
  return steps.map((step, index) => ({
    workflowId,
    stepName: step.name,
    stepIndex: index,
    status: getStepStatus(index, currentStepIndex, workflowStatus),
    details: {
      label: step.label,
      description: step.description
    }
  }));
}