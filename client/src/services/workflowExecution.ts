import type { Node, Edge } from 'reactflow';
import { INTEGRATIONS } from '../config/integrationPresets';

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  startTime: Date;
  variables: Record<string, unknown>;
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
  data?: unknown;
}

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  duration: number;
  logs: ExecutionLog[];
  output?: unknown;
  error?: string;
}

export interface WorkflowStep {
  nodeId: string;
  nodeType: string;
  integrationType?: string;
  config: Record<string, unknown>;
  execute: (context: ExecutionContext) => Promise<StepResult>;
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  nextNodes?: string[];
}

const API_BASE = '/api';

class WorkflowExecutionEngine {
  private executions: Map<string, ExecutionContext> = new Map();

  // Main execution method - now calls backend API
  async executeWorkflow(
    nodes: Node[],
    edges: Edge[],
    startNodeId?: string,
  ): Promise<ExecutionResult> {
    const executionId = this.generateExecutionId();
    const startTime = new Date();

    const context: ExecutionContext = {
      workflowId: 'current_workflow',
      executionId,
      startTime,
      variables: {},
      logs: [],
      status: 'running',
    };

    this.executions.set(executionId, context);

    try {
      // Find starting node
      const startNode = startNodeId
        ? nodes.find((n) => n.id === startNodeId)
        : nodes.find((n) => n.type === 'input');

      if (!startNode) {
        throw new Error('No starting node found');
      }

      // Try to execute via backend API first
      try {
        // FIX H7: Raw fetch() was missing the Authorization header — all
        // workflow execution calls were returning 401 Unauthorized silently.
        const token = localStorage.getItem('token') || '';
        const response = await fetch(`${API_BASE}/workflows/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            nodes,
            edges,
            triggerData: {
              message: 'Manual trigger from Marketing Workflow Builder',
              timestamp: new Date().toISOString(),
            },
          }),
        });

        if (response.ok) {
          const result = await response.json();
          return {
            success: result.success,
            executionId: result.executionId,
            duration: result.duration,
            logs: result.logs,
            output: result.output,
          };
        }
      } catch (apiError) {
        console.warn(
          'Backend API not available, falling back to local execution:',
          apiError,
        );
      }

      // Fallback to local execution
      const result = await this.executeLocally(nodes, edges, context);

      context.status = result.success ? 'completed' : 'failed';

      const duration = Date.now() - startTime.getTime();

      return {
        success: result.success,
        executionId,
        duration,
        logs: context.logs,
        output: result.output,
        error: result.error,
      };
    } catch (error) {
      context.status = 'failed';
      this.log(
        context,
        'error',
        `Workflow execution failed: ${error}`,
        'workflow',
      );

      const duration = Date.now() - startTime.getTime();

      return {
        success: false,
        executionId,
        duration,
        logs: context.logs,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      // Clean up execution context after 1 hour
      setTimeout(() => {
        this.executions.delete(executionId);
      }, 3600000);
    }
  }

  // Local execution fallback (for development/offline)
  private async executeLocally(
    nodes: Node[],
    edges: Edge[],
    context: ExecutionContext,
  ): Promise<StepResult> {
    // Find starting node
    const startNode = nodes.find((n) => n.type === 'input');
    if (!startNode) {
      throw new Error('No starting node found');
    }

    // Execute workflow starting from the input node
    const result = await this.executeNode(startNode, nodes, edges, context);
    return result;
  }

  // Execute individual node
  private async executeNode(
    node: Node,
    allNodes: Node[],
    allEdges: Edge[],
    context: ExecutionContext,
  ): Promise<StepResult> {
    this.log(context, 'info', `Executing node: ${node.data.label}`, node.id);

    // Update context with node ID for logging
    const nodeContext = { ...context, nodeId: node.id };

    try {
      // Get step handler
      const stepHandler = this.getStepHandler(node);
      let result: StepResult;

      if (stepHandler) {
        result = await stepHandler.execute(nodeContext);
      } else {
        // Default handler for unknown node types
        result = {
          success: true,
          output: { processed: true, nodeType: node.type },
        };
      }

      if (result.success) {
        this.log(
          nodeContext,
          'info',
          `Node execution completed successfully`,
          node.id,
        );

        // Store output in context variables
        if (result.output) {
          context.variables[`node_${node.id}_output`] = result.output;
          context.variables.lastOutput = result.output;
        }

        // Execute next nodes
        const nextNodes = this.getNextNodes(node, allEdges, allNodes);
        for (const nextNode of nextNodes) {
          await this.executeNode(nextNode, allNodes, allEdges, context);
        }
      } else {
        this.log(
          nodeContext,
          'error',
          `Node execution failed: ${result.error}`,
          node.id,
        );
      }

      return result;
    } catch (error) {
      this.log(nodeContext, 'error', `Node execution error: ${error}`, node.id);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Get appropriate step handler for a node
  private getStepHandler(node: Node): WorkflowStep | null {
    const nodeLabel = (node.data.label || '').toLowerCase();

    // WhatsApp Trigger Handler
    if (nodeLabel.includes('whatsapp trigger') || nodeLabel.includes('start')) {
      return {
        nodeId: node.id,
        nodeType: 'whatsapp_trigger',
        config: {},
        execute: async (context) => {
          this.log(
            context,
            'info',
            'Workflow trigger activated',
            context.nodeId || '',
          );
          await this.delay(500);
          return {
            success: true,
            output: {
              message: 'Workflow triggered successfully',
              timestamp: new Date().toISOString(),
            },
          };
        },
      };
    }

    // AI Processing Handler - Now calls real API
    if (nodeLabel.includes('ai processing') || nodeLabel.includes('ai')) {
      return {
        nodeId: node.id,
        nodeType: 'ai_processing',
        config: {},
        execute: async (context) => {
          this.log(context, 'info', 'Processing with AI', context.nodeId || '');

          const lastOutput = context.variables.lastOutput as
            | Record<string, unknown>
            | undefined;
          const input =
            context.variables.lastMessage || lastOutput?.message || 'Hello';

          try {
            // Call real AI API. Use the authenticated /marketing/chat endpoint
            // ({message} → {response}); the old `/chat` had no POST '/' route
            // and was auth-gated, so this fetch silently 401/404'd and the node
            // always fell back to the simulated canned response. Attach the
            // bearer token like the sibling /workflows/execute call (FIX H7).
            const token = localStorage.getItem('token') || '';
            const response = await fetch(`${API_BASE}/marketing/chat`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ message: input }),
            });

            if (response.ok) {
              const data = await response.json();
              return {
                success: true,
                output: {
                  response: data.response || data.message,
                  confidence: 0.95,
                },
              };
            }

            // Fallback response
            return {
              success: true,
              output: {
                response: 'AI processing completed (simulated)',
                confidence: 0.8,
              },
            };
          } catch (error) {
            this.log(
              context,
              'error',
              `AI processing failed: ${error}`,
              context.nodeId || '',
            );
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        },
      };
    }

    // Send WhatsApp Handler - Would connect to real WhatsApp in production
    if (
      nodeLabel.includes('send whatsapp') ||
      nodeLabel.includes('send reply')
    ) {
      return {
        nodeId: node.id,
        nodeType: 'send_whatsapp',
        config: {},
        execute: async (context) => {
          this.log(
            context,
            'info',
            'Sending WhatsApp message',
            context.nodeId || '',
          );

          const lastOutput = context.variables.lastOutput as
            | Record<string, unknown>
            | undefined;
          const rawMessage =
            context.variables.aiResponse ||
            lastOutput?.response ||
            'Hello from workflow!';
          const message =
            typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
          const recipient =
            context.variables.recipient || node.data.phoneNumberId || 'default';

          try {
            // In production, this would call the WhatsApp API
            // For now, we simulate the send
            await this.delay(1000);

            this.log(
              context,
              'info',
              `Message would be sent to ${recipient}: ${message.substring(
                0,
                50,
              )}...`,
              context.nodeId || '',
            );

            return {
              success: true,
              output: {
                messageId: `msg_${Date.now()}`,
                status: 'sent',
                recipient,
              },
            };
          } catch (error) {
            this.log(
              context,
              'error',
              `Failed to send WhatsApp message: ${error}`,
              context.nodeId || '',
            );
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        },
      };
    }

    // Decision Logic Handler
    if (nodeLabel.includes('decision')) {
      return {
        nodeId: node.id,
        nodeType: 'decision_logic',
        config: {},
        execute: async (context) => {
          this.log(
            context,
            'info',
            'Evaluating decision logic',
            context.nodeId || '',
          );

          const condition = node.data.condition || 'true';
          const result = this.evaluateCondition(condition, context.variables);

          return {
            success: true,
            output: {
              result,
              condition,
              nextPath: result ? 'yes' : 'no',
            },
          };
        },
      };
    }

    // Integration Handlers
    if (node.data.integrationType) {
      const integration = INTEGRATIONS[node.data.integrationType];
      if (integration) {
        return {
          nodeId: node.id,
          nodeType: 'integration',
          integrationType: node.data.integrationType,
          config: {},
          execute: async (context) => {
            this.log(
              context,
              'info',
              `Executing ${integration.label} integration`,
              context.nodeId || '',
            );

            try {
              // Simulate integration execution
              await this.delay(1000);

              return {
                success: true,
                output: {
                  integration: integration.label,
                  status: 'success',
                  timestamp: new Date().toISOString(),
                },
              };
            } catch (error) {
              this.log(
                context,
                'error',
                `${integration.label} integration failed: ${error}`,
                context.nodeId || '',
              );
              return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        };
      }
    }

    return null;
  }

  // Get next nodes in the workflow
  private getNextNodes(node: Node, edges: Edge[], allNodes: Node[]): Node[] {
    const outgoingEdges = edges.filter((edge) => edge.source === node.id);
    return outgoingEdges
      .map((edge) => allNodes.find((n) => n.id === edge.target))
      .filter((n): n is Node => n !== undefined);
  }

  // Utility methods
  private evaluateCondition(
    condition: string,
    _variables: Record<string, unknown>,
  ): boolean {
    try {
      if (condition === 'true') return true;
      if (condition === 'false') return false;
      return Boolean(condition);
    } catch {
      return true;
    }
  }

  private log(
    context: ExecutionContext,
    level: 'info' | 'warning' | 'error',
    message: string,
    nodeId = 'system',
  ): void {
    const log: ExecutionLog = {
      timestamp: new Date(),
      nodeId,
      nodeType: nodeId === 'system' ? 'system' : 'node',
      level,
      message,
    };

    context.logs.push(log);
    console.log(`[${level.toUpperCase()}] ${message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
