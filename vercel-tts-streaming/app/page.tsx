export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Chatterbox TTS Streaming API</h1>
      <p>Low-latency text-to-speech streaming service optimized for voicebots.</p>

      <h2>Quick Start</h2>
      <p>For minimum TTFB, connect directly to the Modal WebSocket:</p>

      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
{`// Get WebSocket URL
const response = await fetch('/api/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'Hola, bienvenido al sistema de voz.',
    language_id: 'es',
    streaming: true,
  }),
});

const { websocket_url, connection_params } = await response.json();

// Connect to WebSocket
const ws = new WebSocket(websocket_url);
ws.onopen = () => ws.send(JSON.stringify(connection_params));
ws.onmessage = (event) => {
  if (event.data instanceof Blob) {
    // PCM16 audio chunk - play or process
    playAudioChunk(event.data);
  } else {
    // Status message
    const status = JSON.parse(event.data);
    console.log('Status:', status);
  }
};`}
      </pre>

      <h2>API Endpoints</h2>
      <ul>
        <li><strong>GET /api/health</strong> - Health check</li>
        <li><strong>GET /api/tts</strong> - Service info and endpoints</li>
        <li><strong>POST /api/tts</strong> - Generate TTS (streaming or full)</li>
        <li><strong>GET /api/voices</strong> - List available voices</li>
        <li><strong>POST /api/sessions</strong> - Create TTS session</li>
      </ul>

      <h2>Supported Languages</h2>
      <p>23 languages including Spanish (es) for Latin American regions.</p>
      <p><strong>Note:</strong> For regional accents (Mexico, Argentina, Colombia, Chile), provide reference audio from speakers of that region.</p>

      <h2>Audio Format</h2>
      <ul>
        <li><strong>Streaming:</strong> PCM16, 24kHz, mono</li>
        <li><strong>Full:</strong> WAV, 24kHz, mono</li>
      </ul>

      <h2>Architecture for Minimum TTFB</h2>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px' }}>
{`bot-voice ←──WebSocket──→ Modal GPU (Direct connection)
                              │
Vercel (Control plane)        │
  - Session management        │
  - Voice configuration       │
  - Health monitoring    ─────┘`}
      </pre>
    </main>
  );
}
