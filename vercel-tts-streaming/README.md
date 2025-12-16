# Chatterbox TTS Streaming

Low-latency text-to-speech streaming service optimized for voicebots, using Chatterbox TTS on Modal GPU backend with Vercel control plane.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ MINIMUM TTFB Architecture                                       │
│                                                                 │
│  bot-voice ◄══════════════════════════════════════► Modal GPU  │
│            WebSocket (audio chunks ~400-600ms)                  │
│                                                                 │
│  Vercel (Control plane)                                         │
│    - Session management                                         │
│    - Voice configuration                                        │
│    - Health monitoring                                          │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design Decision**: For minimum TTFB, `bot-voice` connects **directly** to Modal WebSocket, bypassing Vercel middleware for audio streaming.

## Latency Characteristics

| Metric | Value |
|--------|-------|
| First audio chunk | ~400ms (10 speech tokens) |
| Subsequent chunks | ~600ms (15 speech tokens) |
| Total TTFB | 400-600ms from request |
| Cold start | 0ms (with warm containers) |

## Quick Start

### 1. Deploy Modal Backend

```bash
cd modal_backend

# Install Modal CLI
pip install modal

# Authenticate with Modal
modal token new

# Deploy the TTS service
modal deploy streaming_tts.py

# Note the WebSocket URL from the output
```

### 2. Deploy Vercel Control Plane

```bash
# Set environment variables
vercel env add MODAL_TTS_URL  # Enter Modal WebSocket URL

# Deploy
vercel
```

### 3. Connect from bot-voice

```python
import asyncio
import websockets
import json

async def synthesize_speech(text: str, language_id: str = "es"):
    # Connect directly to Modal for minimum TTFB
    uri = "wss://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run/talk"

    async with websockets.connect(uri) as ws:
        # Send online event
        await ws.send(json.dumps({
            "InteractionId": "session_123",
            "BotName": "my-bot",
            "EventName": "*online",
            "Tarea": {"language_id": language_id}
        }))

        # Wait for acknowledgment
        response = await ws.recv()
        print(f"Connected: {response}")

        # Send text for synthesis
        await ws.send(json.dumps({
            "InteractionId": "session_123",
            "BotName": "my-bot",
            "EventName": "*text",
            "Message": text
        }))

        # Receive audio chunks
        while True:
            response = await ws.recv()
            data = json.loads(response)

            if data["Events"][0]["name"] == "*audio":
                # PCM16 audio chunk (base64 encoded)
                audio_b64 = data["Events"][0]["audio"]
                # Process/play audio chunk
                yield base64.b64decode(audio_b64)

            elif data["Events"][0]["name"] == "*audio_complete":
                break

# Usage
async for chunk in synthesize_speech("Hola, bienvenido al sistema."):
    play_audio(chunk)  # Your audio playback function
```

## API Endpoints

### Vercel Control Plane

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/tts` | GET | Service info |
| `/api/tts` | POST | Get WebSocket URL or generate audio |
| `/api/voices` | GET | List available voices |
| `/api/sessions` | POST | Create TTS session |

### Modal WebSocket

| Endpoint | Protocol | Description |
|----------|----------|-------------|
| `/ws/tts` | WebSocket | Direct TTS streaming |
| `/talk` | WebSocket | bot-voice compatible protocol |

## Spanish Support

### Languages
Spanish (`es`) is fully supported. The model uses a single `es` code for all Spanish variants.

### Regional Accents (Latin America)

To achieve authentic Latin American accents:

1. **Record reference audio** from native speakers of the target region
2. **Upload to accessible URL** (S3, GCS, etc.)
3. **Configure voice** with the audio URL

```python
# Send with custom voice
await ws.send(json.dumps({
    "InteractionId": "session_123",
    "EventName": "*text",
    "Message": "Hola, ¿cómo estás?",
    "Tarea": {
        "language_id": "es",
        "voice_prompt_url": "https://your-bucket/mexican-voice.wav"
    }
}))
```

### Pre-configured Regions

- **Mexico (mx)** - Mexican Spanish
- **Argentina (ar)** - Rioplatense Spanish
- **Colombia (co)** - Colombian Spanish
- **Chile (cl)** - Chilean Spanish

See `lib/voice-samples.ts` for configuration examples.

## Audio Format

| Mode | Format | Sample Rate | Channels |
|------|--------|-------------|----------|
| Streaming | PCM16 | 24000 Hz | 1 (mono) |
| Full | WAV | 24000 Hz | 1 (mono) |

## Environment Variables

### Vercel
```
MODAL_TTS_URL=https://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run
```

### Modal (automatic)
Modal handles authentication automatically via `modal token new`.

## Development

### Local Testing

```bash
# Test Modal backend locally
cd modal_backend
modal run streaming_tts.py

# Run Vercel locally
cd ..
npm install
npm run dev
```

### Modal CLI Commands

```bash
# Deploy
modal deploy modal_backend/streaming_tts.py

# View logs
modal logs chatterbox-tts-streaming

# Check status
modal app list
```

## Cost Optimization

### Modal
- **A10G GPU**: ~$0.000463/sec (~$1.67/hour)
- **Cold starts**: Eliminated with `container_idle_timeout=120`
- **Scaling**: Automatic based on load

### Vercel
- **Edge functions**: Pay per invocation
- **Bandwidth**: Minimal (control plane only)

## Troubleshooting

### High Latency
1. Ensure direct WebSocket connection to Modal (not through Vercel)
2. Check Modal container is warm (`modal logs`)
3. Reduce `token_chunk_size` for faster first chunk

### Audio Quality Issues
1. Verify reference audio is high quality (min 5 seconds)
2. Check sample rate matches (24kHz output)
3. Adjust temperature parameter (lower = more consistent)

### Connection Failures
1. Check Modal deployment status
2. Verify WebSocket URL is correct
3. Check CORS headers if connecting from browser

## bot-voice Integration

The `/talk` endpoint follows the Mitrol bot-voice protocol:

### Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `*online` | Client → Server | Initialize session |
| `*text` | Client → Server | Text to synthesize |
| `*audio` | Server → Client | Audio chunk (base64 PCM16) |
| `*audio_complete` | Server → Client | Synthesis complete |
| `*offline` | Client → Server | End session |

### Message Format

```json
{
  "InteractionId": "string",
  "BotName": "string",
  "EventName": "*text",
  "Message": "Text to synthesize",
  "Tarea": {
    "language_id": "es",
    "voice_prompt_url": "optional"
  }
}
```

## License

This project uses Chatterbox TTS by Resemble AI (MIT License).
