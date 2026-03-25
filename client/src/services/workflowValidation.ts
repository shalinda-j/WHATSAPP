import type { Node, Edge } from 'reactflow';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'error';
  nodeId?: string;
  field?: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  type: 'warning';
  nodeId?: string;
  field?: string;
  message: string;
  code: string;
}

class WorkflowValidationService {
  validateWorkflow(nodes: Node[], edges: Edge[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (nodes.length === 0) {
      errors.push({
        type: 'error',
        message: 'Workflow must have at least one node',
        code: 'EMPTY_WORKFLOW',
      });
      return { isValid: false, errors, warnings };
    }

    // Must have a trigger/start node
    const inputNodes = nodes.filter((n) => n.type === 'input');
    if (inputNodes.length === 0) {
      errors.push({
        type: 'error',
        message: 'Workflow must start with a Trigger node (drag "WhatsApp Trigger" onto the canvas)',
        code: 'MISSING_INPUT_NODE',
      });
    }

    // Check for cycles (hard error)
    const cycles = this.detectCycles(nodes, edges);
    if (cycles.length > 0) {
      errors.push({
        type: 'error',
        message: `Workflow contains circular connections. Remove the loop: ${cycles[0]}`,
        code: 'CYCLIC_WORKFLOW',
      });
    }

    // Check for broken edges (source/target missing)
    edges.forEach((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode) {
        errors.push({ type: 'error', message: `Connection has missing source node`, code: 'MISSING_SOURCE_NODE' });
      }
      if (!targetNode) {
        errors.push({ type: 'error', message: `Connection has missing target node`, code: 'MISSING_TARGET_NODE' });
      }
    });

    // Warnings (non-blocking)

    // No output node
    const outputNodes = nodes.filter((n) => n.type === 'output');
    if (outputNodes.length === 0) {
      warnings.push({
        type: 'warning',
        message: 'No "Send WhatsApp" node found — workflow will not send any messages',
        code: 'MISSING_OUTPUT_NODE',
      });
    }

    // Disconnected nodes
    const connectedIds = new Set<string>();
    edges.forEach((edge) => {
      connectedIds.add(edge.source);
      connectedIds.add(edge.target);
    });
    nodes.forEach((node) => {
      if (node.type !== 'input' && !connectedIds.has(node.id)) {
        warnings.push({
          type: 'warning',
          nodeId: node.id,
          message: `Node "${node.data?.label || node.id}" is not connected to any other node`,
          code: 'DISCONNECTED_NODE',
        });
      }
    });

    // Decision nodes without condition
    nodes
      .filter((n) => n.type === 'decisionNode')
      .forEach((node) => {
        if (!node.data?.condition || String(node.data.condition).trim() === '') {
          warnings.push({
            type: 'warning',
            nodeId: node.id,
            message: `Decision node "${node.data?.label || 'Decision'}" has no condition set (double-click to configure)`,
            code: 'MISSING_CONDITION',
          });
        }
      });

    // Output nodes without message
    nodes
      .filter((n) => n.type === 'output')
      .forEach((node) => {
        if (!node.data?.message || String(node.data.message).trim() === '') {
          warnings.push({
            type: 'warning',
            nodeId: node.id,
            message: `"Send WhatsApp" node "${node.data?.label || 'Send'}" has no message configured`,
            code: 'MISSING_MESSAGE',
          });
        }
      });

    // Large workflow
    if (nodes.length > 20) {
      warnings.push({
        type: 'warning',
        message: 'Large workflow — consider breaking it into smaller sub-workflows',
        code: 'LARGE_WORKFLOW',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private detectCycles(nodes: Node[], edges: Edge[]): string[] {
    const cycles: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): boolean => {
      if (recursionStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart).concat(nodeId).join(' → '));
        return true;
      }
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const outgoingEdges = edges.filter((e) => e.source === nodeId);
      for (const edge of outgoingEdges) {
        if (dfs(edge.target, [...path, nodeId])) return true;
      }

      recursionStack.delete(nodeId);
      return false;
    };

    nodes.forEach((node) => {
      if (!visited.has(node.id)) dfs(node.id, []);
    });

    return cycles;
  }
}

export const workflowValidation = new WorkflowValidationService();
