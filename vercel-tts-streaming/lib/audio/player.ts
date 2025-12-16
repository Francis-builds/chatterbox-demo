'use client';

/**
 * PCM16 Audio Player
 *
 * Plays streaming PCM16 audio chunks using Web Audio API.
 * Optimized for low-latency voicebot playback.
 */

export class PCM16Player {
  private audioContext: AudioContext | null = null;
  private sampleRate: number;
  private scheduledTime: number = 0;
  private isPlaying: boolean = false;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;
  private pendingBuffers: AudioBuffer[] = [];
  private activeSourceNodes: AudioBufferSourceNode[] = [];

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  /**
   * Initialize the audio context (must be called after user interaction)
   */
  async init(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.scheduledTime = this.audioContext.currentTime;
  }

  /**
   * Set callbacks for playback events
   */
  setCallbacks(onStart?: () => void, onEnd?: () => void): void {
    this.onPlaybackStart = onStart;
    this.onPlaybackEnd = onEnd;
  }

  /**
   * Convert PCM16 bytes to Float32 audio samples
   */
  private pcm16ToFloat32(pcm16: ArrayBuffer): Float32Array {
    const int16Array = new Int16Array(pcm16);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    return float32Array;
  }

  /**
   * Play a PCM16 audio chunk
   */
  async playChunk(pcm16Data: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      await this.init();
    }

    const audioContext = this.audioContext!;
    const float32Data = this.pcm16ToFloat32(pcm16Data);

    // Create audio buffer
    const audioBuffer = audioContext.createBuffer(1, float32Data.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(float32Data);

    // Schedule playback
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    // Track active source nodes for cleanup
    this.activeSourceNodes.push(source);
    source.onended = () => {
      const index = this.activeSourceNodes.indexOf(source);
      if (index > -1) {
        this.activeSourceNodes.splice(index, 1);
      }
      if (this.activeSourceNodes.length === 0 && this.pendingBuffers.length === 0) {
        this.isPlaying = false;
        this.onPlaybackEnd?.();
      }
    };

    // Schedule at the right time for gapless playback
    const startTime = Math.max(audioContext.currentTime, this.scheduledTime);
    source.start(startTime);
    this.scheduledTime = startTime + audioBuffer.duration;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onPlaybackStart?.();
    }
  }

  /**
   * Play base64 encoded PCM16 audio
   */
  async playBase64Chunk(base64Data: string): Promise<void> {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    await this.playChunk(bytes.buffer);
  }

  /**
   * Stop all playback
   */
  stop(): void {
    for (const source of this.activeSourceNodes) {
      try {
        source.stop();
      } catch (e) {
        // Ignore errors from already stopped sources
      }
    }
    this.activeSourceNodes = [];
    this.pendingBuffers = [];
    this.isPlaying = false;

    if (this.audioContext) {
      this.scheduledTime = this.audioContext.currentTime;
    }
  }

  /**
   * Get current playback state
   */
  getState(): { isPlaying: boolean; currentTime: number; scheduledTime: number } {
    return {
      isPlaying: this.isPlaying,
      currentTime: this.audioContext?.currentTime || 0,
      scheduledTime: this.scheduledTime,
    };
  }

  /**
   * Close the audio context
   */
  async close(): Promise<void> {
    this.stop();
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}

/**
 * Audio Recorder
 *
 * Records audio from microphone for voice cloning reference.
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.audioChunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start(100); // Collect data every 100ms
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob());
        return;
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.cleanup();
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }
}
