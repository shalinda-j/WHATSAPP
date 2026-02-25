import type { Node, Edge } from 'reactflow';
import { INTEGRATIONS } from '../config/integrationPresets';

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  startTime: Date;
  variables: Record<string, any>;
  logs: ExecutionLog[];
  status: 'running' | 'completed' | 'failed' | 'paused';
  nodeId?: string;
}

export interface ExecutionLog {
  timestamp: Date;
  nodeId: string;
  nodeType: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  data?: any;
}

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  duration: number;
  logs: ExecutionLog[];
  output?: any;
  error?: string;
}

export interface WorkflowStep {
  nodeId: string;
  nodeType: string;
  integrationType?: string;
  config: Record<string, any>;
  execute: (context: ExecutionContext) => Promise<StepResult>;
}

export interface StepResult {
  success: boolean;
  output?: any;
  error?: string;
  nextNodes?: string[];
}

class WorkflowExecutionEngine {
  private executions: Map<string, ExecutionContext> = new Map();
  private stepHandlers: Map<string, WorkflowStep> = new Map();

  constructor() {
    this.initializeStepHandlers();
  }

  // Initialize step handlers for different node types
  private initializeStepHandlers(): void {
    // WhatsApp Trigger Handler
    this.stepHandlers.set('whatsapp_trigger', {
      nodeId: '',
      nodeType: 'whatsapp_trigger',
      config: {},
      execute: async (context) => {
        this.log(context, 'info', 'WhatsApp trigger activated', context.nodeId);

        // Simulate WhatsApp trigger
        await this.delay(1000);

        return {
          success: true,
          output: {
            message: 'New WhatsApp message received',
            sender: '+1234567890',
            timestamp: new Date().toISOString()
          }
        };
      }
    });

    // AI Processing Handler
    this.stepHandlers.set('ai_processing', {
      nodeId: '',
      nodeType: 'ai_processing',
      config: {},
      execute: async (context) => {
        this.log(context, 'info', 'Processing with AI', context.nodeId);

        const input = context.variables.lastMessage || 'Hello';

        try {
          // Call AI API
          const response = await this.callAIAPI(input);

          return {
            success: true,
            output: {
              response: response,
              confidence: 0.95
            }
          };
        } catch (error) {
          this.log(context, 'error', `AI processing failed: ${error}`, context.nodeId);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    });

    // Send WhatsApp Handler
    this.stepHandlers.set('send_whatsapp', {
      nodeId: '',
      nodeType: 'send_whatsapp',
      config: {},
      execute: async (context) => {
        this.log(context, 'info', 'Sending WhatsApp message', context.nodeId);

        const message = context.variables.aiResponse || 'Hello from workflow!';
        const recipient = context.variables.recipient || '+1234567890';

        try {
          // Call WhatsApp API
          await this.sendWhatsAppMessage(recipient, message);

          return {
            success: true,
            output: {
              messageId: `msg_${Date.now()}`,
              status: 'sent'
            }
          };
        } catch (error) {
          this.log(context, 'error', `Failed to send WhatsApp message: ${error}`, context.nodeId);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    });

    // Decision Logic Handler
    this.stepHandlers.set('decision_logic', {
      nodeId: '',
      nodeType: 'decision_logic',
      config: {},
      execute: async (context) => {
        this.log(context, 'info', 'Evaluating decision logic', context.nodeId);

        const condition = context.variables.condition || 'true';
        const result = this.evaluateCondition(condition, context.variables);

        return {
          success: true,
          output: {
            result,
            condition,
            nextPath: result ? 'yes' : 'no'
          }
        };
      }
    });

    // Integration Handlers
    Object.keys(INTEGRATIONS).forEach(integrationId => {
      const integration = INTEGRATIONS[integrationId];

      this.stepHandlers.set(integrationId, {
        nodeId: '',
        nodeType: 'integration',
        integrationType: integrationId,
        config: {},
        execute: async (context) => {
          this.log(context, 'info', `Executing ${integration.label} integration`, context.nodeId);

          try {
            const result = await this.executeIntegration(integrationId, context);
            return {
              success: true,
              output: result
            };
          } catch (error) {
            this.log(context, 'error', `${integration.label} integration failed: ${error}`, context.nodeId);
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        }
      });
    });
  }

  // Main execution method
  async executeWorkflow(
    nodes: Node[],
    edges: Edge[],
    startNodeId?: string
  ): Promise<ExecutionResult> {
    const executionId = this.generateExecutionId();
    const startTime = new Date();

    const context: ExecutionContext = {
      workflowId: 'current_workflow',
      executionId,
      startTime,
      variables: {},
      logs: [],
      status: 'running'
    };

    this.executions.set(executionId, context);

    try {
      // Find starting node
      const startNode = startNodeId
        ? nodes.find(n => n.id === startNodeId)
        : nodes.find(n => n.type === 'input');

      if (!startNode) {
        throw new Error('No starting node found');
      }

      // Execute workflow
      const result = await this.executeNode(startNode, nodes, edges, context);

      // Update context
      context.status = result.success ? 'completed' : 'failed';

      const duration = Date.now() - startTime.getTime();

      return {
        success: result.success,
        executionId,
        duration,
        logs: context.logs,
        output: result.output,
        error: result.error
      };

    } catch (error) {
      context.status = 'failed';
      this.log(context, 'error', `Workflow execution failed: ${error}`, 'workflow');

      const duration = Date.now() - startTime.getTime();

      return {
        success: false,
        executionId,
        duration,
        logs: context.logs,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      // Clean up execution context after 1 hour
      setTimeout(() => {
        this.executions.delete(executionId);
      }, 3600000);
    }
  }

  // Execute individual node
  private async executeNode(
    node: Node,
    allNodes: Node[],
    allEdges: Edge[],
    context: ExecutionContext
  ): Promise<StepResult> {
    this.log(context, 'info', `Executing node: ${node.data.label}`, node.id);

    // Update context with node ID for logging
    const nodeContext = { ...context, nodeId: node.id };

    // Get step handler
    const stepHandler = this.getStepHandler(node);
    if (!stepHandler) {
      throw new Error(`No handler found for node type: ${node.type}`);
    }

    try {
      // Execute the step
      const result = await stepHandler.execute(nodeContext);

      if (result.success) {
        this.log(nodeContext, 'info', `Node execution completed successfully`, node.id);

        // Store output in context variables
        if (result.output) {
          context.variables[`node_${node.id}_output`] = result.output;
          context.variables.lastOutput = result.output;
        }

        // Execute next nodes
        const nextNodes = this.getNextNodes(node, allEdges);
        for (const nextNode of nextNodes) {
          await this.executeNode(nextNode, allNodes, allEdges, context);
        }
      } else {
        this.log(nodeContext, 'error', `Node execution failed: ${result.error}`, node.id);
      }

      return result;

    } catch (error) {
      this.log(nodeContext, 'error', `Node execution error: ${error}`, node.id);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Get appropriate step handler for a node
  private getStepHandler(node: Node): WorkflowStep | null {
    // Check for specific handlers first
    if (node.data.label?.toLowerCase().includes('whatsapp trigger')) {
      return this.stepHandlers.get('whatsapp_trigger') || null;
    }
    if (node.data.label?.toLowerCase().includes('ai processing')) {
      return this.stepHandlers.get('ai_processing') || null;
    }
    if (node.data.label?.toLowerCase().includes('send whatsapp')) {
      return this.stepHandlers.get('send_whatsapp') || null;
    }
    if (node.data.label?.toLowerCase().includes('decision')) {
      return this.stepHandlers.get('decision_logic') || null;
    }

    // Check for integration handlers
    if (node.data.integrationType) {
      return this.stepHandlers.get(node.data.integrationType) || null;
    }

    return null;
  }

  // Get next nodes in the workflow
  private getNextNodes(node: Node, edges: Edge[]): Node[] {
    const outgoingEdges = edges.filter(edge => edge.source === node.id);
    return outgoingEdges.map(edge => ({
      id: edge.target,
      type: 'default',
      data: { label: `Node ${edge.target}` },
      position: { x: 0, y: 0 }
    }));
  }

  // API simulation methods
  private async callAIAPI(_input: string): Promise<string> {
    // Simulate AI API call
    await this.delay(2000);

    // Mock AI response
    const responses = [
      "Hello! How can I help you today?",
      "Thank you for your message. I'll assist you shortly.",
      "I understand your request. Let me help you with that.",
      "Great question! Here's what I can tell you..."
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  private async sendWhatsAppMessage(recipient: string, message: string): Promise<void> {
    // Simulate WhatsApp API call
    await this.delay(1500);

    console.log(`WhatsApp message sent to ${recipient}: ${message}`);
  }

  private async executeIntegration(integrationId: string, _context: ExecutionContext): Promise<any> {
    const integration = INTEGRATIONS[integrationId];
    if (!integration) {
      throw new Error(`Unknown integration: ${integrationId}`);
    }

    // Simulate integration execution
    await this.delay(1000);

    return {
      integration: integration.label,
      status: 'success',
      timestamp: new Date().toISOString()
    };
  }

  // Utility methods
  private evaluateCondition(condition: string, variables: Record<string, any>): boolean {
    try {
      // Simple condition evaluation (in production, use a proper expression parser)
      if (condition === 'true') return true;
      if (condition === 'false') return false;

      // Replace variables in condition
      let evalCondition = condition;
      Object.keys(variables).forEach(key => {
        evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\b`, 'g'), JSON.stringify(variables[key]));
      });

      return Boolean(eval(evalCondition));
    } catch {
      return true; // Default to true if evaluation fails
    }
  }

  private log(context: ExecutionContext, level: 'info' | 'warning' | 'error', message: string, nodeId: string = 'system'): void {
    const log: ExecutionLog = {
      timestamp: new Date(),
      nodeId,
      nodeType: nodeId === 'system' ? 'system' : 'node',
      level,
      message
    };

    context.logs.push(log);
    console.log(`[${level.toUpperCase()}] ${message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public methods for execution management
  getExecution(executionId: string): ExecutionContext | undefined {
    return this.executions.get(executionId);
  }

  pauseExecution(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.status = 'paused';
    }
  }

  resumeExecution(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution && execution.status === 'paused') {
      execution.status = 'running';
    }
  }

  stopExecution(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.status = 'failed';
      this.log(execution, 'info', 'Execution stopped by user', 'system');
    }
  }

  // Get execution logs
  getExecutionLogs(executionId: string): ExecutionLog[] {
    const execution = this.executions.get(executionId);
    return execution ? execution.logs : [];
  }
}

export const workflowExecution = new WorkflowExecutionEngine();
