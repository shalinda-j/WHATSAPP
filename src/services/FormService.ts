import FormTemplate, { FormField } from '../models/FormTemplate';
import FormSubmission from '../models/FormSubmission';
import sessionStateService from './SessionStateService';

interface UserFormState {
  formId: string;
  phoneNumber: string;
  whatsappJid: string;
  currentFieldIndex: number;
  data: Record<string, any>;
  startedAt: Date;
  lastActivityAt: Date;
}

/**
 * FormService - Handles dynamic registration forms for WhatsApp bot
 * Now uses persistent storage via SessionStateService
 */
export class FormService {
  // Session TTL: 30 minutes
  private static SESSION_TTL_MS = 30 * 60 * 1000;

  /**
   * Get the active/default form template
   */
  static async getActiveFormTemplate(): Promise<typeof FormTemplate.prototype | null> {
    try {
      // First try to get the default active template
      let template = await FormTemplate.findOne({ isActive: true, isDefault: true });
      if (!template) {
        // Fallback to any active template, but sort by createdAt to ensure consistency
        template = await FormTemplate.findOne({ isActive: true }).sort({ createdAt: 1 });
      }
      return template;
    } catch (error) {
      console.error('❌ [FormService] Error getting active form template:', error);
      return null;
    }
  }

  /**
   * Check if user has an active form session
   */
  static async hasActiveFormSession(phoneNumber: string): Promise<boolean> {
    return sessionStateService.hasSession(phoneNumber, 'form');
  }

  /**
   * Get user's current form state
   */
  static async getFormSession(phoneNumber: string): Promise<UserFormState | null> {
    const session = await sessionStateService.getSession(phoneNumber, 'form');
    if (!session) return null;

    return {
      formId: session.data.formId,
      phoneNumber: session.data.phoneNumber,
      whatsappJid: session.data.whatsappJid,
      currentFieldIndex: session.state.currentFieldIndex,
      data: session.data.formData || {},
      startedAt: session.data.startedAt,
      lastActivityAt: session.updatedAt,
    };
  }

  /**
   * Start a new form session for a user
   */
  static async startFormSession(
    phoneNumber: string,
    whatsappJid: string,
  ): Promise<{ success: boolean; message?: string; field?: FormField; welcomeMessage?: string }> {
    try {
      // Check if user already has an active session
      const existingSession = await this.getFormSession(phoneNumber);
      if (existingSession) {
        const template = await FormTemplate.findById(existingSession.formId);
        if (template && existingSession.currentFieldIndex < template.fields.length) {
          const sortedFields = [...template.fields].sort((a, b) => a.order - b.order);
          return {
            success: true,
            message: 'You already have a form in progress. Let\'s continue.',
            field: sortedFields[existingSession.currentFieldIndex],
          };
        }
      }

      // Get active form template
      const template = await this.getActiveFormTemplate();
      if (!template) {
        return { success: false, message: 'No active registration form available.' };
      }

      if (!template.fields || template.fields.length === 0) {
        return { success: false, message: 'Registration form has no fields configured.' };
      }

      // Sort fields by order
      const sortedFields = [...template.fields].sort((a, b) => a.order - b.order);

      // Create new session with persistent storage
      const sessionData: UserFormState = {
        formId: (template._id as any).toString(),
        phoneNumber,
        whatsappJid,
        currentFieldIndex: 0,
        data: {},
        startedAt: new Date(),
        lastActivityAt: new Date(),
      };

      await sessionStateService.setSession(
        phoneNumber,
        'form',
        { currentFieldIndex: 0 },
        {
          formId: sessionData.formId,
          phoneNumber,
          whatsappJid,
          formData: {},
          startedAt: sessionData.startedAt,
        },
        this.SESSION_TTL_MS,
      );

      return {
        success: true,
        welcomeMessage: template.welcomeMessage || '📋 Let\'s get you registered! Please answer the following questions.',
        field: sortedFields[0],
      };
    } catch (error) {
      console.error('❌ [FormService] Error starting form session:', error);
      return { success: false, message: 'Error starting registration form.' };
    }
  }

