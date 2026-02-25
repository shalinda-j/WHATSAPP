import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.ts';

const router = Router();

// Get all workflows
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // In a real implementation, fetch from database
    // For now, return mock data
    const workflows = [
      {
        id: '1',
        name: 'Welcome Sequence',
        description: 'Automatically welcome new users',
        createdAt: new Date(),
        updatedAt: new Date(),
        nodeCount: 4,
        edgeCount: 3
      },
      {
        id: '2',
        name: 'Lead Nurturing',
        description: 'Follow up with leads over time',
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(Date.now() - 43200000),
        nodeCount: 6,
        edgeCount: 5
      }
    ];

    res.json({
      success: true,
      data: workflows,
      total: workflows.length
    });
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workflows'
    });
  }
});

// Get single workflow
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    // Mock workflow data
    const workflow = {
      id,
      name: `Workflow ${id}`,
      description: 'Sample marketing workflow',
      nodes: [
        {
          id: '1',
          type: 'input',
          data: { label: 'Start Workflow' },
          position: { x: 250, y: 5 }
        },
        {
          id: '2',
          type: 'default',
          data: { label: 'AI Processing' },
          position: { x: 100, y: 100 }
        }
      ],
      edges: [
        {
          id: 'e1-2',
          source: '1',
          target: '2'
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    res.json({
      success: true,
      data: workflow
    });
  } catch (error) {
    console.error('Error fetching workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workflow'
    });
  }
});

// Create new workflow
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { name, description, nodes, edges } = req.body;

    if (!name || !nodes || !edges) {
      return res.status(400).json({
        success: false,
        error: 'Name, nodes, and edges are required'
      });
    }

    const newWorkflow = {
      id: Date.now().toString(),
      name,
      description: description || '',
      nodes,
      edges,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log('Created new workflow:', newWorkflow);

    res.status(201).json({
      success: true,
      data: newWorkflow,
      message: 'Workflow created successfully'
    });
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create workflow'
    });
  }
});

// Update workflow
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, description, nodes, edges } = req.body;

    const updatedWorkflow = {
      id,
      name: name || `Workflow ${id}`,
      description: description || '',
      nodes,
      edges,
      updatedAt: new Date()
    };

    console.log('Updated workflow:', updatedWorkflow);

    res.json({
      success: true,
      data: updatedWorkflow,
      message: 'Workflow updated successfully'
    });
  } catch (error) {
    console.error('Error updating workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update workflow'
    });
  }
});

// Delete workflow
router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    console.log('Deleted workflow:', id);

    res.json({
      success: true,
      message: 'Workflow deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete workflow'
    });
  }
});

// Execute workflow
router.post('/:id/execute', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { startNodeId } = req.body;

    console.log(`Executing workflow ${id} with start node:`, startNodeId);

    // Mock execution result
    const executionResult = {
      executionId: `exec_${Date.now()}`,
      status: 'completed',
      startTime: new Date(),
      endTime: new Date(),
      duration: 2500,
      nodesProcessed: 4,
      edgesProcessed: 3,
      output: {
        message: 'Workflow executed successfully',
        results: ['Message sent', 'AI response generated', 'Follow-up scheduled']
      }
    };

    res.json({
      success: true,
      data: executionResult,
      message: 'Workflow executed successfully'
    });
  } catch (error) {
    console.error('Error executing workflow:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute workflow'
    });
  }
});

export default router;
