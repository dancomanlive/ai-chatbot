'use client';

import React, { useState, useEffect } from 'react';
import { WorkflowProgressComponent } from './workflow-progress';
import type { WorkflowProgress, WorkflowStep } from '@/lib/types';
import { Button } from './ui/button';
import { RefreshCw, ExternalLink } from 'lucide-react';

interface WorkflowMessageProps {
  workflowId: string;
  workflowType: string;
  message: string;
  enableProgressTracking?: boolean;
  isReadonly?: boolean;
}

export function WorkflowMessage({
  workflowId,
  workflowType,
  message,
  enableProgressTracking = true,
  isReadonly = false
}: WorkflowMessageProps) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [stepDetails, setStepDetails] = useState<any>(null);

  // Load initial progress
  useEffect(() => {
    if (enableProgressTracking && workflowId) {
      loadProgress();
    }
  }, [workflowId, enableProgressTracking]);

  const loadProgress = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/workflow/progress?workflowId=${workflowId}`);
      if (!response.ok) {
        throw new Error('Failed to load workflow progress');
      }
      
      const data = await response.json();
      if (data.success) {
        setProgress(data.progress);
        setSteps(data.steps || []);
      } else {
        setError(data.error || 'Unknown error');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load progress');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStepClick = async (step: WorkflowStep) => {
    setSelectedStep(step);
    
    try {
      const response = await fetch('/api/workflow/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          stepName: step.stepName
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setStepDetails(data.stepDetails);
      }
    } catch (err) {
      console.error('Error loading step details:', err);
    }
  };

  const handleRefresh = () => {
    loadProgress();
  };

  return (
    <div className="space-y-4">
      {/* Workflow Message */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-blue-900">{message}</p>
            <div className="mt-2 flex items-center space-x-4 text-sm text-blue-700">
              <span>Workflow ID: <code className="bg-blue-100 px-1 rounded">{workflowId}</code></span>
              <span>Type: {workflowType.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
              className="text-blue-700 border-blue-300 hover:bg-blue-100"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Progress Tracking */}
      {enableProgressTracking && (
        <div>
          {isLoading && !progress ? (
            <div className="p-4 border rounded-lg bg-gray-50">
              <div className="flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="text-sm text-gray-600">Loading workflow progress...</span>
              </div>
            </div>
          ) : error ? (
            <div className="p-4 border border-red-200 rounded-lg bg-red-50">
              <div className="text-sm text-red-600">
                Error loading progress: {error}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="mt-2 text-red-700 border-red-300 hover:bg-red-100"
              >
                Retry
              </Button>
            </div>
          ) : progress ? (
            <WorkflowProgressComponent
              workflowId={workflowId}
              initialProgress={progress}
              initialSteps={steps}
              onStepClick={handleStepClick}
              enablePolling={progress.status === 'running'}
              pollInterval={2000}
            />
          ) : null}
        </div>
      )}

      {/* Step Details Modal/Panel */}
      {selectedStep && stepDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                  {selectedStep.details?.label || selectedStep.stepName} Details
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedStep(null);
                    setStepDetails(null);
                  }}
                >
                  ×
                </Button>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">Step:</span>
                    <div className="text-gray-900">{selectedStep.stepName}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Status:</span>
                    <div className={`font-medium ${
                      selectedStep.status === 'completed' ? 'text-green-600' :
                      selectedStep.status === 'running' ? 'text-blue-600' :
                      selectedStep.status === 'failed' ? 'text-red-600' :
                      'text-gray-600'
                    }`}>
                      {selectedStep.status.charAt(0).toUpperCase() + selectedStep.status.slice(1)}
                    </div>
                  </div>
                </div>
                
                {stepDetails.events && (
                  <div>
                    <span className="font-medium text-gray-600">Events:</span>
                    <div className="text-gray-900">{stepDetails.events} workflow events</div>
                  </div>
                )}
                
                {stepDetails.details && stepDetails.details.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-600">Event Details:</span>
                    <div className="mt-2 space-y-2">
                      {stepDetails.details.map((detail: any, index: number) => (
                        <div key={index} className="p-3 bg-gray-50 rounded border">
                          <div className="text-sm font-medium text-gray-700">
                            {detail.eventType}
                          </div>
                          {detail.timestamp && (
                            <div className="text-xs text-gray-500 mt-1">
                              {new Date(detail.timestamp).toLocaleString()}
                            </div>
                          )}
                          {detail.details && (
                            <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
                              {typeof detail.details === 'string' 
                                ? detail.details 
                                : JSON.stringify(detail.details, null, 2)
                              }
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkflowMessage;