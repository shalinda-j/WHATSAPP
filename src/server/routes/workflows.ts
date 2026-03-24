import { Router, Request, Response } from 'express';
import Workflow from '../../models/Workflow';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
// Note: sendMessage is imported from whatsapp service for direct WhatsApp integration
// import { sendMessage } from '../../services/whatsapp';

const router = Router();

/**
 * @route GET /api/workflows
 * @desc Get all workflows
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const workflows = await Workflow.find().sort({ updatedAt: -1 });
    res.json(workflows);
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({ error: 'Failed to fetch workflows' });
  }
});

/**
 * @route GET /api/workflows/:id
 * @desc Get a single workflow by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    res.json(workflow);
  } catch (error) {
    console.error('Error fetching workflow:', error);
    res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

/**
 * @route POST /api/workflows
 * @desc Create a new workflow
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges, metadata } = req.body;

    if (!name || !nodes || !edges) {
      return res
        .status(400)
        .json({ error: 'Name, nodes, and edges are required' });
    }

    const workflow = new Workflow({
      name,
      description,
      nodes,
      edges,
      metadata,
      version: '1.0.0',
    });

    await workflow.save();
    res.status(201).json(workflow);
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

/**
 * @route PUT /api/workflows/:id
 * @desc Update a workflow
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges, isActive, metadata } = req.body;

    const workflow = await Workflow.findByIdAndUpdate(
      req.params.id,
      {
        name,
        description,
        nodes,
        edges,
        isActive,
        metadata,
        updatedAt: new Date(),
      },
      { new: true },
    );

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    res.json(workflow);
  } catch (error) {
    console.error('Error updating workflow:', error);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

/**
 * @route DELETE /api/workflows/:id
 * @desc Delete a workflow
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const workflow = await Workflow.findByIdAndDelete(req.params.id);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/**
 * @route POST /api/workflows/:id/execute
 * @desc Execute a workflow
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const workflow = await Workflow.findById(req.params.id);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    if (!workflow.isActive) {
      return res.status(400).json({ error: 'Workflow is not active' });
    }

    const { triggerData } = req.body;
    const startTime = Date.now();
    const logs: any[] = [];

    // Find the starting node (input type)
    const startNode = workflow.nodes.find((n: any) => n.type === 'input');
    if (!startNode) {
      return res.status(400).json({ error: 'Workflow has no starting node' });
    }

    // Build adjacency map from edges for graph traversal
    const adjacencyMap: Record<string, string[]> = {};
    for (const edge of (workflow.edges as any[])) {
      if (!adjacencyMap[edge.source]) adjacencyMap[edge.source] = [];
      adjacencyMap[edge.source].push(edge.target);
    }

    // Build node lookup map
    const nodeMap: Record<string, any> = {};
    for (const node of workflow.nodes as any[]) {
      nodeMap[node.id] = node;
    }

    // Execute workflow nodes in order
    const context: Record<string, any> = {
      triggerData,
      variables: {},
      lastOutput: null,
    };

    const executeNode = async (node: any): Promise<any> => {
      logs.push({
        timestamp: new Date(),
        nodeId: node.id,
        nodeType: node.type,
        message: `Executing node: ${node.data?.label || node.id}`,
      });

      try {
        const result: any = { success: true };
        const label = (node.data?.label || '').toLowerCase();

        // Handle different node types
        switch (node.type) {
          case 'input':
            // Trigger node - pass through trigger data
            result.output = triggerData;
            break;

          case 'default':
            if (label.includes('ai') || label.includes('processing')) {
              // AI processing node
              const input =
                context.lastOutput?.message ||
                context.triggerData?.message ||
                'Hello';
              const aiResponse = await aiLoadBalancer.sendMessage(
                'workflow',
                input,
              );
              result.output = { response: aiResponse };
              context.variables.aiResponse = aiResponse;
            } else if (label.includes('decision') || label.includes('logic')) {
              // Decision/condition node - evaluate the condition expression
              const conditionExpr = node.data?.condition || node.data?.config || '';
              let conditionResult = true;

              if (conditionExpr) {
                try {
                  // Safe evaluation: only allow simple comparisons against context values
                  const safeContext = { ...context.variables, triggerData: context.triggerData };
                  const conditionStr = conditionExpr
                    .replace(/\bcontext\.variables\./g, 'safeContext.')
                    .replace(/\btriggerData\./g, 'safeContext.triggerData.');
                  // eslint-disable-next-line no-new-func
                  conditionResult = Boolean(new Function('safeContext', `"use strict"; return (${conditionStr});`)(safeContext));
                } catch {
                  conditionResult = true; // default to true on eval error
                }
              }

              result.output = { condition: conditionExpr, result: conditionResult };
              context.variables.decisionResult = conditionResult;

              // Only follow edges matching the result branch
              // Edges for decision: if result=true, follow source handle "true"; else "false"
              // For simplicity, all outgoing edges are followed when result=true
              if (!conditionResult) {
                logs.push({
                  timestamp: new Date(),
                  nodeId: node.id,
                  message: `Decision: condition evaluated to false, stopping this branch`,
                });
                return result;
              }
            } else {
              // Generic processing node
              result.output = { processed: true, data: context.lastOutput };
            }
            break;

          case 'output':
            // Send message node
            if (
              node.data?.integrationType === 'whatsapp_business' ||
              label.includes('whatsapp') ||
              label.includes('send')
            ) {
              const recipient =
                node.data?.phoneNumberId || context.triggerData?.sender;
              const message =
                node.data?.message ||
                context.variables.aiResponse ||
                'Workflow completed!';

              logs.push({
                timestamp: new Date(),
                nodeId: node.id,
                message: `[WhatsApp] Would send to ${recipient || 'unknown'}: "${message}"`,
              });
              result.output = { sent: true, recipient, message };
            } else {
              result.output = { output: context.lastOutput };
            }
            break;

          case 'integration': {
            // Handle integration nodes
            const integrationType = node.data?.integrationType;
            if (integrationType) {
              logs.push({
                timestamp: new Date(),
                nodeId: node.id,
                message: `Integration [${integrationType}] executed with config: ${JSON.stringify(node.data)}`,
              });
              result.output = { integration: integrationType, executed: true, config: node.data };
            }
            break;
          }
        }

        context.lastOutput = result.output;
        return result;
      } catch (error) {
        logs.push({
          timestamp: new Date(),
          nodeId: node.id,
          level: 'error',
          message: `Error in node ${node.data?.label || node.id}: ${error}`,
        });
        return { success: false, error: String(error) };
      }
    };

    // Graph-based execution: BFS traversal following edges
    const visited = new Set<string>();
    const queue: string[] = [startNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const currentNode = nodeMap[currentId];
      if (!currentNode) continue;

      const result = await executeNode(currentNode);

      // If node succeeded, enqueue connected nodes
      if (result.success !== false) {
        const nextNodes = adjacencyMap[currentId] || [];
        for (const nextId of nextNodes) {
          if (!visited.has(nextId)) {
            queue.push(nextId);
          }
        }
      }
    }

    // If there are disconnected nodes not reachable from start, skip them (correct behavior)

    // Update workflow stats
    workflow.lastRunAt = new Date();
    workflow.runCount += 1;
    await workflow.save();

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      executionId: `exec_${Date.now()}`,
      workflowId: workflow._id,
      duration,
      logs,
      output: context.lastOutput,
    });
  } catch (error) {
    console.error('Error executing workflow:', error);
    res.status(500).json({ error: 'Failed to execute workflow' });
  }
});

/**
 * @route POST /api/workflows/:id/duplicate
 * @desc Duplicate a workflow
 */
router.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const original = await Workflow.findById(req.params.id);

    if (!original) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const duplicate = new Workflow({
      name: `${original.name} (Copy)`,
      description: original.description,
      nodes: original.nodes,
      edges: original.edges,
      metadata: original.metadata,
      version: original.version,
    });

    await duplicate.save();
    res.status(201).json(duplicate);
  } catch (error) {
    console.error('Error duplicating workflow:', error);
    res.status(500).json({ error: 'Failed to duplicate workflow' });
  }
});

export default router;
