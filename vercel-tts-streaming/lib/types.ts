/**
 * Type definitions for the Chatterbox TTS Streaming API
 */

// Voice configuration for different regions/accents
export interface VoiceConfig {
  id: string;
  name: string;
  language_id: string;
  region?: string;  // e.g., "mx" for Mexico, "ar" for Argentina
  description: string;
  audio_prompt_url?: string;  // Reference audio for voice cloning
  default_temperature?: number;
  default_exaggeration?: number;
}

// Session state
export interface Session {
  id: string;
  interaction_id: string;
  bot_name: string;
  voice_config: VoiceConfig;
  tarea: Record<string, unknown>;
  created_at: number;
  last_activity: number;
  status: 'active' | 'idle' | 'closed';
}

// TTS Request from bot-voice
export interface BotVoiceRequest {
  InteractionId: string;
  BotName: string;
  EventName: '*online' | '*text' | '*noresponse' | '*offline' | '*transfer';
  Message?: string;
  Tarea?: Record<string, unknown> | number;
}

// TTS Response to bot-voice
export interface BotVoiceResponse {
  InteractionId: string;
  BotName: string;
  EventName: string;
  Tarea?: Record<string, unknown>;
  Voice?: {
    language_id: string;
    sample_rate: number;
    format: string;
  };
  Events: Array<{
    name: string;
    message?: string;
    audio?: string;  // Base64 encoded audio for *audio events
    format?: string;
    sample_rate?: number;
  }>;
}

// Supported languages
export const SUPPORTED_LANGUAGES = {
  'ar': 'Arabic',
  'da': 'Danish',
  'de': 'German',
  'el': 'Greek',
  'en': 'English',
  'es': 'Spanish',
  'fi': 'Finnish',
  'fr': 'French',
  'he': 'Hebrew',
  'hi': 'Hindi',
  'it': 'Italian',
  'ja': 'Japanese',
  'ko': 'Korean',
  'ms': 'Malay',
  'nl': 'Dutch',
  'no': 'Norwegian',
  'pl': 'Polish',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'sv': 'Swedish',
  'sw': 'Swahili',
  'tr': 'Turkish',
  'zh': 'Chinese',
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

// Pre-configured voices for Latin American Spanish
export const LATIN_AMERICAN_VOICES: VoiceConfig[] = [
  {
    id: 'es-mx-female-1',
    name: 'María (México)',
    language_id: 'es',
    region: 'mx',
    description: 'Female voice with Mexican Spanish accent',
    audio_prompt_url: undefined,  // To be configured with reference audio
    default_temperature: 0.8,
  },
  {
    id: 'es-mx-male-1',
    name: 'Carlos (México)',
    language_id: 'es',
    region: 'mx',
    description: 'Male voice with Mexican Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  {
    id: 'es-ar-female-1',
    name: 'Lucía (Argentina)',
    language_id: 'es',
    region: 'ar',
    description: 'Female voice with Argentine Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  {
    id: 'es-ar-male-1',
    name: 'Martín (Argentina)',
    language_id: 'es',
    region: 'ar',
    description: 'Male voice with Argentine Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  {
    id: 'es-co-female-1',
    name: 'Valentina (Colombia)',
    language_id: 'es',
    region: 'co',
    description: 'Female voice with Colombian Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  {
    id: 'es-co-male-1',
    name: 'Andrés (Colombia)',
    language_id: 'es',
    region: 'co',
    description: 'Male voice with Colombian Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  {
    id: 'es-cl-female-1',
    name: 'Francisca (Chile)',
    language_id: 'es',
    region: 'cl',
    description: 'Female voice with Chilean Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  {
    id: 'es-cl-male-1',
    name: 'Sebastián (Chile)',
    language_id: 'es',
    region: 'cl',
    description: 'Male voice with Chilean Spanish accent',
    audio_prompt_url: undefined,
    default_temperature: 0.8,
  },
  // Default Spanish voice (neutral)
  {
    id: 'es-default',
    name: 'Default Spanish',
    language_id: 'es',
    region: undefined,
    description: 'Default Spanish voice (neutral accent)',
    audio_prompt_url: 'https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/es_f1.flac',
    default_temperature: 0.8,
  },
];

// API Error response
export interface ApiError {
  error: string;
  message: string;
  code?: string;
}
