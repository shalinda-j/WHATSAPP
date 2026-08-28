import { Router, Request, Response } from 'express';
import Workflow from '../../models/Workflow';
import { aiLoadBalancer } from '../../services/AILoadBalancer';
import { authenticateToken } from '../middleware/auth';
import {
  resolveTenant,
  withTenantScope,
  tenantIdOf,
} from '../middleware/tenantContext';
import { getIntegrationExecutor } from '../services/workflowExecutors';
import { interpolate } from '../services/workflowInterpolate';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// SECURITY FIX: All workflow routes require authentication + tenant context.
router.use(authenticateToken);
router.use(resolveTenant);

// ─────────────────────────────────────────────────────────────────────────────
// Safe Expression Evaluator
//
// Workflow decision nodes carry a user-supplied condition string (e.g.
// `triggerData.message == "yes" && variables.attempt < 3`). The previous
// implementation pre-validated tokens against an allowlist and then handed
// the string to `new Function()` — meaning ANY clever bypass of the
// allowlist (`constructor['constructor']`, escaped identifiers, comment
// tricks, future regex gaps) became remote code execution inside the
// Express process.
//
// This rewrite drops `new Function()` entirely. A small hand-written
// tokenizer + recursive-descent parser produces an AST, and a tree walker
// computes the boolean result. There is no string-to-code path, so even a
// pathologically crafted expression can only return a boolean (or throw
// during parse). The grammar intentionally supports just what workflow
// decision nodes need:
//
//   expr      ::= or
//   or        ::= and ( "||" and )*
//   and       ::= not ( "&&" not )*
//   not       ::= "!" not | comparison
//   comparison::= primary ( ("=="|"!="|"==="|"!=="|"<"|">"|"<="|">=") primary )?
//   primary   ::= NUMBER | STRING | "true" | "false" | "null" | "undefined"
//               | IDENT ( "." IDENT )*    -- variable path, max 4 segments
//               | "(" expr ")"
//
// No function calls. No bracket access. No assignment. No `new`. No `this`.
// Property access is whitelisted to plain identifier paths AND blocks
// `constructor`, `prototype`, `__proto__` to prevent prototype-chain
// escapes even if the variable values themselves point at objects.
// ─────────────────────────────────────────────────────────────────────────────

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'punct'; value: string };

