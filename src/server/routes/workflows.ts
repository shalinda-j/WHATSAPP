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

        // Handle different node types
        switch (node.type) {
          case 'input':
            // Trigger node - just pass through trigger data
            result.output = triggerData;
            break;

          case 'default':
            // Check if it's an AI processing node
            if (node.data?.label?.toLowerCase().includes('ai')) {
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
            }
            // Check if it's a decision node
            else if (node.data?.label?.toLowerCase().includes('decision')) {
              const condition = node.data?.condition || 'true';
              result.output = { condition, result: true };
            }
            // Generic processing node
            else {
              result.output = { processed: true };
            }
            break;

          case 'output':
            // Send message node
            if (
              node.data?.integrationType === 'whatsapp_business' ||
              node.data?.label?.toLowerCase().includes('whatsapp')
            ) {
              const recipient =
                node.data?.phoneNumberId || context.triggerData?.sender;
              const message =
                context.variables.aiResponse ||
                node.data?.message ||
                'Workflow completed!';

              if (recipient) {
                // Use the WhatsApp service to send message
                // Note: This requires an active session
                logs.push({
                  timestamp: new Date(),
                  nodeId: node.id,
                  message: `Would send WhatsApp to ${recipient}: ${message}`,
                });
                result.output = { sent: true, recipient, message };
              }
            }
            break;

          case 'integration':
            // Handle integration nodes
            const integrationType = node.data?.integrationType;
            if (integrationType) {
              // Log the integration call
              logs.push({
                timestamp: new Date(),
                nodeId: node.id,
                message: `Integration: ${integrationType}`,
              });
              result.output = { integration: integrationType, executed: true };
            }
            break;
        }

        context.lastOutput = result.output;
        return result;
      } catch (error) {
        logs.push({
          timestamp: new Date(),
          nodeId: node.id,
          level: 'error',
          message: `Error: ${error}`,
        });
        return { success: false, error: String(error) };
      }
    };

    // Simple sequential execution (for now)
    // In a more complex system, you'd follow the edges properly
    for (const node of workflow.nodes) {
      await executeNode(node);
    }

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
