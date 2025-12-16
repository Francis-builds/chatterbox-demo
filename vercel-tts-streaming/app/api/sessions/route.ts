import { NextRequest, NextResponse } from 'next/server';
import { getModalWebSocketURL } from '@/lib/modal-client';
import { Session, LATIN_AMERICAN_VOICES } from '@/lib/types';

export const runtime = 'edge';

// In-memory session store (in production, use Redis or similar)
// Note: This won't persist across serverless invocations
// For production, use Vercel KV, Redis, or similar
const sessions = new Map<string, Session>();

/**
 * Sessions endpoint
 *
 * POST /api/sessions - Create a new session
 * GET /api/sessions/:id - Get session details
 * DELETE /api/sessions/:id - End session
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      interaction_id,
      bot_name,
      voice_id,
      language_id = 'es',
      audio_prompt_url,
      tarea = {},
    } = body;

    if (!interaction_id) {
      return NextResponse.json(
        { error: 'Missing required field: interaction_id' },
        { status: 400 }
      );
    }

    // Resolve voice configuration
    let voiceConfig = LATIN_AMERICAN_VOICES.find(v => v.id === voice_id);
    if (!voiceConfig) {
      voiceConfig = LATIN_AMERICAN_VOICES.find(v => v.id === 'es-default') || {
        id: 'custom',
        name: 'Custom Voice',
        language_id,
        description: 'Custom voice configuration',
        audio_prompt_url,
        default_temperature: 0.8,
      };
    }

    // Override audio prompt if provided
    if (audio_prompt_url) {
      voiceConfig = { ...voiceConfig, audio_prompt_url };
    }

    const session: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      interaction_id,
      bot_name: bot_name || 'tts-bot',
      voice_config: voiceConfig,
      tarea,
      created_at: Date.now(),
      last_activity: Date.now(),
      status: 'active',
    };

    sessions.set(session.id, session);

    return NextResponse.json({
      session,
      websocket_endpoints: {
        tts_streaming: getModalWebSocketURL('tts'),
        bot_voice_compatible: getModalWebSocketURL('talk'),
      },
      instructions: {
        for_minimum_ttfb: 'Connect directly to tts_streaming WebSocket',
        for_bot_voice_integration: 'Connect to bot_voice_compatible WebSocket and use the standard bot-voice protocol',
      },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('id');
  const interactionId = searchParams.get('interaction_id');

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ session });
  }

  if (interactionId) {
    const session = Array.from(sessions.values()).find(s => s.interaction_id === interactionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ session });
  }

  // Return all active sessions
  const activeSessions = Array.from(sessions.values())
    .filter(s => s.status === 'active')
    .map(s => ({
      id: s.id,
      interaction_id: s.interaction_id,
      bot_name: s.bot_name,
      status: s.status,
      created_at: s.created_at,
    }));

  return NextResponse.json({
    sessions: activeSessions,
    total: activeSessions.length,
  });
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('id');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing session id' },
      { status: 400 }
    );
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }

  session.status = 'closed';
  sessions.set(sessionId, session);

  return NextResponse.json({
    message: 'Session closed',
    session_id: sessionId,
  });
}