  /**
   * Process a form field answer
   */
  static async processFieldAnswer(
    phoneNumber: string,
    answer: string,
  ): Promise<{
    success: boolean;
    message?: string;
    field?: FormField;
    isComplete?: boolean;
    completionMessage?: string;
  }> {
    try {
      const sessionData = await sessionStateService.getSession(phoneNumber, 'form');
      if (!sessionData) {
        return { success: false, message: 'No active form session. Type "register" to start.' };
      }

      // Get form template
      const template = await FormTemplate.findById(sessionData.data.formId);
      if (!template) {
        await sessionStateService.deleteSession(phoneNumber, 'form');
        return { success: false, message: 'Form template no longer exists.' };
      }

      // Sort fields by order
      const sortedFields = [...template.fields].sort((a, b) => a.order - b.order);
      const currentFieldIndex = sessionData.state.currentFieldIndex;
      const currentField = sortedFields[currentFieldIndex];

      if (!currentField) {
        return { success: false, message: 'No current field to process.' };
      }

      // Validate answer
      const validationResult = this.validateFieldAnswer(currentField, answer);
      if (!validationResult.valid) {
        return {
          success: false,
          message: validationResult.message || 'Invalid answer. Please try again.',
          field: currentField,
        };
      }

      // Store answer
      const formData = sessionData.data.formData || {};
      formData[currentField.id] = validationResult.value;

      // Update session with new data
      const newIndex = currentFieldIndex + 1;
      await sessionStateService.updateSessionState(phoneNumber, 'form', { currentFieldIndex: newIndex });
      await sessionStateService.updateSessionData(phoneNumber, 'form', { formData });

      // Extend session expiry
      await sessionStateService.extendSession(phoneNumber, 'form', this.SESSION_TTL_MS);

      // Check if form is complete
      if (newIndex >= sortedFields.length) {
        // Submit form
        const submission = await this.submitForm(phoneNumber, sessionData.data.formId, formData, sessionData.data.whatsappJid);

        // Clear session
        await sessionStateService.deleteSession(phoneNumber, 'form');

        return {
          success: true,
          isComplete: true,
          completionMessage: template.completionMessage || '✅ Thank you! Your registration has been submitted successfully.',
          message: submission.success
            ? undefined
            : 'Your registration was recorded but there was an issue saving. We\'ll contact you soon.',
        };
      }

      // Return next field
      return {
        success: true,
        field: sortedFields[newIndex],
      };
    } catch (error) {
      console.error('❌ [FormService] Error processing field answer:', error);
      return { success: false, message: 'Error processing your answer. Please try again.' };
    }
  }

  /**
   * Validate a field answer
   */
  static validateFieldAnswer(
    field: FormField,
    answer: string,
  ): { valid: boolean; value?: any; message?: string } {
    const trimmedAnswer = answer.trim();

    // Check required
    if (field.required && !trimmedAnswer) {
      return { valid: false, message: 'This field is required. Please provide an answer.' };
    }

    // Skip validation if not required and empty
    if (!field.required && !trimmedAnswer) {
      return { valid: true, value: '' };
    }

    switch (field.type) {
      case 'text':
      case 'textarea':
        if (field.validation?.minLength && trimmedAnswer.length < field.validation.minLength) {
          return {
            valid: false,
            message: `Answer must be at least ${field.validation.minLength} characters.`,
          };
        }
        if (field.validation?.maxLength && trimmedAnswer.length > field.validation.maxLength) {
          return {
            valid: false,
            message: `Answer must be at most ${field.validation.maxLength} characters.`,
          };
        }
        return { valid: true, value: trimmedAnswer };

      case 'number':
        const numValue = parseFloat(trimmedAnswer);
        if (isNaN(numValue)) {
          return { valid: false, message: 'Please enter a valid number.' };
        }
        if (field.validation?.min !== undefined && numValue < field.validation.min) {
          return { valid: false, message: `Number must be at least ${field.validation.min}.` };
        }
        if (field.validation?.max !== undefined && numValue > field.validation.max) {
          return { valid: false, message: `Number must be at most ${field.validation.max}.` };
        }
        return { valid: true, value: numValue };

      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedAnswer)) {
          return { valid: false, message: 'Please enter a valid email address.' };
        }
        return { valid: true, value: trimmedAnswer.toLowerCase() };

