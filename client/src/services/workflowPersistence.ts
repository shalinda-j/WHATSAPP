import type { Node, Edge } from 'reactflow';

export interface WorkflowData {
  id: string;
  name: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: Date;
  updatedAt: Date;
  version: string;
  metadata?: {
    tags?: string[];
    category?: string;
    isTemplate?: boolean;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
  };
}

export interface WorkflowTemplate extends WorkflowData {
  isTemplate: true;
  preview?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

class WorkflowPersistenceService {
  private readonly STORAGE_KEY = 'marketing_workflows';
  private readonly TEMPLATES_KEY = 'workflow_templates';
  private readonly API_ENDPOINT = '/api/workflows';

  // Local Storage Operations
  async saveToLocalStorage(
    workflow: Omit<WorkflowData, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowData> {
    try {
      const workflows = this.getFromLocalStorage();
      const now = new Date();

      const workflowData: WorkflowData = {
        ...workflow,
        id: this.generateId(),
        createdAt: now,
        updatedAt: now,
        version: '1.0.0',
      };

      workflows.push(workflowData);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(workflows));

      return workflowData;
    } catch (error) {
      console.error('Failed to save workflow to localStorage:', error);
      throw new Error('Failed to save workflow locally');
    }
  }

  async updateInLocalStorage(
    id: string,
    updates: Partial<WorkflowData>,
  ): Promise<WorkflowData> {
    try {
      const workflows = this.getFromLocalStorage();
      const index = workflows.findIndex((w) => w.id === id);

      if (index === -1) {
        throw new Error('Workflow not found');
      }

      workflows[index] = {
        ...workflows[index],
        ...updates,
        updatedAt: new Date(),
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(workflows));
      return workflows[index];
    } catch (error) {
      console.error('Failed to update workflow in localStorage:', error);
      throw new Error('Failed to update workflow');
    }
  }

  getFromLocalStorage(): WorkflowData[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (!data) return [];

      const workflows = JSON.parse(data);
      return Array.isArray(workflows) ? workflows : [];
    } catch (error) {
      console.error('Failed to load workflows from localStorage:', error);
      return [];
    }
  }

  async deleteFromLocalStorage(id: string): Promise<void> {
    try {
      const workflows = this.getFromLocalStorage();
      const filtered = workflows.filter((w) => w.id !== id);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to delete workflow from localStorage:', error);
      throw new Error('Failed to delete workflow');
    }
  }

