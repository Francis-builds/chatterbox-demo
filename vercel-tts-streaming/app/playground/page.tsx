'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PCM16Player } from '@/lib/audio/player';

// Supported languages
const LANGUAGES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
};

// Sample texts for each language
const SAMPLE_TEXTS: Record<string, string> = {
  en: 'Hello! Welcome to the Chatterbox text-to-speech playground. This is a test of the streaming audio system.',
  es: 'Hola, bienvenido al sistema de síntesis de voz. Esta es una prueba del sistema de audio en tiempo real.',
  fr: 'Bonjour et bienvenue dans le système de synthèse vocale. Ceci est un test du système audio en streaming.',
  de: 'Hallo und willkommen beim Sprachsynthesesystem. Dies ist ein Test des Streaming-Audiosystems.',
  pt: 'Olá e bem-vindo ao sistema de síntese de voz. Este é um teste do sistema de áudio em streaming.',
  it: 'Ciao e benvenuto nel sistema di sintesi vocale. Questo è un test del sistema audio in streaming.',
  ja: 'こんにちは、音声合成システムへようこそ。これはストリーミングオーディオシステムのテストです。',
  ko: '안녕하세요, 음성 합성 시스템에 오신 것을 환영합니다. 이것은 스트리밍 오디오 시스템의 테스트입니다.',
  zh: '您好，欢迎使用语音合成系统。这是流媒体音频系统的测试。',
};

interface Metrics {
  connectionTime: number | null;
  firstChunkTime: number | null;
  totalChunks: number;
  totalBytes: number;
  totalDuration: number | null;
}

