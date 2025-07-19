'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, Play, ChevronRight } from 'lucide-react';
import type { WorkflowProgress, WorkflowStep } from '@/lib/types';

interface WorkflowProgressProps {
  workflowId: string;
  initialProgress?: WorkflowProgress;
  initialSteps?: WorkflowStep[];
  onStepClick?: (step: WorkflowStep) => void;
  enablePolling?: boolean;
  pollInterval?: number;
}

export function WorkflowProgressComponent({
  workflowId,
  initialProgress,
  initialSteps = [],
  onStepClick,
  enablePolling = true,
  pollInterval = 2000
}: WorkflowProgressProps) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(initialProgress || null);
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Polling for live updates
  useEffect(() => {
    if (!enablePolling || !progress || progress.status !== 'running') {
      return;
    }

    setIsPolling(true);
    const interval = setInterval(async () => {
      try {
        // This would call the workflow progress API
        const response = await fetch(`/api/workflow/progress?workflowId=${workflowId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.progress) {
            setProgress(data.progress);
          }
          if (data.steps) {
            setSteps(data.steps);
          }
          
          // Stop polling if workflow is complete
          if (data.progress?.status !== 'running') {
            setIsPolling(false);
          }
        }
      } catch (error) {
        console.error('Error polling workflow progress:', error);
      }
    }, pollInterval);

    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [workflowId, enablePolling, pollInterval, progress?.status]);

  const handleStepClick = (step: WorkflowStep) => {
    setSelectedStep(step);
    onStepClick?.(step);
  };

  const getStepIcon = (status: WorkflowStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Play className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: WorkflowProgress['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'running':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'cancelled':
        return 'text-gray-600 bg-gray-50 border-gray-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${Math.round(remainingSeconds)}s`;
  };

  if (!progress) {
    return (
      <div className="p-4 border rounded-lg bg-gray-50">
        <div className="text-sm text-gray-600">Loading workflow progress...</div>
      </div>
    );
  }

  const progressPercentage = (progress.completedSteps / progress.totalSteps) * 100;

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">
            {progress.workflowType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Workflow
          </h3>
          <p className="text-sm text-gray-600">ID: {workflowId}</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(progress.status)}`}>
          {progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}
          {isPolling && progress.status === 'running' && (
            <span className="ml-2 inline-block w-2 h-2 bg-current rounded-full animate-pulse" />
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">
            Step {progress.completedSteps} of {progress.totalSteps}
          </span>
          <span className="text-gray-600">
            {Math.round(progressPercentage)}% complete
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        {progress.estimatedDuration && progress.status === 'running' && (
          <div className="text-xs text-gray-500">
            Estimated time remaining: {formatDuration(progress.estimatedDuration)}
          </div>
        )}
      </div>

      {/* Steps List */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">Workflow Steps</h4>
        <div className="space-y-1">
          {steps.map((step, index) => (
            <button
              key={`${step.stepName}-${index}`}
              onClick={() => handleStepClick(step)}
              className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                selectedStep?.stepName === step.stepName
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center space-x-3">
                {getStepIcon(step.status)}
                <div className="text-left">
                  <div className="font-medium text-sm text-gray-900">
                    {step.details?.label || step.stepName}
                  </div>
                  <div className="text-xs text-gray-600">
                    {step.details?.description || `Step ${step.stepIndex + 1}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {step.duration && (
                  <span className="text-xs text-gray-500">
                    {formatDuration(step.duration)}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Step Details Panel */}
      {selectedStep && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
          <h5 className="font-medium text-gray-900 mb-2">
            {selectedStep.details?.label || selectedStep.stepName} Details
          </h5>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Status:</span>
              <span className={`font-medium ${
                selectedStep.status === 'completed' ? 'text-green-600' :
                selectedStep.status === 'running' ? 'text-blue-600' :
                selectedStep.status === 'failed' ? 'text-red-600' :
                'text-gray-600'
              }`}>
                {selectedStep.status.charAt(0).toUpperCase() + selectedStep.status.slice(1)}
              </span>
            </div>
            {selectedStep.startTime && (
              <div className="flex justify-between">
                <span className="text-gray-600">Started:</span>
                <span className="text-gray-900">
                  {new Date(selectedStep.startTime).toLocaleTimeString()}
                </span>
              </div>
            )}
            {selectedStep.endTime && (
              <div className="flex justify-between">
                <span className="text-gray-600">Completed:</span>
                <span className="text-gray-900">
                  {new Date(selectedStep.endTime).toLocaleTimeString()}
                </span>
              </div>
            )}
            {selectedStep.duration && (
              <div className="flex justify-between">
                <span className="text-gray-600">Duration:</span>
                <span className="text-gray-900">
                  {formatDuration(selectedStep.duration)}
                </span>
              </div>
            )}
            {selectedStep.error && (
              <div className="mt-2">
                <span className="text-red-600 font-medium">Error:</span>
                <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
                  {selectedStep.error}
                </div>
              </div>
            )}
            {selectedStep.result && (
              <div className="mt-2">
                <span className="text-gray-600 font-medium">Result:</span>
                <div className="mt-1 p-2 bg-green-50 border border-green-200 rounded text-green-700 text-xs">
                  <pre className="whitespace-pre-wrap">
                    {typeof selectedStep.result === 'string' 
                      ? selectedStep.result 
                      : JSON.stringify(selectedStep.result, null, 2)
                    }
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkflowProgressComponent;