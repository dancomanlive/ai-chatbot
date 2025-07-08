// Test script for triggering workflows without authentication
const { triggerWorkflow } = require('./lib/temporal/client.ts');

async function testWorkflowTrigger() {
  try {
    const result = await triggerWorkflow({
      eventType: 'incident',
      source: 'monitoring',
      message: 'Test incident from direct API call',
      metadata: {
        priority: 'high',
        system: 'payment-service',
        test: true
      },
      chatId: 'test-direct-call',
      userId: 'test-user',
      timestamp: new Date().toISOString()
    });
    
    console.log('Workflow triggered successfully:', result);
    
  } catch (error) {
    console.error('Error triggering workflow:', error);
  }
}

testWorkflowTrigger();
