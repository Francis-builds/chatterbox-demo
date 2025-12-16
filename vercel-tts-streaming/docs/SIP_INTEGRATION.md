# SIP Integration Guide

This guide explains how to integrate the Chatterbox TTS streaming service with SIP-based phone systems for real voice calls.

## Overview

To test with real SIP calls, you need to bridge the SIP/RTP audio world with WebSocket streaming. Here are your options:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SIP Integration Options                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Option 1: Twilio Media Streams (Recommended for Quick Start)           │
│  ─────────────────────────────────────────────────────────────           │
│  Phone ←─PSTN─→ Twilio ←─Media Streams WS─→ Bridge Server ←WS→ Modal   │
│                                                                          │
│  Option 2: Asterisk + AudioSocket                                        │
│  ─────────────────────────────────────────────────────────               │
│  Phone ←─SIP─→ Asterisk ←─AudioSocket─→ Bridge Server ←─WS─→ Modal      │
│                                                                          │
│  Option 3: FreeSWITCH + mod_audio_fork                                   │
│  ─────────────────────────────────────────────────────────               │
│  Phone ←─SIP─→ FreeSWITCH ←─WS─→ Bridge Server ←─WS─→ Modal             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Option 1: Twilio Media Streams (Easiest)

Twilio provides a managed SIP trunk and WebSocket bridge, making it the easiest option for testing.

### Prerequisites
- Twilio account with phone number
- Node.js server for media stream handling

### Setup

1. **Create a Twilio Phone Number**

2. **Configure TwiML for Media Streams**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://your-server.com/twilio-stream" />
    </Connect>
    <Say>Connecting you to the voice assistant.</Say>
</Response>
```

3. **Create Bridge Server**

```typescript
// twilio-bridge.ts
import WebSocket, { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (twilioWs) => {
  console.log('Twilio connected');

  // Connect to Modal TTS
  const modalWs = new WebSocket('wss://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run/talk');

  let streamSid: string;
  let callSid: string;

  twilioWs.on('message', async (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.event) {
      case 'start':
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        console.log(`Call started: ${callSid}`);

        // Initialize Modal session
        modalWs.send(JSON.stringify({
          InteractionId: callSid,
          BotName: 'twilio-bridge',
          EventName: '*online',
          Tarea: { language_id: 'es' }
        }));
        break;

      case 'media':
        // Twilio sends audio in mulaw format
        // You can process STT here if needed
        break;

      case 'stop':
        modalWs.send(JSON.stringify({
          InteractionId: callSid,
          BotName: 'twilio-bridge',
          EventName: '*offline'
        }));
        modalWs.close();
        break;
    }
  });

  // Handle TTS audio from Modal
  modalWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.Events?.[0]?.name === '*audio') {
      // Convert PCM16 24kHz to mulaw 8kHz for Twilio
      const pcm16Audio = Buffer.from(msg.Events[0].audio, 'base64');
      const mulawAudio = convertPCM16ToMulaw(pcm16Audio);

      // Send to Twilio
      twilioWs.send(JSON.stringify({
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: mulawAudio.toString('base64')
        }
      }));
    }
  });
});

// Audio conversion helper (simplified - use proper library)
function convertPCM16ToMulaw(pcm16: Buffer): Buffer {
  // Use a library like 'wav' or 'audio-converter' for real conversion
  // This needs:
  // 1. Resample from 24kHz to 8kHz
  // 2. Convert from PCM16 to mulaw
  return pcm16; // Placeholder
}
```

4. **Audio Conversion**

Twilio uses mulaw (G.711) at 8kHz, but our TTS outputs PCM16 at 24kHz. You need to convert:

```typescript
import { Resampler } from 'wasm-audio-resampler';

async function convertForTwilio(pcm16_24k: Buffer): Promise<Buffer> {
  // 1. Resample 24kHz -> 8kHz
  const resampler = new Resampler(24000, 8000, 1, Float32Array);
  const float32 = new Float32Array(pcm16_24k.length / 2);
  for (let i = 0; i < float32.length; i++) {
    float32[i] = pcm16_24k.readInt16LE(i * 2) / 32768;
  }
  const resampled = resampler.process(float32);

  // 2. Convert to mulaw
  return encodeToMulaw(resampled);
}

function encodeToMulaw(samples: Float32Array): Buffer {
  const mulaw = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) {
    mulaw[i] = linearToMulaw(samples[i] * 32768);
  }
  return mulaw;
}

function linearToMulaw(sample: number): number {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  const sign = sample < 0 ? 0x80 : 0;
  sample = Math.abs(sample);
  sample = Math.min(sample, MULAW_MAX);
  sample += MULAW_BIAS;
  const exponent = Math.floor(Math.log2(sample)) - 5;
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}
```

## Option 2: Asterisk + AudioSocket

Open-source solution using Asterisk PBX.

### Prerequisites
- Asterisk 16+ with AudioSocket support
- SIP trunk or softphone

### Setup

1. **Install Asterisk**

```bash
apt-get install asterisk
```

2. **Configure AudioSocket in extensions.conf**

```
[voicebot]
exten => 100,1,Answer()
 same => n,AudioSocket(your-server.com:9092,${UNIQUEID})
 same => n,Hangup()
```

3. **Create AudioSocket Server**

```typescript
// asterisk-bridge.ts
import net from 'net';
import WebSocket from 'ws';

