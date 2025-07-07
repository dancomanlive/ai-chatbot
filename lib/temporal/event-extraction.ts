// AI-powered event extraction from natural language
import { generateObject } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { z } from 'zod';

/**
 * Schema for extracted events
 */
const EventExtractionSchema = z.object({
  isWorkflowEvent: z.boolean().describe('Whether this message should trigger a workflow'),
  eventType: z.string().optional().describe('Type of event: incident, document-added, document-uploaded, data-processing'),
  source: z.string().optional().describe('Source system: s3, azure-blob, sharepoint, monitoring, user'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority level'),
  metadata: z.record(z.any()).optional().describe('Additional structured data extracted from the message'),
  reasoning: z.string().describe('Explanation of why this is or is not a workflow event'),
});

type ExtractedEvent = z.infer<typeof EventExtractionSchema>;

/**
 * Extract structured event data from natural language user input
 */
export async function extractEventFromMessage(
  userMessage: string,
  chatContext?: string[]
): Promise<ExtractedEvent> {
  try {
    const { object } = await generateObject({
      model: myProvider.languageModel('chat-model'),
      schema: EventExtractionSchema,
      prompt: `
You are an AI assistant that determines if user messages should trigger Temporal workflows.

WORKFLOW EVENT TYPES:
- "incident": System failures, outages, alerts, problems that need investigation
- "document-added" or "document-uploaded": New files, documents, reports to be processed  
- "data-processing": Data analysis, ETL jobs, batch processing requests

SOURCES:
- "s3": Amazon S3 storage
- "azure-blob": Azure blob storage  
- "sharepoint": SharePoint documents
- "monitoring": System monitoring alerts
- "user": Direct user requests

EXAMPLES OF WORKFLOW EVENTS:
- "We have a critical system outage" → incident, monitoring, critical
- "Process the document at s3://bucket/file.pdf" → document-added, s3
- "New report uploaded to SharePoint needs analysis" → document-uploaded, sharepoint  
- "Run the daily data pipeline" → data-processing, user

EXAMPLES OF NON-WORKFLOW EVENTS:
- "Hello, how are you?" → General chat
- "What's the weather like?" → Information request
- "Explain how Temporal works" → Educational question

Chat context: ${chatContext?.join('\n') || 'No previous context'}

User message: "${userMessage}"

Analyze this message and extract workflow event information if applicable.
`,
    });

    return object;
  } catch (error) {
    console.error('Error extracting event from message:', error);
    return {
      isWorkflowEvent: false,
      reasoning: 'Error occurred during event extraction'
    };
  }
}

/**
 * Convert extracted event to Temporal event payload
 */
export function createTemporalEvent(
  extractedEvent: ExtractedEvent,
  userMessage: string,
  chatId: string,
  userId?: string
) {
  if (!extractedEvent.isWorkflowEvent) {
    return null;
  }

  return {
    eventType: extractedEvent.eventType!,
    source: extractedEvent.source || 'user',
    message: userMessage,
    metadata: {
      ...extractedEvent.metadata,
      priority: extractedEvent.priority,
      originalMessage: userMessage,
      reasoning: extractedEvent.reasoning,
    },
    chatId,
    userId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Simplified workflow event detection (for faster responses)
 */
export function detectWorkflowKeywords(message: string): boolean {
  const workflowKeywords = [
    'incident', 'outage', 'failure', 'down', 'error',
    'process', 'document', 'file', 's3://', 'upload',
    'analyze', 'pipeline', 'workflow', 'run', 'execute',
    'critical', 'urgent', 'alert', 'monitor'
  ];
  
  const lowerMessage = message.toLowerCase();
  return workflowKeywords.some(keyword => lowerMessage.includes(keyword));
}