  // API Operations
  async saveToAPI(
    workflow: Omit<WorkflowData, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowData> {
    try {
      const response = await fetch(this.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflow),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to save workflow to API:', error);
      // Fallback to localStorage
      return this.saveToLocalStorage(workflow);
    }
  }

  async updateInAPI(
    id: string,
    updates: Partial<WorkflowData>,
  ): Promise<WorkflowData> {
    try {
      const response = await fetch(`${this.API_ENDPOINT}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to update workflow in API:', error);
      // Fallback to localStorage
      return this.updateInLocalStorage(id, updates);
    }
  }

  async getFromAPI(): Promise<WorkflowData[]> {
    try {
      const response = await fetch(this.API_ENDPOINT);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to load workflows from API:', error);
      // Fallback to localStorage
      return this.getFromLocalStorage();
    }
  }

  async deleteFromAPI(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.API_ENDPOINT}/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to delete workflow from API:', error);
      // Fallback to localStorage
      return this.deleteFromLocalStorage(id);
    }
  }

  // Auto-save functionality
  async autoSave(workflow: {
    nodes: Node[];
    edges: Edge[];
    name?: string;
  }): Promise<void> {
    try {
      const autoSaveKey = `${this.STORAGE_KEY}_autosave`;
      const autoSaveData = {
        ...workflow,
        timestamp: new Date().toISOString(),
      };

      localStorage.setItem(autoSaveKey, JSON.stringify(autoSaveData));
    } catch (error) {
      console.error('Failed to auto-save workflow:', error);
    }
  }

  getAutoSave(): {
    nodes: Node[];
    edges: Edge[];
    name?: string;
    timestamp: string;
  } | null {
    try {
      const autoSaveKey = `${this.STORAGE_KEY}_autosave`;
      const data = localStorage.getItem(autoSaveKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to load auto-save:', error);
      return null;
    }
  }

  clearAutoSave(): void {
    try {
      const autoSaveKey = `${this.STORAGE_KEY}_autosave`;
      localStorage.removeItem(autoSaveKey);
    } catch (error) {
      console.error('Failed to clear auto-save:', error);
    }
  }

  // Template Management
  async saveTemplate(
    template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowTemplate> {
    try {
      const templates = this.getTemplates();
      const now = new Date();

      const templateData: WorkflowTemplate = {
        ...template,
        id: this.generateId(),
        createdAt: now,
        updatedAt: now,
        version: '1.0.0',
        isTemplate: true,
      };

      templates.push(templateData);
      localStorage.setItem(this.TEMPLATES_KEY, JSON.stringify(templates));

      return templateData;
    } catch (error) {
      console.error('Failed to save template:', error);
      throw new Error('Failed to save template');
    }
  }

  getTemplates(): WorkflowTemplate[] {
    try {
      const data = localStorage.getItem(this.TEMPLATES_KEY);
      if (!data) return this.getDefaultTemplates();

      const templates = JSON.parse(data);
      const defaultTemplates = this.getDefaultTemplates();
      return [
        ...defaultTemplates,
        ...(Array.isArray(templates) ? templates : []),
      ];
    } catch (error) {
      console.error('Failed to load templates:', error);
      return this.getDefaultTemplates();
    }
  }

  private getDefaultTemplates(): WorkflowTemplate[] {
    return [
      {
        id: 'welcome-sequence',
        name: 'Welcome Sequence',
        description:
          'Automatically welcome new users with a series of messages',
        nodes: [
          {
            id: '1',
            type: 'input',
            data: { label: 'New User Joins' },
            position: { x: 250, y: 0 },
          },
          {
            id: '2',
            type: 'default',
            data: {
              label: 'Send Welcome Message',
              integrationType: 'whatsapp_business',
            },
            position: { x: 100, y: 100 },
          },
          {
            id: '3',
            type: 'default',
            data: { label: 'Wait 1 Day' },
            position: { x: 400, y: 100 },
          },
          {
            id: '4',
            type: 'output',
            data: { label: 'Send Follow-up' },
            position: { x: 250, y: 200 },
          },
        ],
        edges: [
          { id: 'e1-2', source: '1', target: '2' },
          { id: 'e2-3', source: '2', target: '3' },
          { id: 'e3-4', source: '3', target: '4' },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        version: '1.0.0',
        isTemplate: true,
        metadata: {
          tags: ['welcome', 'onboarding'],
          category: 'Customer Journey',
          isTemplate: true,
          difficulty: 'beginner',
        },
      },
    ];
  }

  // Utility methods
  private generateId(): string {
    return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async exportWorkflow(workflow: WorkflowData): Promise<string> {
    try {
      const exportData = {
        ...workflow,
        exportedAt: new Date().toISOString(),
        exportedBy: 'Marketing Workflow Builder v1.0.0',
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('Failed to export workflow:', error);
      throw new Error('Failed to export workflow');
    }
  }

  async importWorkflow(jsonString: string): Promise<WorkflowData> {
    try {
      const imported = JSON.parse(jsonString);

      // Validate imported data
      if (!imported.nodes || !imported.edges || !imported.name) {
        throw new Error('Invalid workflow format');
      }

      const workflowData: WorkflowData = {
        id: this.generateId(),
        name: imported.name,
        description: imported.description,
        nodes: imported.nodes,
        edges: imported.edges,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: '1.0.0',
        metadata: imported.metadata,
      };

      return workflowData;
    } catch (error) {
      console.error('Failed to import workflow:', error);
      throw new Error('Failed to import workflow');
    }
  }
}

export const workflowPersistence = new WorkflowPersistenceService();
