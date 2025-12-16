import { NextRequest, NextResponse } from 'next/server';
import { getModalWebSocketURL } from '@/lib/modal-client';
import { SUPPORTED_LANGUAGES, LATIN_AMERICAN_VOICES } from '@/lib/types';

export const runtime = 'edge';

const MODAL_TTS_URL = process.env.MODAL_TTS_URL || 'https://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run';

/**
 * TTS Generation endpoint
 *
 * POST /api/tts
 *
 * For minimum TTFB, clients should connect directly to the Modal WebSocket.
 * This endpoint provides:
 * 1. The WebSocket URL for direct streaming connection
 * 2. A fallback HTTP endpoint for non-streaming generation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      text,
      language_id = 'es',
      voice_id,
      audio_prompt_url,
      temperature = 0.8,
      streaming = true,
      interaction_id,
    } = body;

    if (!text) {
      return NextResponse.json(
        { error: 'Missing required field: text' },
        { status: 400 }
      );
    }

    // Validate language
    if (!(language_id in SUPPORTED_LANGUAGES)) {
      return NextResponse.json(
        { error: `Unsupported language: ${language_id}` },
        { status: 400 }
      );
    }

    // Resolve voice configuration
    let resolvedAudioPrompt = audio_prompt_url;
    if (voice_id && !audio_prompt_url) {
      const voice = LATIN_AMERICAN_VOICES.find(v => v.id === voice_id);
      if (voice?.audio_prompt_url) {
        resolvedAudioPrompt = voice.audio_prompt_url;
      }
    }

    if (streaming) {
      // Return WebSocket URL for streaming (minimum TTFB)
      const wsUrl = getModalWebSocketURL('tts');

      return NextResponse.json({
        mode: 'streaming',
        websocket_url: wsUrl,
        connection_params: {
          type: 'synthesize',
          text,
          language_id,
          audio_prompt_url: resolvedAudioPrompt,
          temperature,
          interaction_id: interaction_id || `tts-${Date.now()}`,
        },
        instructions: 'Connect to websocket_url and send connection_params as JSON message to start streaming',
        audio_format: {
          type: 'pcm16',
          sample_rate: 24000,
          channels: 1,
        },
      });
    }

    // Non-streaming: proxy to Modal HTTP endpoint
    const response = await fetch(`${MODAL_TTS_URL}/api/tts/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        language_id,
        audio_prompt_url: resolvedAudioPrompt,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: 'TTS generation failed', details: errorText },
        { status: response.status }
      );
    }

    // Return audio file
    const audioBuffer = await response.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tts
 *
 * Returns information about the TTS service and available endpoints
 */
export async function GET() {
  return NextResponse.json({
    service: 'Chatterbox TTS Streaming',
    version: '1.0.0',
    endpoints: {
      streaming_websocket: {
        url: getModalWebSocketURL('tts'),
        description: 'Direct WebSocket for minimum TTFB streaming audio',
        protocol: 'WebSocket',
      },
      bot_voice_websocket: {
        url: getModalWebSocketURL('talk'),
        description: 'WebSocket compatible with bot-voice /talk protocol',
        protocol: 'WebSocket',
      },
      http_tts: {
        url: '/api/tts',
        method: 'POST',
        description: 'HTTP endpoint for TTS generation (streaming or full)',
      },
    },
    supported_languages: Object.keys(SUPPORTED_LANGUAGES),
    audio_format: {
      streaming: {
        type: 'pcm16',
        sample_rate: 24000,
        channels: 1,
        description: 'Raw PCM16 audio chunks for minimum latency',
      },
      full: {
        type: 'wav',
        sample_rate: 24000,
        channels: 1,
        description: 'Complete WAV audio file',
      },
    },
    latency_optimization: {
      recommended: 'Use streaming WebSocket for minimum TTFB',
      direct_connection: 'Connect directly to Modal WebSocket to bypass Vercel middleware',
      first_audio_chunk: '~400ms after request (10 speech tokens)',
      subsequent_chunks: '~600ms each (15 speech tokens)',
    },
  });
}
