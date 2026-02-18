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

class ApiService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = API_KEY;
    this.baseUrl = API_BASE_URL;

    if (!this.apiKey || this.apiKey === 'your-api-key-here') {
      console.warn('⚠️ API_KEY not configured. Set VITE_API_KEY in .env file');
    }
  }

  async predict(sensorData: SensorData): Promise<PredictionResponse> {
    try {
      console.log(`Sending ${sensorData.flex_sensors.length} samples to API`);
      console.log('First sample:', JSON.stringify(sensorData.flex_sensors[0]));
      console.log('Last sample:', JSON.stringify(sensorData.flex_sensors[sensorData.flex_sensors.length - 1]));
      console.log('Device ID:', sensorData.device_id);
      
      // Log sample statistics
      const avgCh0 = sensorData.flex_sensors.reduce((sum, s) => sum + s[0], 0) / sensorData.flex_sensors.length;
      const avgCh1 = sensorData.flex_sensors.reduce((sum, s) => sum + s[1], 0) / sensorData.flex_sensors.length;
      console.log('Avg CH0:', Math.round(avgCh0), 'Avg CH1:', Math.round(avgCh1));
      
      const response = await fetch(`${this.baseUrl}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(sensorData),
      });

      if (!response.ok) {
        // Handle specific error codes
        if (response.status === 401) {
          throw new Error('Missing API Key. Configure VITE_API_KEY in .env');
        }
        if (response.status === 403) {
          throw new Error('Invalid API Key. Check your .env configuration');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment');
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
      throw error;
    }
  }

  async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
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
      console.error('API health check error:', error);
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
   * Get current API base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export default new ApiService();