const server = net.createServer((socket) => {
  console.log('Asterisk connected');

  const modalWs = new WebSocket('wss://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run/talk');

  let uniqueId: string;

  socket.on('data', (data) => {
    // AudioSocket protocol:
    // First 3 bytes: type (1) + length (2)
    // Type 0x01 = UUID, 0x10 = audio

    const type = data[0];
    const length = data.readUInt16BE(1);
    const payload = data.slice(3, 3 + length);

    if (type === 0x01) {
      // UUID packet
      uniqueId = payload.toString('utf8');
      console.log(`Call ID: ${uniqueId}`);

      modalWs.on('open', () => {
        modalWs.send(JSON.stringify({
          InteractionId: uniqueId,
          BotName: 'asterisk-bridge',
          EventName: '*online',
          Tarea: { language_id: 'es' }
        }));
      });
    } else if (type === 0x10) {
      // Audio packet (slin16, 8kHz)
      // Process for STT if needed
    }
  });

  // Send TTS audio to Asterisk
  modalWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.Events?.[0]?.name === '*audio') {
      const pcm16Audio = Buffer.from(msg.Events[0].audio, 'base64');

      // Convert 24kHz -> 8kHz
      const audio8k = resample(pcm16Audio, 24000, 8000);

      // AudioSocket format: type (0x10) + length + audio
      const packet = Buffer.alloc(3 + audio8k.length);
      packet[0] = 0x10;
      packet.writeUInt16BE(audio8k.length, 1);
      audio8k.copy(packet, 3);

      socket.write(packet);
    }
  });

  socket.on('close', () => {
    modalWs.close();
  });
});

server.listen(9092, () => {
  console.log('AudioSocket server listening on port 9092');
});
```

## Option 3: FreeSWITCH + mod_audio_fork

High-performance option using FreeSWITCH.

### Setup

1. **Enable mod_audio_fork**

```xml
<!-- modules.conf.xml -->
<load module="mod_audio_fork"/>
```

2. **Dialplan Configuration**

```xml
<extension name="voicebot">
  <condition field="destination_number" expression="^100$">
    <action application="answer"/>
    <action application="audio_fork" data="wss://your-server.com/freeswitch-stream"/>
  </condition>
</extension>
```

## Audio Format Reference

| System | Format | Sample Rate | Channels |
|--------|--------|-------------|----------|
| Modal TTS Output | PCM16 | 24000 Hz | 1 (mono) |
| Twilio Media Streams | mulaw (G.711) | 8000 Hz | 1 (mono) |
| Asterisk AudioSocket | slin16 | 8000 Hz | 1 (mono) |
| FreeSWITCH | L16 | 8000/16000 Hz | 1 (mono) |
| Standard SIP (G.711) | mulaw/alaw | 8000 Hz | 1 (mono) |
| HD Voice (G.722) | ADPCM | 16000 Hz | 1 (mono) |

## Complete Example: Twilio Integration

Here's a complete example using Twilio with a Node.js bridge server:

```typescript
// server.ts
import express from 'express';
import expressWs from 'express-ws';
import WebSocket from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

const { app } = expressWs(express());

// TwiML endpoint for incoming calls
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const connect = twiml.connect();
  connect.stream({ url: `wss://${req.headers.host}/stream` });
  twiml.say({ language: 'es-MX' }, 'Conectando con el asistente de voz.');

  res.type('text/xml');
  res.send(twiml.toString());
});

// WebSocket endpoint for media streams
app.ws('/stream', (twilioWs, req) => {
  let modalWs: WebSocket | null = null;
  let streamSid: string;
  let callSid: string;

  twilioWs.on('message', (data: string) => {
    const msg = JSON.parse(data);

    switch (msg.event) {
      case 'connected':
        console.log('Twilio connected');
        break;

      case 'start':
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;

        // Connect to Modal
        modalWs = new WebSocket(
          'wss://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run/talk'
        );

        modalWs.on('open', () => {
          modalWs!.send(JSON.stringify({
            InteractionId: callSid,
            BotName: 'twilio-voicebot',
            EventName: '*online',
            Tarea: { language_id: 'es' }
          }));

          // Send initial greeting
          modalWs!.send(JSON.stringify({
            InteractionId: callSid,
            BotName: 'twilio-voicebot',
            EventName: '*text',
            Message: 'Hola, bienvenido. ¿En qué puedo ayudarte hoy?'
          }));
        });

        modalWs.on('message', (data: Buffer) => {
          const response = JSON.parse(data.toString());

          if (response.Events?.[0]?.name === '*audio') {
            // Convert and send audio to Twilio
            const pcmAudio = Buffer.from(response.Events[0].audio, 'base64');
            const mulawAudio = convertPCM24kToMulaw8k(pcmAudio);

            twilioWs.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: mulawAudio.toString('base64') }
            }));
          }
        });
        break;

      case 'media':
        // Handle incoming audio (for STT integration)
        // msg.media.payload contains mulaw audio
        break;

      case 'stop':
        if (modalWs) {
          modalWs.send(JSON.stringify({
            InteractionId: callSid,
            BotName: 'twilio-voicebot',
            EventName: '*offline'
          }));
          modalWs.close();
        }
        break;
    }
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## Testing Without a Phone

You can test SIP integration without a real phone using:

1. **Softphones**: Zoiper, Linphone, MicroSIP
2. **WebRTC**: JsSIP in browser
3. **SIP Trunks**: Twilio, Vonage, Telnyx (test numbers)

## Cost Considerations

| Provider | Cost |
|----------|------|
| Twilio | ~$0.0085/min inbound + $0.013/min Media Streams |
| Vonage | ~$0.0045/min inbound |
| Self-hosted Asterisk | Server costs only |

## Next Steps

1. Choose your SIP integration option
2. Set up the bridge server
3. Configure audio conversion
4. Test with the playground first
5. Deploy to production

For questions or issues, check the Modal logs and ensure the WebSocket URL is correct.
