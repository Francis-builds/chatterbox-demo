/**
 * Modal TTS Client
 *
 * Client for communicating with the Modal GPU backend for TTS generation.
 */

const MODAL_TTS_URL = process.env.MODAL_TTS_URL || 'https://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run';

export interface TTSRequest {
  text: string;
  language_id?: string;
  audio_prompt_url?: string;
  temperature?: number;
  interaction_id?: string;
}

export interface TTSStreamResponse {
  type: 'status' | 'audio' | 'error';
  status?: 'generating' | 'complete' | 'error';
  audio?: string;  // Base64 encoded PCM16 audio
  message?: string;
  chunks_sent?: number;
}

/**
 * Generate TTS audio via HTTP (non-streaming, full audio)
 */
export async function generateTTSFull(request: TTSRequest): Promise<ArrayBuffer> {
  const response = await fetch(`${MODAL_TTS_URL}/api/tts/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`TTS generation failed: ${response.statusText}`);
  }

  return response.arrayBuffer();
}

/**
 * Create WebSocket connection for streaming TTS
 */
export function createTTSWebSocket(): WebSocket {
  const wsUrl = MODAL_TTS_URL.replace('https://', 'wss://').replace('http://', 'ws://');
  return new WebSocket(`${wsUrl}/ws/tts`);
}

/**
 * Create WebSocket connection for bot-voice compatible endpoint
 */
export function createBotVoiceWebSocket(): WebSocket {
  const wsUrl = MODAL_TTS_URL.replace('https://', 'wss://').replace('http://', 'ws://');
  return new WebSocket(`${wsUrl}/talk`);
}

/**
 * Health check for Modal backend
 */
export async function checkModalHealth(): Promise<{ status: string; latency_ms: number }> {
  const start = Date.now();

  try {
    const response = await fetch(`${MODAL_TTS_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const latency_ms = Date.now() - start;

    if (!response.ok) {
      return { status: 'unhealthy', latency_ms };
    }

    return { status: 'healthy', latency_ms };
  } catch (error) {
    return { status: 'unreachable', latency_ms: Date.now() - start };
  }
}

/**
 * Get the Modal WebSocket URL for direct client connection
 * This is used when clients want to bypass Vercel and connect directly to Modal
 */
export function getModalWebSocketURL(endpoint: 'tts' | 'talk' = 'tts'): string {
  const wsUrl = MODAL_TTS_URL.replace('https://', 'wss://').replace('http://', 'ws://');
  return endpoint === 'talk' ? `${wsUrl}/talk` : `${wsUrl}/ws/tts`;
}
