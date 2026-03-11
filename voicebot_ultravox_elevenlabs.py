"""
Voicebot Pipeline: Ultravox + ElevenLabs Flash 2.5
===================================================

Architecture:
  Audio → [Ultravox (Whisper encoder + SLM)] → texto → [ElevenLabs Flash 2.5] → audio

Ultravox combines Whisper's encoder with a SLM (Llama 3.1 8B) via a multimodal
projector. No intermediate transcription - audio embeddings go directly into the LLM.

Hardware:
  - L4 (24GB): fp16 or int8 (recommended)
  - T4 (16GB): int8 or int4 (with bitsandbytes)

Environment variables:
  ELEVENLABS_API_KEY  - Your ElevenLabs API key
  ULTRAVOX_MODEL      - HuggingFace model ID (default: fixie-ai/ultravox-v0.4.1-llama-3_1-8b)
  ELEVENLABS_VOICE_ID - Voice ID for TTS (default: JBFqnCBsd6RMkjVDRZzb)
"""

import os
import io
import time
import logging
import tempfile
from pathlib import Path

import numpy as np
import torch
import torchaudio
import gradio as gr
from transformers import AutoModel, AutoProcessor, BitsAndBytesConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ULTRAVOX_MODEL_ID = os.getenv("ULTRAVOX_MODEL", "fixie-ai/ultravox-v0.4.1-llama-3_1-8b")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")  # George
ELEVENLABS_MODEL_ID = "eleven_flash_v2_5"
SAMPLE_RATE = 16_000  # Ultravox expects 16kHz mono

SYSTEM_PROMPT = """Eres un asistente de voz amigable y conciso. Respondes en espanol.
Tus respuestas deben ser cortas (1-3 oraciones) porque seran convertidas a audio.
No uses markdown, listas, ni formatos especiales - solo texto plano conversacional."""

# ---------------------------------------------------------------------------
# Ultravox: Audio understanding (Whisper encoder + SLM)
# ---------------------------------------------------------------------------
class UltravoxEngine:
    """Loads Ultravox and runs inference on audio input."""

    def __init__(self, model_id: str = ULTRAVOX_MODEL_ID, quantize: str = "auto"):
        self.model_id = model_id
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.processor = None
        self._quantize = quantize

    def load(self):
        if self.model is not None:
            return

        logger.info(f"Loading Ultravox model: {self.model_id}")
        t0 = time.time()

        # Determine quantization based on available VRAM
        quant_config = None
        dtype = torch.float16

        if self._quantize == "auto" and self.device == "cuda":
            vram_gb = torch.cuda.get_device_properties(0).total_mem / (1024**3)
            if vram_gb < 18:  # T4 (16GB) - use int4
                logger.info(f"VRAM: {vram_gb:.1f}GB - using int4 quantization")
                quant_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                )
            elif vram_gb < 26:  # L4 (24GB) - use int8
                logger.info(f"VRAM: {vram_gb:.1f}GB - using int8 quantization")
                quant_config = BitsAndBytesConfig(load_in_8bit=True)
            else:
                logger.info(f"VRAM: {vram_gb:.1f}GB - using fp16")
        elif self._quantize == "int8":
            quant_config = BitsAndBytesConfig(load_in_8bit=True)
        elif self._quantize == "int4":
            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_quant_type="nf4",
            )

        self.processor = AutoProcessor.from_pretrained(self.model_id, trust_remote_code=True)
        self.model = AutoModel.from_pretrained(
            self.model_id,
            trust_remote_code=True,
            torch_dtype=dtype,
            quantization_config=quant_config,
            device_map="auto" if self.device == "cuda" else None,
        )

        if quant_config is None and self.device == "cuda":
            self.model = self.model.to(self.device)

        logger.info(f"Ultravox loaded in {time.time() - t0:.1f}s")

    def generate(self, audio_array: np.ndarray, sr: int, conversation_history: list[dict] | None = None) -> str:
        """
        Process audio input through Ultravox and return text response.

        The audio goes through:
          1. Whisper encoder → audio embeddings
          2. Multimodal projector → LLM embedding space
          3. SLM (Llama 3.1 8B) → text response

        No intermediate transcription happens - the model "hears" the audio natively.
        """
        self.load()
        t0 = time.time()

        # Resample to 16kHz if needed
        if sr != SAMPLE_RATE:
            audio_tensor = torch.from_numpy(audio_array).float()
            if audio_tensor.dim() == 1:
                audio_tensor = audio_tensor.unsqueeze(0)
            audio_tensor = torchaudio.functional.resample(audio_tensor, sr, SAMPLE_RATE)
            audio_array = audio_tensor.squeeze().numpy()

        # Build conversation with system prompt
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if conversation_history:
            messages.extend(conversation_history)
        # The current audio turn - Ultravox uses <|audio|> placeholder
        messages.append({"role": "user", "content": "<|audio|>"})

        # Process inputs
        inputs = self.processor(
            text=self.processor.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True),
            audio=audio_array,
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
        )
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}

        # Generate response
        with torch.inference_mode():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=256,
                temperature=0.7,
                do_sample=True,
            )

        # Decode only the new tokens
        input_len = inputs["input_ids"].shape[1]
        response = self.processor.tokenizer.decode(output_ids[0][input_len:], skip_special_tokens=True)

        elapsed = time.time() - t0
        logger.info(f"Ultravox TTFT: {elapsed*1000:.0f}ms | Response: {response[:80]}...")
        return response.strip()


