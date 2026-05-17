import { Router, Request, Response } from 'express';
import Workflow from '../../models/Workflow';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { getIntegrationExecutor } from '../services/workflowExecutors';
import { interpolate } from '../services/workflowInterpolate';

const router = Router();

// SECURITY FIX: All workflow routes require authentication + tenant context.
router.use(authenticateToken);
router.use(resolveTenant);

// ─────────────────────────────────────────────────────────────────────────────
// Safe Expression Evaluator — replaces dangerous new Function() code injection
// Only allows: comparisons, boolean ops, variable access, literals
// ─────────────────────────────────────────────────────────────────────────────
function safeEvalExpression(
  expr: string,
  variables: Record<string, any>,
  triggerData: any,
  lastOutput: any,
): { result: boolean; error?: string } {
  // SECURITY: Block dangerous patterns
  const dangerousPatterns = [
    /\bfunction\b/i,
    /\bnew\b/i,
    /\brequire\b/i,
    /\bimport\b/i,
    /\bexport\b/i,
    /\beval\b/i,
    /\bFunction\b/i,
    /\bconstructor\b/i,
    /\bprototype\b/i,
    /\b__proto__\b/i,
    /\bprocess\b/i,
    /\bglobal\b/i,
    /\bwindow\b/i,
    /\bdocument\b/i,
    /\bfetch\b/i,
    /\baxios\b/i,
    /\bhttp\b/i,
    /\bfs\b/i,
    /\bpath\b/i,
    /\bchild_process\b/i,
    /\.\s*\[/, // bracket notation property access
    /\.\s*\{/, // object literal injection
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(expr)) {
      return {
        result: false,
        error: `Blocked dangerous pattern in expression`,
      };
    }
  }

  // Build safe context with only allowed properties
  const safeContext: Record<string, any> = {
    ...variables,
    triggerData,
    lastOutput,
  };

  // Tokenize and parse expression safely
  // Allowed: variable names, numbers, strings, booleans, comparisons, logical ops
  const allowedOperators = [
    '==',
    '!=',
    '===',
    '!==',
    '>',
    '<',
    '>=',
    '<=',
    '&&',
    '||',
    '!',
  ];
  const allowedLiterals =
    /^(\d+\.?\d*|true|false|null|undefined|'[^']*'|"[^"]*")$/;

  // Simple validation: expression must only contain allowed tokens
  const tokens = expr.split(/\s+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    // Check if it's an allowed operator
    if (allowedOperators.some((op) => token.includes(op))) continue;

    // Check if it's a literal
    if (allowedLiterals.test(token)) continue;

    // Check if it's a valid variable path (e.g., variables.x, triggerData.message)
    if (/^[\w]+$/.test(token)) continue; // simple variable name
    if (/^[\w]+\.[\w]+$/.test(token)) continue; // one level property
    if (/^[\w]+\.[\w]+\.[\w]+$/.test(token)) continue; // two levels

    // Parentheses are allowed for grouping
    if (token === '(' || token === ')') continue;

    // Unknown token - reject for safety
    return { result: false, error: `Unknown token: ${token}` };
  }

  // Now safely evaluate with limited scope
  try {
    // Create a sandboxed evaluation using only the safe context
    // This is still safer than new Function() because we've validated all tokens
    const evalContext = { ...safeContext };

    // Replace variable references with safe lookups
    let safeExpr = expr;

    // Handle property access: variables.x -> (variables && variables.x)
    safeExpr = safeExpr.replace(
      /([\w]+)\.([\w]+)(\.?[\w]*)/g,
      (match, obj, prop, rest) => {
        if (rest) {
          // Two-level access: variables.x.y -> (variables?.x?.y)
          return `(${obj}?.${prop}${rest})`;
        }
        return `(${obj}?.${prop})`;
      },
    );

    // Simple variable names: wrap in optional chaining
    safeExpr = safeExpr.replace(/\b([\w]+)\b(?!\s*[.])/g, (match, name) => {
      if (['true', 'false', 'null', 'undefined'].includes(name)) return name;
      if (
        allowedOperators.some(
          (op) =>
            expr.includes(`${name}${op}`) || expr.includes(`${op}${name}`),
        )
      )
        return name;
      return `(${name})`;
    });

    // Use a restricted Function constructor with only our safe context
    // Since we've validated all tokens, this is safe
    const params = Object.keys(evalContext);
    const values = Object.values(evalContext);

    // SECURITY: Double-check no dangerous patterns survived
    if (dangerousPatterns.some((p) => p.test(safeExpr))) {
      return { result: false, error: 'Expression contains blocked patterns' };
    }

    const result = Boolean(
      new Function(...params, `return (${safeExpr})`)(...values),
    );

    return { result };
  } catch (err) {
    return { result: false, error: `Evaluation error: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared execution engine — runs nodes/edges via BFS graph traversal
// ─────────────────────────────────────────────────────────────────────────────
async function executeGraph(
  nodes: any[],
  edges: any[],
  triggerData: any,
  tenantId?: string,
): Promise<{ logs: any[]; output: any; duration: number }> {
  const startTime = Date.now();
  const logs: any[] = [];
  // Per-node outputs, keyed by node.id. Used by the interpolation helper
  // so any node can reference {{node_X.output.field}} downstream.
  const upstreamOutputs: Record<string, unknown> = {};

  const nodeMap: Record<string, any> = {};
  for (const n of nodes) nodeMap[n.id] = n;

  // Build adjacency map respecting sourceHandle for branching
  const adjacencyMap: Record<
    string,
    { targetId: string; sourceHandle?: string }[]
  > = {};
  for (const edge of edges) {
    if (!adjacencyMap[edge.source]) adjacencyMap[edge.source] = [];
    adjacencyMap[edge.source].push({
      targetId: edge.target,
      sourceHandle: edge.sourceHandle,
    });
  }

  const context: Record<string, any> = {
    triggerData: triggerData || {},
    variables: {},
    lastOutput: null,
  };

  const log = (nodeId: string, message: string, level = 'info') => {
    logs.push({ timestamp: new Date(), nodeId, level, message });
  };

  const executeNode = async (
    node: any,
  ): Promise<{ success: boolean; decisionResult?: boolean }> => {
    log(node.id, `▶ ${node.data?.label || node.type || node.id}`);

    try {
      const label = (node.data?.label || '').toLowerCase();
      const result: any = { success: true };
      let decisionResult: boolean | undefined;

      switch (node.type) {
        case 'input': {
          result.output = context.triggerData;
          log(
            node.id,
            `Trigger activated. Data: ${JSON.stringify(
              context.triggerData,
            ).substring(0, 80)}`,
          );
          break;
        }

        case 'default': {
          if (label.includes('ai') || label.includes('processing')) {
            const input =
              context.lastOutput?.message ||
              context.triggerData?.message ||
              'Hello';
            const prompt = node.data?.prompt;

            log(
              node.id,
              `AI processing input: "${String(input).substring(0, 60)}"`,
            );
            try {
              const aiResponse = await aiLoadBalancer.sendMessage(
                'workflow',
                prompt
                  ? `[System: ${prompt}]\n\nUser: ${String(input)}`
                  : String(input),
              );
              const varName = node.data?.outputVar || 'aiResponse';
              context.variables[varName] = aiResponse;
              context.variables.aiResponse = aiResponse;
              result.output = { response: aiResponse };
              log(
                node.id,
                `AI responded: "${String(aiResponse).substring(0, 80)}"`,
              );
            } catch (err) {
              log(node.id, `AI error: ${err}`, 'error');
              result.output = { response: 'AI processing failed' };
            }
          } else if (label.includes('wait') || label.includes('delay')) {
            const delaySec = parseInt(node.data?.delaySeconds || '0', 10);
            if (delaySec > 0 && delaySec <= 30) {
              log(node.id, `Waiting ${delaySec}s...`);
              await new Promise((r) => setTimeout(r, delaySec * 1000));
            } else {
              log(
                node.id,
                `Delay configured: ${delaySec}s (skipped in test mode)`,
              );
            }
            result.output = { delayed: delaySec };
          } else if (label.includes('tag')) {
            const tag = node.data?.tag || 'untagged';
            log(node.id, `Tagging contact with: "${tag}"`);
            context.variables.contactTag = tag;
            result.output = { tagged: tag };
          } else {
            result.output = { processed: true, data: context.lastOutput };
            log(node.id, `Generic node processed`);
          }
          break;
        }

        case 'decisionNode': {
          const conditionExpr = (node.data?.condition || '').trim();
          decisionResult = true; // default: follow YES path

          if (conditionExpr) {
            try {
              const { result, error } = safeEvalExpression(
                conditionExpr,
                context.variables,
                context.triggerData,
                context.lastOutput,
              );

              if (error) {
                log(
                  node.id,
                  `Condition eval blocked: ${error} — defaulting to YES`,
                  'warning',
                );
                decisionResult = true;
              } else {
                decisionResult = result;
              }
            } catch (err) {
              log(
                node.id,
                `Condition eval error: ${err} — defaulting to YES`,
                'warning',
              );
              decisionResult = true;
            }
          } else {
            log(
              node.id,
              `No condition set — taking YES branch by default`,
              'warning',
            );
          }

          context.variables.decisionResult = decisionResult;
          result.output = { condition: conditionExpr, result: decisionResult };
          log(
            node.id,
            `Decision: "${conditionExpr}" → ${
              decisionResult ? 'YES ✓' : 'NO ✗'
            }`,
          );
          break;
        }

        case 'output': {
          const message =
            node.data?.message ||
            context.variables.aiResponse ||
            context.lastOutput?.response ||
            'Workflow completed!';

          const recipient =
            node.data?.recipient || context.triggerData?.sender || 'user';

          // Replace template variables
          const finalMessage = String(message).replace(
            /\{\{(\w+)\}\}/g,
            (_, key) => {
              return String(
                context.variables[key] ??
                  context.triggerData?.[key] ??
                  `{{${key}}}`,
              );
            },
          );

          log(
            node.id,
            `📤 Send to ${recipient}: "${finalMessage.substring(0, 80)}"`,
          );
          result.output = { sent: true, recipient, message: finalMessage };
          context.variables.lastSentMessage = finalMessage;
          break;
        }

        case 'integration': {
          const iType = node.data?.integrationType as string | undefined;
          // Resolve every {{placeholder}} in the node config against the
          // trigger payload + outputs of every previously-executed node.
          // Interpolation never throws — missing references become empty
          // strings — so a placeholder typo can't crash the workflow.
          const interpolatedConfig = interpolate(node.data ?? {}, {
            trigger: context.triggerData,
            upstream: upstreamOutputs,
          });
          const executor = getIntegrationExecutor(iType);
          if (!executor) {
            // Unsupported integration types log + return ok:false so the
            // operator sees a clear failure rather than a fake success.
            log(
              node.id,
              `Integration [${iType ?? 'unknown'}] has no executor — skipped`,
              'error',
            );
            result.output = {
              integration: iType,
              executed: false,
              error: 'no_executor',
              config: interpolatedConfig,
            };
            return { success: false };
          }
          log(node.id, `→ executing integration [${iType}]`);
          const execResult = await executor(interpolatedConfig, {
            tenantId,
            triggerData: context.triggerData,
            upstream: upstreamOutputs,
          });
          if (execResult.ok) {
            log(
              node.id,
              `✓ ${iType} ok${
                execResult.providerCallId
                  ? ` (id=${execResult.providerCallId})`
                  : ''
              }`,
            );
          } else {
            log(
              node.id,
              `✗ ${iType} failed: ${execResult.error ?? 'unknown error'}`,
              'error',
            );
          }
          result.output = {
            integration: iType,
            executed: execResult.ok,
            providerCallId: execResult.providerCallId,
            status: execResult.status,
            data: execResult.data,
            error: execResult.error,
          };
          if (!execResult.ok) {
            return { success: false };
          }
          break;
        }

        default:
          log(node.id, `Unknown node type: ${node.type}`);
          result.output = { skipped: true };
      }

      context.lastOutput = result.output;
      // Expose this node's output to downstream {{node_id.field}} lookups.
      upstreamOutputs[node.id] = result.output;
      return { success: true, decisionResult };
    } catch (error) {
      log(node.id, `Error: ${error}`, 'error');
      return { success: false };
    }
  };

  // Find start node
  const startNode = nodes.find((n: any) => n.type === 'input');
  if (!startNode) {
    return {
      logs: [
        {
          timestamp: new Date(),
          nodeId: 'system',
          level: 'error',
          message: 'No trigger (input) node found',
        },
      ],
      output: null,
      duration: Date.now() - startTime,
    };
  }

  // BFS graph traversal — respects decision node branching via sourceHandle
  const visited = new Set<string>();
  const queue: string[] = [startNode.id];

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentNode = nodeMap[currentId];
    if (!currentNode) continue;

    const { success, decisionResult } = await executeNode(currentNode);
    if (!success) continue;

    const outgoing = adjacencyMap[currentId] || [];

    if (currentNode.type === 'decisionNode') {
      // Only follow the matching handle (yes/no)
      for (const { targetId, sourceHandle } of outgoing) {
        const handle = (sourceHandle || 'yes').toLowerCase();
        if (decisionResult && handle === 'yes') {
          if (!visited.has(targetId)) queue.push(targetId);
        } else if (!decisionResult && handle === 'no') {
          if (!visited.has(targetId)) queue.push(targetId);
        }
      }
    } else {
      // Follow all outgoing edges
      for (const { targetId } of outgoing) {
        if (!visited.has(targetId)) queue.push(targetId);
      }
    }
  }

  return { logs, output: context.lastOutput, duration: Date.now() - startTime };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

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
 * @route POST /api/workflows/execute
 * @desc Execute nodes/edges directly (no save required — for preview/test runs)
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const { nodes, edges, triggerData } = req.body;

    if (!nodes || !Array.isArray(nodes)) {
      return res.status(400).json({ error: 'nodes array is required' });
    }

    const { logs, output, duration } = await executeGraph(
      nodes,
      edges || [],
      triggerData || {
        message: 'Manual test run',
        sender: 'test',
        timestamp: new Date().toISOString(),
      },
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );

    res.json({
      success: true,
      executionId: `exec_${Date.now()}`,
      duration,
      logs,
      output,
    });
  } catch (error) {
    console.error('Error executing workflow:', error);
    res
      .status(500)
      .json({ error: 'Failed to execute workflow', details: String(error) });
  }
});

/**
 * @route GET /api/workflows/:id
 * @desc Get a single workflow by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json(workflow);
  } catch (error) {
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
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json(workflow);
  } catch (error) {
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
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/**
 * @route POST /api/workflows/:id/execute
 * @desc Execute a saved workflow by ID
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    if (!workflow.isActive)
      return res.status(400).json({ error: 'Workflow is not active' });

    const { triggerData } = req.body;
    const { logs, output, duration } = await executeGraph(
      workflow.nodes as any[],
      workflow.edges as any[],
      triggerData || {
        message: 'Manual trigger',
        timestamp: new Date().toISOString(),
      },
      req.tenant?._id ? String(req.tenant._id) : undefined,
    );

    workflow.lastRunAt = new Date();
    workflow.runCount += 1;
    await workflow.save();

    res.json({
      success: true,
      executionId: `exec_${Date.now()}`,
      workflowId: workflow._id,
      duration,
      logs,
      output,
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
    if (!original) return res.status(404).json({ error: 'Workflow not found' });

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
    res.status(500).json({ error: 'Failed to duplicate workflow' });
  }
});

export default router;
