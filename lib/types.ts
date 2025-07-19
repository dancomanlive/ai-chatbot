import { z } from 'zod';
import type { getWeather } from './ai/tools/get-weather';
import type { createDocument } from './ai/tools/create-document';
import type { updateDocument } from './ai/tools/update-document';
import type { requestSuggestions } from './ai/tools/request-suggestions';
import type { triggerWorkflow, checkWorkflowStatus } from './ai/tools/trigger-workflow';
import type { InferUITool, UIMessage } from 'ai';

import type { ArtifactKind } from '@/components/artifact';
import type { Suggestion } from './db/schema';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type triggerWorkflowTool = InferUITool<ReturnType<typeof triggerWorkflow>>;
type checkWorkflowStatusTool = InferUITool<ReturnType<typeof checkWorkflowStatus>>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  triggerWorkflow: triggerWorkflowTool;
  checkWorkflowStatus: checkWorkflowStatusTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  workflowProgress: WorkflowProgress;
  workflowStep: WorkflowStep;
  workflowComplete: WorkflowResult;
};

export interface WorkflowProgress {
  workflowId: string;
  workflowType: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: string;
  totalSteps: number;
  completedSteps: number;
  startTime: string;
  estimatedDuration?: number;
}

export interface WorkflowStep {
  workflowId: string;
  stepName: string;
  stepIndex: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
  duration?: number;
  result?: any;
  error?: string;
  details?: Record<string, any>;
}

export interface WorkflowResult {
  workflowId: string;
  workflowType: string;
  status: 'completed' | 'failed';
  result?: any;
  error?: string;
  totalDuration: number;
  steps: WorkflowStep[];
}

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
}