export default function PlaygroundPage() {
  // Form state
  const [text, setText] = useState(SAMPLE_TEXTS.es);
  const [language, setLanguage] = useState('es');
  const [temperature, setTemperature] = useState(0.8);
  const [wsUrl, setWsUrl] = useState('');

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Metrics
  const [metrics, setMetrics] = useState<Metrics>({
    connectionTime: null,
    firstChunkTime: null,
    totalChunks: 0,
    totalBytes: 0,
    totalDuration: null,
  });

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PCM16Player | null>(null);
  const startTimeRef = useRef<number>(0);
  const firstChunkReceivedRef = useRef<boolean>(false);

  // Add log entry
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-50), `[${timestamp}] ${message}`]);
  }, []);

  // Initialize audio player
  useEffect(() => {
    playerRef.current = new PCM16Player(24000);
    playerRef.current.setCallbacks(
      () => setIsPlaying(true),
      () => setIsPlaying(false)
    );

    return () => {
      playerRef.current?.close();
    };
  }, []);

  // Update sample text when language changes
  useEffect(() => {
    setText(SAMPLE_TEXTS[language] || SAMPLE_TEXTS.en);
  }, [language]);

  // Connect to WebSocket and generate audio
  const handleGenerate = async () => {
    if (!wsUrl) {
      setError('Please enter the Modal WebSocket URL');
      return;
    }

    if (!text.trim()) {
      setError('Please enter text to synthesize');
      return;
    }

    setError(null);
    setIsGenerating(true);
    firstChunkReceivedRef.current = false;
    startTimeRef.current = performance.now();

    setMetrics({
      connectionTime: null,
      firstChunkTime: null,
      totalChunks: 0,
      totalBytes: 0,
      totalDuration: null,
    });

    try {
      // Initialize audio player (requires user interaction)
      await playerRef.current?.init();

      addLog(`Connecting to ${wsUrl}...`);

      // Create WebSocket connection
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const connectionTime = performance.now() - startTimeRef.current;
        setIsConnected(true);
        setMetrics((prev) => ({ ...prev, connectionTime }));
        addLog(`Connected in ${connectionTime.toFixed(0)}ms`);

        // Send synthesis request
        const request = {
          type: 'synthesize',
          text: text,
          language_id: language,
          temperature: temperature,
          interaction_id: `playground-${Date.now()}`,
        };

        addLog(`Sending: ${JSON.stringify(request).slice(0, 100)}...`);
        ws.send(JSON.stringify(request));
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          // Binary audio data
          const arrayBuffer = await event.data.arrayBuffer();
          const chunkSize = arrayBuffer.byteLength;

          if (!firstChunkReceivedRef.current) {
            firstChunkReceivedRef.current = true;
            const ttfb = performance.now() - startTimeRef.current;
            setMetrics((prev) => ({ ...prev, firstChunkTime: ttfb }));
            addLog(`First audio chunk received! TTFB: ${ttfb.toFixed(0)}ms`);
          }

          setMetrics((prev) => ({
            ...prev,
            totalChunks: prev.totalChunks + 1,
            totalBytes: prev.totalBytes + chunkSize,
          }));

          // Play the audio chunk
          await playerRef.current?.playChunk(arrayBuffer);
          addLog(`Playing chunk: ${chunkSize} bytes`);
        } else {
          // JSON status message
          try {
            const data = JSON.parse(event.data);
            addLog(`Status: ${JSON.stringify(data)}`);

            if (data.type === 'status' && data.status === 'complete') {
              const totalDuration = performance.now() - startTimeRef.current;
              setMetrics((prev) => ({ ...prev, totalDuration }));
              addLog(`Generation complete in ${totalDuration.toFixed(0)}ms`);
              setIsGenerating(false);
            } else if (data.type === 'error') {
              setError(data.message);
              setIsGenerating(false);
            }
          } catch (e) {
            addLog(`Received: ${event.data}`);
          }
        }
      };

      ws.onerror = (event) => {
        addLog('WebSocket error');
        setError('WebSocket connection failed');
        setIsGenerating(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        addLog('WebSocket closed');
        if (isGenerating) {
          setIsGenerating(false);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsGenerating(false);
    }
  };

  // Test bot-voice protocol
  const handleBotVoiceTest = async () => {
    if (!wsUrl) {
      setError('Please enter the Modal WebSocket URL');
      return;
    }

    const talkUrl = wsUrl.replace('/ws/tts', '/talk');
    setError(null);
    setIsGenerating(true);
    firstChunkReceivedRef.current = false;
    startTimeRef.current = performance.now();

    setMetrics({
      connectionTime: null,
      firstChunkTime: null,
      totalChunks: 0,
      totalBytes: 0,
      totalDuration: null,
    });

    try {
      await playerRef.current?.init();
      addLog(`Connecting to bot-voice endpoint: ${talkUrl}...`);

      const ws = new WebSocket(talkUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const connectionTime = performance.now() - startTimeRef.current;
        setIsConnected(true);
        setMetrics((prev) => ({ ...prev, connectionTime }));
        addLog(`Connected in ${connectionTime.toFixed(0)}ms`);

        // Send *online event
        const onlineEvent = {
          InteractionId: `playground-${Date.now()}`,
          BotName: 'playground-test',
          EventName: '*online',
          Tarea: { language_id: language },
        };

        addLog(`Sending *online: ${JSON.stringify(onlineEvent)}`);
        ws.send(JSON.stringify(onlineEvent));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          addLog(`Received: ${data.EventName}`);

          if (data.EventName === '*online') {
            // Send text after online acknowledgment
            const textEvent = {
              InteractionId: data.InteractionId,
              BotName: 'playground-test',
              EventName: '*text',
              Message: text,
              Tarea: { language_id: language },
            };

            addLog(`Sending *text: "${text.slice(0, 50)}..."`);
            ws.send(JSON.stringify(textEvent));
          } else if (data.Events?.[0]?.name === '*audio') {
            // Audio chunk (base64)
            const audioB64 = data.Events[0].audio;
            const binaryString = atob(audioB64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            if (!firstChunkReceivedRef.current) {
              firstChunkReceivedRef.current = true;
              const ttfb = performance.now() - startTimeRef.current;
              setMetrics((prev) => ({ ...prev, firstChunkTime: ttfb }));
              addLog(`First audio chunk! TTFB: ${ttfb.toFixed(0)}ms`);
            }

            setMetrics((prev) => ({
              ...prev,
              totalChunks: prev.totalChunks + 1,
              totalBytes: prev.totalBytes + bytes.length,
            }));

            await playerRef.current?.playChunk(bytes.buffer);
          } else if (data.Events?.[0]?.name === '*audio_complete') {
            const totalDuration = performance.now() - startTimeRef.current;
            setMetrics((prev) => ({ ...prev, totalDuration }));
            addLog(`Complete in ${totalDuration.toFixed(0)}ms`);
            setIsGenerating(false);
            ws.close();
          }
        } catch (e) {
          addLog(`Parse error: ${e}`);
        }
      };

      ws.onerror = () => {
        setError('WebSocket error');
        setIsGenerating(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        addLog('Disconnected');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsGenerating(false);
    }
  };

  // Stop playback
  const handleStop = () => {
    wsRef.current?.close();
    playerRef.current?.stop();
    setIsGenerating(false);
    setIsConnected(false);
    addLog('Stopped');
  };

  // Clear logs
  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>TTS Streaming Playground</h1>
      <p>Test the Chatterbox TTS streaming service with real-time audio playback.</p>

      {/* Connection Setup */}
      <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <h3>1. Modal WebSocket URL</h3>
        <input
          type="text"
          value={wsUrl}
          onChange={(e) => setWsUrl(e.target.value)}
          placeholder="wss://your-modal-app--chatterbox-tts-streaming-websocket-app.modal.run/ws/tts"
          style={{ width: '100%', padding: '0.75rem', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <p style={{ fontSize: '12px', color: '#666', marginTop: '0.5rem' }}>
          Deploy the Modal backend first, then paste the WebSocket URL here.
        </p>
      </div>

      {/* Input Form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        <div>
          <h3>2. Configure</h3>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              {Object.entries(LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Temperature: {temperature}
            </label>
            <input
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !wsUrl}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '16px',
                background: isGenerating ? '#ccc' : '#0070f3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
              }}
            >
              {isGenerating ? 'Generating...' : 'Generate (Direct WS)'}
            </button>

            <button
              onClick={handleBotVoiceTest}
              disabled={isGenerating || !wsUrl}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '16px',
                background: isGenerating ? '#ccc' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
              }}
            >
              {isGenerating ? 'Generating...' : 'Test bot-voice Protocol'}
            </button>

            {(isGenerating || isPlaying) && (
              <button
                onClick={handleStop}
                style={{
                  padding: '0.75rem 1.5rem',
                  fontSize: '16px',
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Stop
              </button>
            )}
          </div>

          {error && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fee2e2', color: '#dc2626', borderRadius: '4px' }}>
              {error}
            </div>
          )}
        </div>

        {/* Metrics Panel */}
        <div>
          <h3>3. Metrics</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#16a34a' }}>
                {metrics.firstChunkTime ? `${metrics.firstChunkTime.toFixed(0)}ms` : '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>TTFB (First Chunk)</div>
            </div>

            <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2563eb' }}>
                {metrics.connectionTime ? `${metrics.connectionTime.toFixed(0)}ms` : '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Connection Time</div>
            </div>

            <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d97706' }}>{metrics.totalChunks}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Audio Chunks</div>
            </div>

            <div style={{ padding: '1rem', background: '#f3e8ff', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#9333ea' }}>
                {(metrics.totalBytes / 1024).toFixed(1)} KB
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Total Audio</div>
            </div>

            <div style={{ padding: '1rem', background: '#fce7f3', borderRadius: '8px', textAlign: 'center', gridColumn: 'span 2' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#db2777' }}>
                {metrics.totalDuration ? `${(metrics.totalDuration / 1000).toFixed(2)}s` : '-'}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Total Generation Time</div>
            </div>
          </div>

          {/* Status Indicators */}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
            <div
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '999px',
                fontSize: '12px',
                background: isConnected ? '#dcfce7' : '#f3f4f6',
                color: isConnected ? '#16a34a' : '#6b7280',
              }}
            >
              {isConnected ? '● Connected' : '○ Disconnected'}
            </div>
            <div
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '999px',
                fontSize: '12px',
                background: isPlaying ? '#dbeafe' : '#f3f4f6',
                color: isPlaying ? '#2563eb' : '#6b7280',
              }}
            >
              {isPlaying ? '▶ Playing' : '⏸ Idle'}
            </div>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Event Log</h3>
          <button onClick={handleClearLogs} style={{ padding: '0.25rem 0.5rem', fontSize: '12px', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
        <div
          style={{
            height: '200px',
            overflow: 'auto',
            background: '#1e1e1e',
            color: '#d4d4d4',
            padding: '1rem',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: '#666' }}>Logs will appear here...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ marginBottom: '0.25rem' }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* SIP Integration Guide */}
      <div style={{ padding: '1.5rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h3>SIP Call Integration</h3>
        <p>To test with real SIP calls, you need:</p>

        <h4>Required Components</h4>
        <ol>
          <li>
            <strong>SIP Gateway / PBX</strong> - Asterisk, FreeSWITCH, or cloud (Twilio, Vonage)
          </li>
          <li>
            <strong>Media Server</strong> - To bridge SIP audio with WebSocket
          </li>
          <li>
            <strong>Audio Codec Conversion</strong> - SIP typically uses G.711/G.722, TTS outputs PCM16
          </li>
        </ol>

        <h4>Architecture</h4>
        <pre
          style={{
            background: '#1e1e1e',
            color: '#d4d4d4',
            padding: '1rem',
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '12px',
          }}
        >
{`Phone ←──SIP/RTP──→ Asterisk/FreeSWITCH ←──WebSocket──→ Modal TTS
                          │
                          ├── AudioSocket (Asterisk)
                          ├── mod_audio_fork (FreeSWITCH)
                          └── Media Streams (Twilio)

Twilio Example:
Phone ←──PSTN──→ Twilio ←──Media Streams WS──→ Your Server ←──WS──→ Modal TTS`}
        </pre>

        <h4>Quick Start Options</h4>
        <ul>
          <li>
            <strong>Twilio Media Streams</strong> - Easiest, managed SIP + WebSocket bridge
          </li>
          <li>
            <strong>Asterisk + AudioSocket</strong> - Open source, requires server setup
          </li>
          <li>
            <strong>FreeSWITCH + mod_audio_fork</strong> - High performance, complex setup
          </li>
        </ul>
      </div>
    </div>
  );
}
