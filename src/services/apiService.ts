/**
 * API Service for ASL Recognition
 * Handles communication with the cloud-based prediction API
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.ybilgin.com';
const API_KEY = import.meta.env.VITE_API_KEY || '';

// Debug: Log API key status on load
console.log('[apiService] API_BASE_URL:', API_BASE_URL);
console.log('[apiService] API_KEY configured:', !!API_KEY && API_KEY !== 'your-api-key-here');
if (!API_KEY || API_KEY === 'your-api-key-here') {
  console.warn('[apiService] ⚠️ API_KEY not configured!');
}

export interface SensorData {
  flex_sensors: number[][];
  imu?: [number, number, number, number]; // [w, x, y, z] — for stage-2 IMU disambiguation
  device_id?: string;
}

export interface PredictionResponse {
  letter: string;
  confidence: number;
  all_probabilities: Record<string, number>;
  processing_time_ms: number;
  model_name: string;
  timestamp: number;
}

export interface HealthResponse {
  status: string;
  model_loaded: boolean;
  model_name: string;
  database_connected: boolean;
  uptime_seconds: number;
  authentication_enabled?: boolean;
}

const LOCAL_MODEL_URL = 'http://localhost:8765';

class ApiService {
  private apiKey: string;
  private baseUrl: string;
  private useLocalModel: boolean = false;

  constructor() {
    this.apiKey = API_KEY;
    this.baseUrl = API_BASE_URL;

    if (!this.apiKey || this.apiKey === 'your-api-key-here') {
      console.warn('⚠️ API_KEY not configured. Set VITE_API_KEY in .env file');
    }
  }

  /** Toggle dev mode: use local model instead of cloud API */
  setUseLocalModel(use: boolean): void {
    this.useLocalModel = use;
    console.log(`[apiService] Use local model: ${use}`);
  }

  getUseLocalModel(): boolean {
    return this.useLocalModel;
  }

  private getEffectiveBaseUrl(): string {
    return this.useLocalModel ? LOCAL_MODEL_URL : this.baseUrl;
  }

  async predict(sensorData: SensorData): Promise<PredictionResponse> {
    try {
      const url = this.getEffectiveBaseUrl();
      console.log(`Sending ${sensorData.flex_sensors.length} samples to ${this.useLocalModel ? 'LOCAL' : 'API'}`);
      console.log('First sample:', JSON.stringify(sensorData.flex_sensors[0]));
      console.log('Last sample:', JSON.stringify(sensorData.flex_sensors[sensorData.flex_sensors.length - 1]));
      console.log('Device ID:', sensorData.device_id);
      
      // Log sample statistics
      const avgCh0 = sensorData.flex_sensors.reduce((sum, s) => sum + s[0], 0) / sensorData.flex_sensors.length;
      const avgCh1 = sensorData.flex_sensors.reduce((sum, s) => sum + s[1], 0) / sensorData.flex_sensors.length;
      console.log('Avg CH0:', Math.round(avgCh0), 'Avg CH1:', Math.round(avgCh1));
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (!this.useLocalModel) {
        headers['X-API-Key'] = this.apiKey;
      }

      const response = await fetch(`${url}/predict`, {
        method: 'POST',
        headers,
        body: JSON.stringify(sensorData),
      });

      if (!response.ok) {
        if (!this.useLocalModel) {
          if (response.status === 401) {
            throw new Error('Missing API Key. Configure VITE_API_KEY in .env');
          }
          if (response.status === 403) {
            throw new Error('Invalid API Key. Check your .env configuration');
          }
          if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment');
          }
        }
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `API error: ${response.status}`);
      }

      const result: PredictionResponse = await response.json();
      
      console.log('API Response:', result.letter, 'Confidence:', result.confidence);
      console.log('All probabilities:', JSON.stringify(result.all_probabilities));
      return result;
    } catch (error) {
      console.error('API prediction error:', error);
      if (this.useLocalModel && error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
        throw new Error('Local model server not running. Run: cd iot-sign-glove && python scripts/serve_local_model.py');
      }
      throw error;
    }
  }

  async checkHealth(silent = false): Promise<HealthResponse> {
    try {
      const response = await fetch(`${this.getEffectiveBaseUrl()}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('API health check failed');
      }

      return await response.json();
    } catch (error) {
      if (!silent) console.error('API health check error:', error);
      throw new Error('API health check failed');
    }
  }

  /**
   * Check if API is configured with a valid key
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== 'your-api-key-here';
  }

  /**
   * Get current API base URL (or local URL when dev mode)
   */
  getBaseUrl(): string {
    return this.getEffectiveBaseUrl();
  }
}

export default new ApiService();

