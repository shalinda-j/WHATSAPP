import type { Node, Edge } from 'reactflow';
import {
  INTEGRATIONS,
  type IntegrationField,
} from '../config/integrationPresets';

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

export interface NodeValidationRule {
  validate: (node: Node) => ValidationError[];
  isApplicable: (node: Node) => boolean;
}

export interface EdgeValidationRule {
  validate: (edge: Edge, nodes: Node[]) => ValidationError[];
  isApplicable: (edge: Edge) => boolean;
}

class WorkflowValidationService {
  private readonly nodeValidationRules: NodeValidationRule[] = [
    {
      isApplicable: (node) => node.type === 'integration',
      validate: (node) => this.validateIntegrationNode(node),
    },
    {
      isApplicable: (node) => node.type === 'default',
      validate: (node) => this.validateDefaultNode(node),
    },
    {
      isApplicable: (_node) => true,
      validate: (node) => this.validateBasicNode(node),
    },
  ];

  private readonly edgeValidationRules: EdgeValidationRule[] = [
    {
      isApplicable: () => true,
      validate: (edge, nodes) => this.validateEdgeConnection(edge, nodes),
    },
  ];

  // Main validation method
  validateWorkflow(nodes: Node[], edges: Edge[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate nodes
    nodes.forEach((node) => {
      const nodeErrors = this.validateNode(node);
      const nodeWarnings = this.validateNodeWarnings(node);

      errors.push(...nodeErrors);
      warnings.push(...nodeWarnings);
    });

    // Validate edges
    edges.forEach((edge) => {
      const edgeErrors = this.validateEdge(edge, nodes);
      errors.push(...edgeErrors);
    });

    // Workflow-level validation
    const workflowErrors = this.validateWorkflowStructure(nodes, edges);
    const workflowWarnings = this.validateWorkflowWarnings(nodes, edges);

    errors.push(...workflowErrors);
    warnings.push(...workflowWarnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // Node validation
  private validateNode(node: Node): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of this.nodeValidationRules) {
      if (rule.isApplicable(node)) {
        errors.push(...rule.validate(node));
      }
    }

    return errors;
  }

  private validateNodeWarnings(node: Node): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Check for unused configuration
    if (node.data.integrationType && !INTEGRATIONS[node.data.integrationType]) {
      warnings.push({
        type: 'warning',
        nodeId: node.id,
        message: `Unknown integration type: ${node.data.integrationType}`,
        code: 'UNKNOWN_INTEGRATION',
      });
    }

    // Check for empty labels
    if (!node.data.label || node.data.label.trim() === '') {
      warnings.push({
        type: 'warning',
        nodeId: node.id,
        field: 'label',
        message: 'Node should have a descriptive label',
        code: 'EMPTY_LABEL',
      });
    }

    return warnings;
  }

  private validateBasicNode(node: Node): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate node ID
    if (!node.id || node.id.trim() === '') {
      errors.push({
        type: 'error',
        nodeId: node.id,
        field: 'id',
        message: 'Node must have a valid ID',
        code: 'INVALID_NODE_ID',
      });
    }

    // Validate position
    if (
      !node.position ||
      typeof node.position.x !== 'number' ||
      typeof node.position.y !== 'number'
    ) {
      errors.push({
        type: 'error',
        nodeId: node.id,
        field: 'position',
        message: 'Node must have valid x, y coordinates',
        code: 'INVALID_POSITION',
      });
    }

    return errors;
  }

  private validateIntegrationNode(node: Node): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!node.data.integrationType) {
      errors.push({
        type: 'error',
        nodeId: node.id,
        field: 'integrationType',
        message: 'Integration node must specify an integration type',
        code: 'MISSING_INTEGRATION_TYPE',
      });
      return errors;
    }

    const integration = INTEGRATIONS[node.data.integrationType];
    if (!integration) {
      errors.push({
        type: 'error',
        nodeId: node.id,
        field: 'integrationType',
        message: `Unknown integration: ${node.data.integrationType}`,
        code: 'UNKNOWN_INTEGRATION',
      });
      return errors;
    }

    // Validate required fields
    integration.fields.forEach((field) => {
      const value = node.data[field.key];

      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors.push({
          type: 'error',
          nodeId: node.id,
          field: field.key,
          message: `${field.label} is required`,
          code: 'REQUIRED_FIELD',
        });
      } else if (field.type === 'url' && !this.isValidUrl(value)) {
        errors.push({
          type: 'error',
          nodeId: node.id,
          field: field.key,
          message: `${field.label} must be a valid URL`,
          code: 'INVALID_URL',
        });
      } else if (this.isEmailField(field) && !this.isValidEmail(value)) {
        errors.push({
          type: 'error',
          nodeId: node.id,
          field: field.key,
          message: `${field.label} must be a valid email address`,
          code: 'INVALID_EMAIL',
        });
      }
    });

    return errors;
  }

  private validateDefaultNode(node: Node): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate decision nodes
    if (node.data.label?.toLowerCase().includes('decision')) {
      // Decision nodes should have multiple outgoing edges
      // This is checked in workflow validation
    }

    return errors;
  }

  // Edge validation
  private validateEdge(edge: Edge, nodes: Node[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of this.edgeValidationRules) {
      if (rule.isApplicable(edge)) {
        errors.push(...rule.validate(edge, nodes));
      }
    }

    return errors;
  }

  private validateEdgeConnection(edge: Edge, nodes: Node[]): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if source and target nodes exist
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);

    if (!sourceNode) {
      errors.push({
        type: 'error',
        message: `Source node not found: ${edge.source}`,
        code: 'MISSING_SOURCE_NODE',
      });
    }

    if (!targetNode) {
      errors.push({
        type: 'error',
        message: `Target node not found: ${edge.target}`,
        code: 'MISSING_TARGET_NODE',
      });
    }

    // Validate connection types
    if (sourceNode && targetNode) {
      const connectionError = this.validateConnectionType(
        sourceNode,
        targetNode,
      );
      if (connectionError) {
        errors.push({
          type: 'error',
          message: connectionError,
          code: 'INVALID_CONNECTION',
        });
      }
    }

    return errors;
  }

  private validateConnectionType(source: Node, target: Node): string | null {
    // Input nodes shouldn't have incoming connections
    if (target.type === 'input') {
      return 'Input nodes cannot have incoming connections';
    }

    // Output nodes shouldn't have outgoing connections
    if (source.type === 'output') {
      return 'Output nodes cannot have outgoing connections';
    }

    return null;
  }

  // Workflow-level validation
  private validateWorkflowStructure(
    nodes: Node[],
    edges: Edge[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for at least one input node
    const inputNodes = nodes.filter((n) => n.type === 'input');
    if (inputNodes.length === 0) {
      errors.push({
        type: 'error',
        message: 'Workflow must have at least one input node',
        code: 'MISSING_INPUT_NODE',
      });
    }

    // Check for at least one output node
    const outputNodes = nodes.filter((n) => n.type === 'output');
    if (outputNodes.length === 0) {
      errors.push({
        type: 'error',
        message: 'Workflow must have at least one output node',
        code: 'MISSING_OUTPUT_NODE',
      });
    }

    // Check for disconnected nodes
    const connectedNodeIds = new Set<string>();
    edges.forEach((edge) => {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    });

    nodes.forEach((node) => {
      if (node.type !== 'input' && !connectedNodeIds.has(node.id)) {
        errors.push({
          type: 'error',
          nodeId: node.id,
          message: 'Node is not connected to the workflow',
          code: 'DISCONNECTED_NODE',
        });
      }
    });

    // Check for cycles
    const cycles = this.detectCycles(nodes, edges);
    if (cycles.length > 0) {
      errors.push({
        type: 'error',
        message: `Workflow contains cycles: ${cycles.join(', ')}`,
        code: 'CYCLIC_WORKFLOW',
      });
    }

    return errors;
  }

  private validateWorkflowWarnings(
    nodes: Node[],
    edges: Edge[],
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Check for nodes without outgoing connections (except output nodes)
    nodes.forEach((node) => {
      if (node.type !== 'output') {
        const outgoingEdges = edges.filter((e) => e.source === node.id);
        if (outgoingEdges.length === 0) {
          warnings.push({
            type: 'warning',
            nodeId: node.id,
            message: 'Node has no outgoing connections',
            code: 'NO_OUTGOING_CONNECTIONS',
          });
        }
      }
    });

    // Check for complex workflows
    if (nodes.length > 20) {
      warnings.push({
        type: 'warning',
        message: 'Large workflows may be difficult to manage and debug',
        code: 'LARGE_WORKFLOW',
      });
    }

    return warnings;
  }

  // Utility methods
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isEmailField(field: IntegrationField): boolean {
    return (
      field.key.toLowerCase().includes('email') ||
      field.label.toLowerCase().includes('email')
    );
  }

  private detectCycles(nodes: Node[], edges: Edge[]): string[] {
    const cycles: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): boolean => {
      if (recursionStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart).concat(nodeId).join(' -> '));
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const outgoingEdges = edges.filter((e) => e.source === nodeId);
      for (const edge of outgoingEdges) {
        if (dfs(edge.target, [...path, nodeId])) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        dfs(node.id, []);
      }
    });

    return cycles;
  }

  // Sanitization methods
  sanitizeNodeData(node: Node): Node {
    const sanitized = { ...node };

    // Sanitize string fields
    if (typeof sanitized.data.label === 'string') {
      sanitized.data.label = this.sanitizeString(sanitized.data.label);
    }

    // Sanitize integration fields
    if (
      sanitized.data.integrationType &&
      INTEGRATIONS[sanitized.data.integrationType]
    ) {
      const integration = INTEGRATIONS[sanitized.data.integrationType];
      integration.fields.forEach((field) => {
        const value = sanitized.data[field.key];
        if (typeof value === 'string') {
          if (field.type === 'url') {
            sanitized.data[field.key] = this.sanitizeUrl(value);
          } else if (this.isEmailField(field)) {
            sanitized.data[field.key] = this.sanitizeEmail(value);
          } else {
            sanitized.data[field.key] = this.sanitizeString(value);
          }
        }
      });
    }

    return sanitized;
  }

  private sanitizeString(str: string): string {
    return str
      .trim()
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, ''); // Remove event handlers
  }

  private sanitizeUrl(url: string): string {
    const sanitized = this.sanitizeString(url);

    // Ensure URL has a protocol
    if (sanitized && !sanitized.match(/^https?:\/\//)) {
      return `https://${sanitized}`;
    }

    return sanitized;
  }

  private sanitizeEmail(email: string): string {
    return this.sanitizeString(email).toLowerCase();
  }
}

export const workflowValidation = new WorkflowValidationService();
