/**
 * Autoresearch NLP Service
 * Connects to the FastAPI inference server for intent classification
 * Optimized for WhatsApp bot with trilingual support (Sinhala, Tamil, English)
 */

import fetch from 'node-fetch';

// Configuration - All configurable via environment variables
const NLP_SERVER_URL = process.env.NLP_SERVER_URL || 'http://localhost:8001';
const INFERENCE_TIMEOUT_MS = parseInt(process.env.NLP_INFERENCE_TIMEOUT_MS || '500', 10); // 500ms default
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.NLP_HEALTH_CHECK_INTERVAL_MS || '30000', 10); // 30 seconds
const HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.NLP_HEALTH_CHECK_TIMEOUT_MS || '3000', 10); // 3 seconds

// Intent types
export type Intent =
  | 'booking'
  | 'lead_register'
  | 'greeting'
  | 'help'
  | 'query'
  | 'command'
  | 'unknown';

// Response interfaces
export interface PredictResponse {
  intent: Intent;
  confidence: number;
  language?: string;
  inference_time_ms: number;
}

export interface HealthResponse {
  status: string;
  model_loaded: boolean;
  model_path?: string;
  model_size_mb?: number;
  device: string;
  last_reload?: string;
}

export interface BatchPredictResult {
  text: string;
  intent: Intent;
  confidence: number;
  language?: string;
}

export interface BatchPredictResponse {
  results: BatchPredictResult[];
  total_inference_time_ms: number;
  avg_inference_time_ms: number;
}

// Fallback intents for when server is unavailable
const FALLBACK_INTENTS: Record<string, Intent> = {
  // Greetings
  'hello': 'greeting',
  'hi': 'greeting',
  'hey': 'greeting',
  'good morning': 'greeting',
  'good evening': 'greeting',
  'ayubowan': 'greeting', // Sinhala
  'vanakkam': 'greeting', // Tamil

  // Help
  'help': 'help',
  'help me': 'help',
  'support': 'help',
  'madatha': 'help', // Sinhala

  // Booking
  'book': 'booking',
  'appointment': 'booking',
  'visit': 'booking',
  'schedule': 'booking',
  'tomorrow': 'booking',
  'today': 'booking',
  'පැමිණ': 'booking', // Sinhala - visit
  'හමුවීම': 'booking', // Sinhala - meeting

  // Lead Registration - DISABLED for NLP routing
  // Forms should ONLY trigger via !register command in index.ts
  // 'register': 'lead_register',  // DISABLED
  // 'signup': 'lead_register',    // DISABLED
  // 'ලියාපදිංචි': 'lead_register', // DISABLED
  // These keywords are too common in normal conversations and cause false positives

  // Commands
  '!help': 'command',
  '!status': 'command',
  '!reset': 'command',
  '!profile': 'command',
};

// Language detection patterns
const SINHALA_CHARS = /[\u0D80-\u0DFF]/;
const TAMIL_CHARS = /[\u0B80-\u0BFF]/;

/**
 * Detect language from text
 */
export function detectLanguage(text: string): 'sinhala' | 'tamil' | 'english' | 'unknown' {
  if (SINHALA_CHARS.test(text)) return 'sinhala';
  if (TAMIL_CHARS.test(text)) return 'tamil';
  if (/^[a-zA-Z0-9\s\p{P}]+$/u.test(text)) return 'english';
  return 'unknown';
}

/**
 * Fallback intent classification using keyword matching
 */
function fallbackClassification(text: string): PredictResponse {
  const lowerText = text.toLowerCase().trim();

  // Check for exact matches
  if (FALLBACK_INTENTS[lowerText]) {
    return {
      intent: FALLBACK_INTENTS[lowerText],
      confidence: 0.7,
      language: detectLanguage(text),
      inference_time_ms: 0,
    };
  }

  // Check for partial matches
  for (const [keyword, intent] of Object.entries(FALLBACK_INTENTS)) {
    if (lowerText.includes(keyword)) {
      return {
        intent,
        confidence: 0.6,
        language: detectLanguage(text),
        inference_time_ms: 0,
      };
    }
  }

  // Default to query
  return {
    intent: 'query',
    confidence: 0.5,
    language: detectLanguage(text),
    inference_time_ms: 0,
  };
}

/**
 * Autoresearch NLP Service class
 */
