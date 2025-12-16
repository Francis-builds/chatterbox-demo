/**
 * Voice Samples Configuration for Latin American Spanish
 *
 * To achieve authentic Latin American accents, you need to provide
 * reference audio files from native speakers of each region.
 *
 * Chatterbox uses voice cloning - it captures the voice characteristics
 * and accent from the reference audio and applies them to generated speech.
 *
 * IMPORTANT: The model uses a single "es" (Spanish) language code.
 * Regional accents (Mexican, Argentine, etc.) are achieved through
 * the reference audio, not through language codes.
 */

export interface VoiceSample {
  id: string;
  name: string;
  region: 'mx' | 'ar' | 'co' | 'cl' | 'es';  // Mexico, Argentina, Colombia, Chile, Spain
  gender: 'male' | 'female';
  description: string;

  // URL to reference audio file (WAV or FLAC, minimum 5 seconds)
  // Should be a native speaker of the target region
  audio_url: string;

  // Sample text in the same voice/accent for verification
  sample_text?: string;
}

/**
 * Pre-configured voice samples
 *
 * Replace these placeholder URLs with actual audio files from your
 * voice talent or licensed voice samples.
 *
 * Requirements for reference audio:
 * - Format: WAV or FLAC
 * - Duration: Minimum 5 seconds (10-15 seconds recommended)
 * - Quality: Clear recording, minimal background noise
 * - Content: Native speaker of the target region/accent
 */
export const VOICE_SAMPLES: VoiceSample[] = [
  // Mexican Spanish Voices
  {
    id: 'es-mx-female-maria',
    name: 'María',
    region: 'mx',
    gender: 'female',
    description: 'Professional female voice with Mexican Spanish accent',
    audio_url: 'YOUR_AUDIO_URL_HERE',  // Replace with actual URL
    sample_text: 'Hola, bienvenido a nuestro servicio de atención al cliente.',
  },
  {
    id: 'es-mx-male-carlos',
    name: 'Carlos',
    region: 'mx',
    gender: 'male',
    description: 'Professional male voice with Mexican Spanish accent',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Buenos días, ¿en qué puedo ayudarle el día de hoy?',
  },

  // Argentine Spanish Voices
  {
    id: 'es-ar-female-lucia',
    name: 'Lucía',
    region: 'ar',
    gender: 'female',
    description: 'Professional female voice with Argentine Spanish accent (Rioplatense)',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Hola, ¿cómo estás? Soy tu asistente virtual.',
  },
  {
    id: 'es-ar-male-martin',
    name: 'Martín',
    region: 'ar',
    gender: 'male',
    description: 'Professional male voice with Argentine Spanish accent (Rioplatense)',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Buen día, te cuento lo que necesitás saber.',
  },

  // Colombian Spanish Voices
  {
    id: 'es-co-female-valentina',
    name: 'Valentina',
    region: 'co',
    gender: 'female',
    description: 'Professional female voice with Colombian Spanish accent',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Hola, es un placer atenderte. ¿En qué te puedo colaborar?',
  },
  {
    id: 'es-co-male-andres',
    name: 'Andrés',
    region: 'co',
    gender: 'male',
    description: 'Professional male voice with Colombian Spanish accent',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Buenos días, estoy aquí para ayudarte con lo que necesites.',
  },

  // Chilean Spanish Voices
  {
    id: 'es-cl-female-francisca',
    name: 'Francisca',
    region: 'cl',
    gender: 'female',
    description: 'Professional female voice with Chilean Spanish accent',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Hola, ¿cómo estai? Soy tu asistente.',
  },
  {
    id: 'es-cl-male-sebastian',
    name: 'Sebastián',
    region: 'cl',
    gender: 'male',
    description: 'Professional male voice with Chilean Spanish accent',
    audio_url: 'YOUR_AUDIO_URL_HERE',
    sample_text: 'Buenas, te ayudo altiro con lo que necesites.',
  },
];

/**
 * Get voices by region
 */
export function getVoicesByRegion(region: string): VoiceSample[] {
  return VOICE_SAMPLES.filter(v => v.region === region);
}

/**
 * Get voice by ID
 */
export function getVoiceById(id: string): VoiceSample | undefined {
  return VOICE_SAMPLES.find(v => v.id === id);
}

/**
 * Instructions for recording reference audio
 */
export const RECORDING_GUIDELINES = `
# Guidelines for Recording Reference Audio

To create authentic Latin American voices, record native speakers following these guidelines:

## Technical Requirements
- Format: WAV (preferred) or FLAC
- Sample rate: 16kHz or higher (24kHz recommended)
- Bit depth: 16-bit or higher
- Duration: 10-15 seconds of continuous speech
- Minimum: 5 seconds

## Recording Environment
- Quiet room with minimal background noise
- No echo or reverb
- Consistent microphone distance
- Pop filter recommended

## Content Guidelines
- Natural, conversational speech
- Avoid reading unnaturally or monotonously
- Include varied intonation and emotion
- Use typical phrases from the target region

## Accent-Specific Notes

### Mexico (es-mx)
- Clear pronunciation
- Moderate pace
- Typical vowel sounds and intonation patterns

### Argentina (es-ar)
- Rioplatense accent with "sh" sound for "ll" and "y"
- Distinctive intonation pattern
- Use of "vos" instead of "tú"

### Colombia (es-co)
- Clear, neutral Colombian accent
- Common in call centers and media
- Distinct from coastal/regional variants

### Chile (es-cl)
- Characteristic speed and elision
- Unique intonation patterns
- "Chilenismos" are acceptable but not required
`;