      case 'phone':
        // Accept various phone formats
        const phoneRegex = /^[\d\s\-\+\(\)]{7,20}$/;
        if (!phoneRegex.test(trimmedAnswer)) {
          return { valid: false, message: 'Please enter a valid phone number.' };
        }
        return { valid: true, value: trimmedAnswer.replace(/[\s\-\(\)]/g, '') };

      case 'select':
        if (field.options && !field.options.includes(trimmedAnswer)) {
          return {
            valid: false,
            message: `Please select one of: ${field.options.join(', ')}`,
          };
        }
        return { valid: true, value: trimmedAnswer };

      case 'multiselect':
        // Split by comma or space
        const values = trimmedAnswer.split(/[,\s]+/).filter(Boolean);
        const invalidValues = values.filter((v) => field.options && !field.options.includes(v));
        if (invalidValues.length > 0) {
          return {
            valid: false,
            message: `Invalid selections: ${invalidValues.join(', ')}. Options: ${field.options?.join(', ')}`,
          };
        }
        return { valid: true, value: values };

      case 'date':
        const dateValue = new Date(trimmedAnswer);
        if (isNaN(dateValue.getTime())) {
          return { valid: false, message: 'Please enter a valid date (e.g., 1990-01-15).' };
        }
        return { valid: true, value: dateValue.toISOString().split('T')[0] };

      case 'file':
        // For file type, we expect a URL or file ID
        return { valid: true, value: trimmedAnswer };

      default:
        return { valid: true, value: trimmedAnswer };
    }
  }

  /**
   * Submit completed form
   */
  static async submitForm(
    phoneNumber: string,
    formId: string,
    data: Record<string, any>,
    whatsappJid: string,
  ): Promise<{ success: boolean; submissionId?: string }> {
    try {
      const submission = new FormSubmission({
        formId,
        phoneNumber,
        whatsappJid,
        data,
        status: 'new',
      });

      await submission.save();
      console.log(`✅ [FormService] Form submitted for ${phoneNumber}`);

      return { success: true, submissionId: (submission._id as any).toString() };
    } catch (error) {
      console.error('❌ [FormService] Error submitting form:', error);
      return { success: false };
    }
  }

  /**
   * Cancel a form session
   */
  static async cancelFormSession(phoneNumber: string): Promise<boolean> {
    return sessionStateService.deleteSession(phoneNumber, 'form');
  }

  /**
   * Get field prompt message
   */
  static getFieldPrompt(field: FormField): string {
    let prompt = `*${field.label}*`;

    if (field.type === 'select' && field.options) {
      prompt += `\nOptions: ${field.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
    } else if (field.type === 'multiselect' && field.options) {
      prompt += `\nOptions: ${field.options.join(', ')}`;
      prompt += `\n(You can select multiple, separated by commas)`;
    }

    if (field.placeholder) {
      prompt += `\n_Example: ${field.placeholder}_`;
    }

    if (field.required) {
      prompt += ' *(required)*';
    }

    return prompt;
  }

  /**
   * Clean up expired form sessions (now handled by MongoDB TTL index)
   */
  static async cleanupExpiredSessions(): Promise<number> {
    return sessionStateService.cleanupExpiredSessions();
  }

  /**
   * Check if auto-registration should be triggered
   */
  static async shouldTriggerAutoForm(
    phoneNumber: string,
    triggerMode: 'manual' | 'auto' | 'both',
  ): Promise<boolean> {
    // Don't trigger if user has active session
    if (await this.hasActiveFormSession(phoneNumber)) {
      return false;
    }

    // Check if there's an active form with auto trigger
    if (triggerMode !== 'auto' && triggerMode !== 'both') {
      return false;
    }

    // Check if user has already submitted a form recently
    const FormSubmission = (await import('../models/FormSubmission')).default;
    const recentSubmission = await FormSubmission.findOne({
      phoneNumber,
      submittedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    });

    if (recentSubmission) {
      return false;
    }

    return true;
  }

  /**
   * Get session count for monitoring
   */
  static async getActiveSessionCount(): Promise<number> {
    return sessionStateService.getSessionCount('form');
  }
}

export default FormService;