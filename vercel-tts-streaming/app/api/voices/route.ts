import { NextRequest, NextResponse } from 'next/server';
import { LATIN_AMERICAN_VOICES, SUPPORTED_LANGUAGES, VoiceConfig } from '@/lib/types';

export const runtime = 'edge';

/**
 * Voices endpoint
 *
 * GET /api/voices
 * Returns all available voices
 *
 * GET /api/voices?language=es
 * Returns voices filtered by language
 *
 * GET /api/voices?region=mx
 * Returns voices filtered by region
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const language = searchParams.get('language');
  const region = searchParams.get('region');

  let voices: VoiceConfig[] = [...LATIN_AMERICAN_VOICES];

  // Filter by language
  if (language) {
    voices = voices.filter(v => v.language_id === language);
  }

  // Filter by region
  if (region) {
    voices = voices.filter(v => v.region === region);
  }

  return NextResponse.json({
    voices,
    supported_languages: SUPPORTED_LANGUAGES,
    total: voices.length,
  });
}

/**
 * POST /api/voices
 * Register a custom voice with reference audio
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { name, language_id, region, description, audio_prompt_url } = body;

    if (!name || !language_id) {
      return NextResponse.json(
        { error: 'Missing required fields: name, language_id' },
        { status: 400 }
      );
    }

    // Validate language
    if (!(language_id in SUPPORTED_LANGUAGES)) {
      return NextResponse.json(
        { error: `Unsupported language: ${language_id}. Supported: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}` },
        { status: 400 }
      );
    }

    // In a production system, you would save this to a database
    // For now, we return the voice config that would be created
    const voiceConfig: VoiceConfig = {
      id: `custom-${Date.now()}`,
      name,
      language_id,
      region,
      description: description || `Custom ${name} voice`,
      audio_prompt_url,
      default_temperature: 0.8,
    };

    return NextResponse.json({
      message: 'Voice configuration created',
      voice: voiceConfig,
      note: 'To use Latin American accents, provide reference audio from speakers of that region via audio_prompt_url',
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}