const BLOCKED_PROPS = new Set([
  'constructor',
  'prototype',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number literal (integer or decimal)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const lex = input.slice(i, j);
      const n = Number(lex);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid number literal: ${lex}`);
      }
      tokens.push({ kind: 'num', value: n });
      i = j;
      continue;
    }

    // String literal: single OR double quoted; no escapes for simplicity.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\') {
          // Block escape sequences entirely — keeps the parser tiny and
          // closes the "smuggle a backslash-u escape" class of bypasses.
          throw new Error('Escape sequences are not allowed in strings');
        }
        j++;
      }
      if (j >= input.length) throw new Error('Unterminated string literal');
      tokens.push({ kind: 'str', value: input.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Identifier or keyword
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_$]/.test(input[j])) j++;
      tokens.push({ kind: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Multi-char punctuation
    const two = input.slice(i, i + 2);
    const three = input.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      tokens.push({ kind: 'punct', value: three });
      i += 3;
      continue;
    }
    if (
      two === '==' ||
      two === '!=' ||
      two === '<=' ||
      two === '>=' ||
      two === '&&' ||
      two === '||'
    ) {
      tokens.push({ kind: 'punct', value: two });
      i += 2;
      continue;
    }
    if ('()<>!.'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

function safeEvalExpression(
  expr: string,
  variables: Record<string, any>,
  triggerData: any,
  lastOutput: any,
): { result: boolean; error?: string } {
  if (typeof expr !== 'string') {
    return { result: false, error: 'expression must be a string' };
  }
  if (expr.length > 500) {
    // Hard cap on expression size — prevents pathological inputs from
    // hogging CPU during parse.
    return { result: false, error: 'expression too long (>500 chars)' };
  }

  let tokens: Token[];
  try {
    tokens = tokenize(expr);
  } catch (err: any) {
    return { result: false, error: `Tokenize: ${err.message ?? err}` };
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const eat = (value: string): boolean => {
    const t = peek();
    if (t && t.kind === 'punct' && t.value === value) {
      pos++;
      return true;
    }
    return false;
  };

  const scope: Record<string, any> = {
    variables,
    triggerData,
    lastOutput,
    // Also expose top-level variable names directly so authors can write
    // `attempt < 3` instead of `variables.attempt < 3` if they prefer.
    ...variables,
  };

  const resolvePath = (segments: string[]): any => {
    if (segments.length === 0 || segments.length > 4) {
      throw new Error('Variable path must have 1–4 segments');
    }
    for (const s of segments) {
      if (BLOCKED_PROPS.has(s)) {
        throw new Error(`Blocked property name: ${s}`);
      }
    }
    let cur: any = scope[segments[0]];
    for (let i = 1; i < segments.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[segments[i]];
    }
    return cur;
  };

  // Parser ─────────────────────────────────────────────────────────────
  const parsePrimary = (): any => {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');

    if (t.kind === 'punct' && t.value === '(') {
      consume();
      const v = parseOr();
      if (!eat(')')) throw new Error('Expected )');
      return v;
    }

    if (t.kind === 'num') {
      consume();
      return t.value;
    }

    if (t.kind === 'str') {
      consume();
      return t.value;
    }

    if (t.kind === 'ident') {
      consume();
      // Keywords
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      if (t.value === 'undefined') return undefined;
      // Variable path: a, a.b, a.b.c, a.b.c.d
      const segments = [t.value];
      while (segments.length < 4) {
        if (!eat('.')) break;
        const next = peek();
        if (!next || next.kind !== 'ident') {
          throw new Error('Expected identifier after "."');
        }
        consume();
        segments.push(next.value);
      }
      return resolvePath(segments);
    }

    throw new Error(`Unexpected token: ${t.value}`);
  };

  const parseNot = (): any => {
    if (eat('!')) {
      return !parseNot();
    }
    return parsePrimary();
  };

  const parseComparison = (): any => {
    const left = parseNot();
    const t = peek();
    if (t && t.kind === 'punct') {
      const op = t.value;
      if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(op)) {
        consume();
        const right = parseNot();
        switch (op) {
          case '==':
            // eslint-disable-next-line eqeqeq
            return left == right;
          case '!=':
            // eslint-disable-next-line eqeqeq
            return left != right;
          case '===':
            return left === right;
          case '!==':
            return left !== right;
          case '<':
            return left < right;
          case '>':
            return left > right;
          case '<=':
            return left <= right;
          case '>=':
            return left >= right;
        }
      }
    }
    return left;
  };

  const parseAnd = (): any => {
    let v = parseComparison();
    while (eat('&&')) {
      const r = parseComparison();
      v = Boolean(v) && Boolean(r) ? r : false;
    }
    return v;
  };

  const parseOr = (): any => {
    let v = parseAnd();
    while (eat('||')) {
      const r = parseAnd();
      v = v ? v : r;
    }
    return v;
  };

  try {
    const value = parseOr();
    if (pos < tokens.length) {
      const leftover = tokens[pos];
      throw new Error(`Unexpected trailing token: ${leftover.value}`);
    }
    return { result: Boolean(value) };
  } catch (err: any) {
    return { result: false, error: `Evaluation error: ${err.message ?? err}` };
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
    const workflows = await Workflow.find(withTenantScope(req, {})).sort({
      updatedAt: -1,
    });
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
router.get('/:id', validateObjectId(), async (req: Request, res: Response) => {
  try {
    // Scope by tenant so a tenant-bound admin can't read another tenant's
    // workflow by guessing its id (cross-tenant IDOR).
    const workflow = await Workflow.findOne(
      withTenantScope(req, { _id: req.params.id }),
    );
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

    const tid = tenantIdOf(req);
    const workflow = new Workflow({
      name,
      description,
      nodes,
      edges,
      metadata,
      version: '1.0.0',
      ...(tid ? { tenantId: tid } : {}),
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
router.put('/:id', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const { name, description, nodes, edges, isActive, metadata } = req.body;
    const workflow = await Workflow.findOneAndUpdate(
      withTenantScope(req, { _id: req.params.id }),
      {
        name,
        description,
        nodes,
        edges,
        isActive,
        metadata,
        updatedAt: new Date(),
      },
      { returnDocument: 'after' },
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
router.delete(
  '/:id',
  validateObjectId(),
  async (req: Request, res: Response) => {
    try {
      const workflow = await Workflow.findOneAndDelete(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!workflow)
        return res.status(404).json({ error: 'Workflow not found' });
      res.json({ message: 'Workflow deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete workflow' });
    }
  },
);

/**
 * @route POST /api/workflows/:id/execute
 * @desc Execute a saved workflow by ID
 */
router.post(
  '/:id/execute',
  validateObjectId(),
  async (req: Request, res: Response) => {
    try {
      const workflow = await Workflow.findOne(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!workflow)
        return res.status(404).json({ error: 'Workflow not found' });
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
  },
);

/**
 * @route POST /api/workflows/:id/duplicate
 * @desc Duplicate a workflow
 */
router.post(
  '/:id/duplicate',
  validateObjectId(),
  async (req: Request, res: Response) => {
    try {
      const original = await Workflow.findOne(
        withTenantScope(req, { _id: req.params.id }),
      );
      if (!original)
        return res.status(404).json({ error: 'Workflow not found' });

      const tid = tenantIdOf(req);
      const duplicate = new Workflow({
        name: `${original.name} (Copy)`,
        description: original.description,
        nodes: original.nodes,
        edges: original.edges,
        metadata: original.metadata,
        version: original.version,
        ...(tid ? { tenantId: tid } : {}),
      });
      await duplicate.save();
      res.status(201).json(duplicate);
    } catch (error) {
      res.status(500).json({ error: 'Failed to duplicate workflow' });
    }
  },
);

export default router;