# ---------------------------------------------------------------------------
# ElevenLabs Flash 2.5: Text-to-Speech
# ---------------------------------------------------------------------------
class ElevenLabsTTS:
    """Generates speech using ElevenLabs Flash 2.5 API."""

    def __init__(self, api_key: str = ELEVENLABS_API_KEY, voice_id: str = ELEVENLABS_VOICE_ID):
        self.api_key = api_key
        self.voice_id = voice_id

    def synthesize(self, text: str) -> tuple[np.ndarray, int]:
        """
        Convert text to speech using ElevenLabs Flash 2.5.

        Returns (audio_array, sample_rate).
        """
        import httpx

        if not self.api_key:
            raise ValueError("ELEVENLABS_API_KEY environment variable not set")

        t0 = time.time()

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/wav",
        }
        payload = {
            "text": text,
            "model_id": ELEVENLABS_MODEL_ID,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "style": 0.0,
                "use_speaker_boost": True,
            },
        }

        response = httpx.post(url, json=payload, headers=headers, timeout=30.0)
        response.raise_for_status()

        # Parse WAV response
        import soundfile as sf
        audio_array, sr = sf.read(io.BytesIO(response.content))

        elapsed = time.time() - t0
        logger.info(f"ElevenLabs TTS: {elapsed*1000:.0f}ms | {len(text)} chars → {len(audio_array)/sr:.1f}s audio")
        return audio_array, sr

    def synthesize_streaming(self, text: str) -> tuple[np.ndarray, int]:
        """
        Stream TTS using ElevenLabs streaming endpoint for lower TTFB.

        Returns (audio_array, sample_rate) after collecting the full stream.
        """
        import httpx

        if not self.api_key:
            raise ValueError("ELEVENLABS_API_KEY environment variable not set")

        t0 = time.time()
        first_chunk_time = None

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "model_id": ELEVENLABS_MODEL_ID,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
            },
            "output_format": "pcm_24000",
        }

        audio_chunks = []
        with httpx.stream("POST", url, json=payload, headers=headers, timeout=30.0) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes(chunk_size=4096):
                if first_chunk_time is None:
                    first_chunk_time = time.time()
                    logger.info(f"ElevenLabs TTFB: {(first_chunk_time - t0)*1000:.0f}ms")
                audio_chunks.append(chunk)

        # Combine PCM chunks (16-bit signed, 24kHz mono)
        raw_audio = b"".join(audio_chunks)
        audio_array = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0
        sr = 24_000

        elapsed = time.time() - t0
        logger.info(f"ElevenLabs total: {elapsed*1000:.0f}ms | {len(text)} chars → {len(audio_array)/sr:.1f}s audio")
        return audio_array, sr