export class AutoresearchNLPService {
  private static instance: AutoresearchNLPService;
  private serverHealthy = false;
  private lastHealthCheck = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Start periodic health checks
    this.startHealthChecks();
  }

  public static getInstance(): AutoresearchNLPService {
    if (!AutoresearchNLPService.instance) {
      AutoresearchNLPService.instance = new AutoresearchNLPService();
    }
    return AutoresearchNLPService.instance;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    // Clear existing interval if any
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);

    // Initial check
    this.checkHealth();
  }

  /**
   * Check if inference server is healthy
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(`${NLP_SERVER_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as HealthResponse;
        this.serverHealthy = data.model_loaded;
        this.lastHealthCheck = Date.now();
        return this.serverHealthy;
      }

      this.serverHealthy = false;
      return false;
    } catch (error) {
      this.serverHealthy = false;
      return false;
    }
  }

  /**
   * Check if server is available
   */
  public isServerAvailable(): boolean {
    return this.serverHealthy;
  }

  /**
   * Get the NLP server URL
   */
  public getServerUrl(): string {
    return NLP_SERVER_URL;
  }

  /**
   * Classify message intent using inference server
   */
  public async classifyMessage(
    text: string,
    returnConfidence = true,
  ): Promise<PredictResponse> {
    // If server is not healthy, use fallback
    if (!this.serverHealthy) {
      console.log('[AutoresearchNLP] Server unavailable, using fallback classification');
      return fallbackClassification(text);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

      const response = await fetch(`${NLP_SERVER_URL}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          return_confidence: returnConfidence,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = (await response.json()) as PredictResponse;

      console.log(
        `[AutoresearchNLP] Classified: "${text.substring(0, 30)}..." → ${result.intent} (${result.confidence.toFixed(2)}) in ${result.inference_time_ms}ms`,
      );

      return result;
    } catch (error: any) {
      console.error('[AutoresearchNLP] Inference error:', error.message);

      // Mark server as unhealthy
      this.serverHealthy = false;

      // Use fallback
      return fallbackClassification(text);
    }
  }

  /**
   * Batch classify multiple messages
   */
  public async batchClassify(texts: string[]): Promise<BatchPredictResult[]> {
    if (!this.serverHealthy) {
      console.log('[AutoresearchNLP] Server unavailable, using fallback batch classification');
      return texts.map((text) => ({
        text,
        ...fallbackClassification(text),
      }));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS * texts.length);

      const response = await fetch(`${NLP_SERVER_URL}/batch_predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(texts),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = (await response.json()) as BatchPredictResponse;

      console.log(
        `[AutoresearchNLP] Batch classified ${texts.length} messages in ${result.total_inference_time_ms}ms`,
      );

      return result.results;
    } catch (error: any) {
      console.error('[AutoresearchNLP] Batch inference error:', error.message);
      this.serverHealthy = false;

      return texts.map((text) => ({
        text,
        ...fallbackClassification(text),
      }));
    }
  }

  /**
   * Reload model after training
   */
  public async reloadModel(): Promise<boolean> {
    try {
      const response = await fetch(`${NLP_SERVER_URL}/reload`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = (await response.json()) as { message: string };
      console.log('[AutoresearchNLP] Model reload:', result.message);

      // Re-check health after reload
      await this.checkHealth();

      return this.serverHealthy;
    } catch (error: any) {
      console.error('[AutoresearchNLP] Model reload error:', error.message);
      return false;
    }
  }

  /**
   * Get list of available intents
   */
  public async getIntentLabels(): Promise<string[]> {
    try {
      const response = await fetch(`${NLP_SERVER_URL}/intents`);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = (await response.json()) as { intents: string[] };
      return data.intents;
    } catch (error) {
      return ['booking', 'lead_register', 'greeting', 'help', 'query', 'command', 'unknown'];
    }
  }

  /**
   * Get server health status
   */
  public async getServerHealth(): Promise<HealthResponse | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(`${NLP_SERVER_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as HealthResponse;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get service status info
   */
  public getStatus(): {
    serverUrl: string;
    serverHealthy: boolean;
    lastHealthCheck: string | null;
    inferenceTimeoutMs: number;
  } {
    return {
      serverUrl: NLP_SERVER_URL,
      serverHealthy: this.serverHealthy,
      lastHealthCheck: this.lastHealthCheck ? new Date(this.lastHealthCheck).toISOString() : null,
      inferenceTimeoutMs: INFERENCE_TIMEOUT_MS,
    };
  }
}

// Export singleton instance
export const autoresearchNLP = AutoresearchNLPService.getInstance();

// Convenience function
export async function classifyMessage(text: string): Promise<PredictResponse> {
  return autoresearchNLP.classifyMessage(text);
}

export default autoresearchNLP;