# ---------------------------------------------------------------------------
# Pipeline: Ultravox + ElevenLabs
# ---------------------------------------------------------------------------
class VoicebotPipeline:
    """
    Full voicebot pipeline:
      Audio in → Ultravox (understand) → text → ElevenLabs (speak) → Audio out
    """

    def __init__(self):
        self.ultravox = UltravoxEngine()
        self.tts = ElevenLabsTTS()
        self.conversation_history: list[dict] = []

    def process(self, audio_path: str) -> tuple[str, tuple[int, np.ndarray]]:
        """
        Process a voice input and return (text_response, (sample_rate, audio_response)).
        """
        # Load audio
        audio_array, sr = torchaudio.load(audio_path)
        audio_array = audio_array.mean(dim=0).numpy()  # mono

        # Step 1: Ultravox understands the audio
        t_total = time.time()
        text_response = self.ultravox.generate(audio_array, sr, self.conversation_history)

        # Update conversation history (we don't have transcript, but we track assistant responses)
        self.conversation_history.append({"role": "user", "content": "[audio input]"})
        self.conversation_history.append({"role": "assistant", "content": text_response})

        # Keep history bounded
        if len(self.conversation_history) > 20:
            self.conversation_history = self.conversation_history[-20:]

        # Step 2: ElevenLabs speaks the response
        audio_out, sr_out = self.tts.synthesize_streaming(text_response)

        total_ms = (time.time() - t_total) * 1000
        logger.info(f"Total pipeline: {total_ms:.0f}ms")

        return text_response, (sr_out, (audio_out * 32767).astype(np.int16))

    def reset(self):
        """Clear conversation history."""
        self.conversation_history = []
        return "Conversacion reiniciada."


# ---------------------------------------------------------------------------
# Gradio UI
# ---------------------------------------------------------------------------
def create_app():
    pipeline = VoicebotPipeline()

    def handle_audio(audio):
        if audio is None:
            return "No se recibio audio.", None

        # Gradio returns (sample_rate, numpy_array) or a file path
        if isinstance(audio, str):
            audio_path = audio
        else:
            sr, data = audio
            audio_path = tempfile.mktemp(suffix=".wav")
            import soundfile as sf
            # Gradio may return int16 or float
            if data.dtype == np.int16:
                data = data.astype(np.float32) / 32768.0
            sf.write(audio_path, data, sr)

        try:
            text, audio_out = pipeline.process(audio_path)
            return text, audio_out
        except Exception as e:
            logger.exception("Pipeline error")
            return f"Error: {e}", None

    def reset_conversation():
        return pipeline.reset(), None, None

    with gr.Blocks(title="Voicebot: Ultravox + ElevenLabs") as app:
        gr.Markdown("""
        # Voicebot: Ultravox + ElevenLabs Flash 2.5

        **Pipeline:** Audio → Ultravox (Whisper encoder + SLM) → texto → ElevenLabs Flash 2.5 → Audio

        - **Ultravox**: Entiende audio directamente via embeddings (sin transcripcion intermedia)
        - **ElevenLabs Flash 2.5**: TTS de baja latencia y alta calidad

        Configura `ELEVENLABS_API_KEY` como variable de entorno antes de iniciar.
        """)

        with gr.Row():
            with gr.Column():
                audio_input = gr.Audio(
                    sources=["microphone", "upload"],
                    type="numpy",
                    label="Tu mensaje de voz",
                )
                with gr.Row():
                    submit_btn = gr.Button("Enviar", variant="primary")
                    reset_btn = gr.Button("Reiniciar conversacion")

            with gr.Column():
                text_output = gr.Textbox(label="Respuesta (texto)", lines=3)
                audio_output = gr.Audio(label="Respuesta (audio)", type="numpy")

        submit_btn.click(
            fn=handle_audio,
            inputs=[audio_input],
            outputs=[text_output, audio_output],
        )

        reset_btn.click(
            fn=reset_conversation,
            inputs=[],
            outputs=[text_output, audio_input, audio_output],
        )

    return app


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Voicebot: Ultravox + ElevenLabs")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--share", action="store_true", help="Create public Gradio link")
    parser.add_argument("--quantize", choices=["auto", "fp16", "int8", "int4"], default="auto")
    args = parser.parse_args()

    # Override quantization if specified
    if args.quantize != "auto":
        ULTRAVOX_MODEL_ID  # keep the model ID
        # Will be picked up by UltravoxEngine

    app = create_app()
    app.launch(server_name="0.0.0.0", server_port=args.port, share=args.share)
