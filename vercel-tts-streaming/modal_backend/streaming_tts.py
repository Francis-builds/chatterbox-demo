"""
Streaming TTS Backend for Modal GPU

This module provides a streaming TTS implementation optimized for minimum TTFB.
It generates speech tokens incrementally and converts them to audio in chunks,
streaming audio back to the client as soon as the first chunk is ready.

Key optimizations for minimum TTFB:
1. Token-level streaming: Yield speech tokens as they're generated
2. Chunked audio conversion: Convert small batches of tokens to audio
3. Model warm-up: Keep model loaded with min_instances=1
4. Direct WebSocket: No middleware between client and GPU
"""

import os
import io
import json
import wave
import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncGenerator, Optional, Generator
from pathlib import Path

import modal

logger = logging.getLogger(__name__)

# Modal app configuration
app = modal.App("chatterbox-tts-streaming")

# Container image with all dependencies
chatterbox_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libsndfile1")
    .pip_install(
        "torch==2.6.0",
        "torchaudio==2.6.0",
        "transformers==4.46.3",
        "diffusers==0.29.0",
        "librosa==0.11.0",
        "safetensors==0.5.3",
        "huggingface_hub",
        "numpy>=1.24.0,<1.26.0",
        "conformer==0.3.2",
        "resemble-perth==1.0.1",
        "s3tokenizer",
        "spacy-pkuseg",
        "pykakasi==2.3.0",
        "pyloudnorm",
        "omegaconf",
    )
    .run_commands(
        "pip install git+https://github.com/resemble-ai/chatterbox.git"
    )
)

# Volume for caching model weights
model_cache = modal.Volume.from_name("chatterbox-model-cache", create_if_missing=True)


@dataclass
class StreamingConfig:
    """Configuration for streaming TTS generation."""
    # Number of speech tokens to buffer before converting to audio
    # Lower = faster TTFB but more overhead, Higher = better quality but slower TTFB
    # 25 tokens ≈ 1 second of audio at 24kHz
    token_chunk_size: int = 15  # ~600ms chunks for good balance

    # Minimum tokens before first audio chunk (lower = faster TTFB)
    min_first_chunk_tokens: int = 10  # ~400ms for first audio

    # Audio format settings
    sample_rate: int = 24000
    channels: int = 1
    sample_width: int = 2  # 16-bit audio


@app.cls(
    image=chatterbox_image,
    gpu="A10G",  # Good balance of cost/performance, can use T4 for lower cost
    volumes={"/cache": model_cache},
    timeout=300,
    container_idle_timeout=120,  # Keep warm for 2 minutes
    allow_concurrent_inputs=10,  # Handle multiple requests
)
class StreamingTTSService:
    """
    Streaming TTS service optimized for minimum TTFB.

    This class maintains a loaded model and provides streaming audio generation
    with chunked output for real-time voicebot applications.
    """

    @modal.enter()
    def load_models(self):
        """Load models on container startup for zero cold-start latency."""
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        # Set cache directory
        os.environ["HF_HOME"] = "/cache/huggingface"
        os.environ["TORCH_HOME"] = "/cache/torch"

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Loading models on device: {self.device}")

        # Load Turbo model for English (fastest, lowest latency)
        logger.info("Loading Chatterbox Turbo model...")
        self.turbo_model = ChatterboxTurboTTS.from_pretrained(device=self.device)
        logger.info("Turbo model loaded successfully")

        # Load Multilingual model for Spanish and other languages
        logger.info("Loading Chatterbox Multilingual model...")
        self.multilingual_model = ChatterboxMultilingualTTS.from_pretrained(self.device)
        logger.info("Multilingual model loaded successfully")

        # Pre-compiled for faster inference
        self.config = StreamingConfig()

        # Cache for voice conditionals (avoid re-computing for same voice)
        self.voice_cache = {}

        logger.info("All models loaded and ready!")

    def _prepare_voice(self, audio_prompt_path: Optional[str], language_id: str = "en"):
        """Prepare voice conditionals from reference audio."""
        cache_key = f"{audio_prompt_path}:{language_id}"

        if cache_key in self.voice_cache:
            return self.voice_cache[cache_key]

        if audio_prompt_path:
            if language_id == "en":
                self.turbo_model.prepare_conditionals(audio_prompt_path)
                self.voice_cache[cache_key] = self.turbo_model.conds
            else:
                # For multilingual, we pass the audio_prompt_path directly to generate
                self.voice_cache[cache_key] = audio_prompt_path

        return self.voice_cache.get(cache_key)

    def _generate_speech_tokens_streaming(
        self,
        text: str,
        language_id: str = "en",
        temperature: float = 0.8,
        top_k: int = 1000,
        top_p: float = 0.95,
        repetition_penalty: float = 1.2,
    ) -> Generator:
        """
        Generate speech tokens one at a time for streaming.

        This is a modified version of inference_turbo that yields tokens
        as they're generated instead of waiting for all tokens.
        """
        import torch
        import torch.nn.functional as F
        from transformers.generation.logits_process import (
            LogitsProcessorList,
            RepetitionPenaltyLogitsProcessor,
            TemperatureLogitsWarper,
            TopKLogitsWarper,
            TopPLogitsWarper,
        )

        if language_id == "en":
            model = self.turbo_model
            t3 = model.t3
            tokenizer = model.tokenizer

            # Normalize and tokenize text
            from chatterbox.tts_turbo import punc_norm
            text = punc_norm(text)
            text_tokens = tokenizer(text, return_tensors="pt", padding=True, truncation=True)
            text_tokens = text_tokens.input_ids.to(self.device)

            # Setup logits processors
            logits_processors = LogitsProcessorList()
            if temperature > 0 and temperature != 1.0:
                logits_processors.append(TemperatureLogitsWarper(temperature))
            if top_k > 0:
                logits_processors.append(TopKLogitsWarper(top_k))
            if top_p < 1.0:
                logits_processors.append(TopPLogitsWarper(top_p))
            if repetition_penalty != 1.0:
                logits_processors.append(RepetitionPenaltyLogitsProcessor(repetition_penalty))

            # Prepare initial embeddings
            speech_start_token = t3.hp.start_speech_token * torch.ones_like(text_tokens[:, :1])
            embeds, _ = t3.prepare_input_embeds(
                t3_cond=model.conds.t3,
                text_tokens=text_tokens,
                speech_tokens=speech_start_token,
                cfg_weight=0.0,
            )

            generated_speech_tokens = []

            # Initial forward pass
            llm_outputs = t3.tfmr(inputs_embeds=embeds, use_cache=True)
            hidden_states = llm_outputs[0]
            past_key_values = llm_outputs.past_key_values

            speech_hidden = hidden_states[:, -1:]
            speech_logits = t3.speech_head(speech_hidden)

            processed_logits = logits_processors(speech_start_token, speech_logits[:, -1, :])
            probs = F.softmax(processed_logits, dim=-1)
            next_speech_token = torch.multinomial(probs, num_samples=1)

            generated_speech_tokens.append(next_speech_token)
            current_speech_token = next_speech_token

            # Yield first token
            yield next_speech_token.cpu()

            # Generate remaining tokens
            max_gen_len = 1000
            for _ in range(max_gen_len):
                current_speech_embed = t3.speech_emb(current_speech_token)

                llm_outputs = t3.tfmr(
                    inputs_embeds=current_speech_embed,
                    past_key_values=past_key_values,
                    use_cache=True
                )

                hidden_states = llm_outputs[0]
                past_key_values = llm_outputs.past_key_values
                speech_logits = t3.speech_head(hidden_states)

                input_ids = torch.cat(generated_speech_tokens, dim=1)
                processed_logits = logits_processors(input_ids, speech_logits[:, -1, :])

                if torch.all(processed_logits == -float("inf")):
                    break

                probs = F.softmax(processed_logits, dim=-1)
                next_speech_token = torch.multinomial(probs, num_samples=1)

                generated_speech_tokens.append(next_speech_token)
                current_speech_token = next_speech_token

                # Check for EOS
                if torch.all(next_speech_token == t3.hp.stop_speech_token):
                    break

                # Yield token immediately
                yield next_speech_token.cpu()
        else:
            # For multilingual, we need to use a different approach
            # The multilingual model doesn't have the same streaming capability
            # We'll generate all tokens and yield them in chunks
            pass

    def _tokens_to_audio_chunk(self, speech_tokens, is_final: bool = False):
        """Convert a chunk of speech tokens to audio waveform."""
        import torch
        from chatterbox.models.s3gen.const import S3GEN_SIL

        model = self.turbo_model

        # Remove OOV tokens
        speech_tokens = speech_tokens[speech_tokens < 6561]
        speech_tokens = speech_tokens.to(self.device)

        # Add silence padding for final chunk
        if is_final:
            silence = torch.tensor([S3GEN_SIL, S3GEN_SIL, S3GEN_SIL]).long().to(self.device)
            speech_tokens = torch.cat([speech_tokens, silence])

        if len(speech_tokens) == 0:
            return None

        # Generate audio from tokens
        wav, _ = model.s3gen.inference(
            speech_tokens=speech_tokens,
            ref_dict=model.conds.gen,
            n_cfm_timesteps=2,  # Turbo uses 2 steps for speed
        )

        wav = wav.squeeze(0).detach().cpu().numpy()

        # Apply watermark
        watermarked_wav = model.watermarker.apply_watermark(wav, sample_rate=model.sr)

        return watermarked_wav

    def _audio_to_pcm_bytes(self, audio_array) -> bytes:
        """Convert numpy audio array to PCM16 bytes."""
        import numpy as np

        # Normalize to int16 range
        audio_int16 = (audio_array * 32767).astype(np.int16)
        return audio_int16.tobytes()

    def _audio_to_wav_bytes(self, audio_array) -> bytes:
        """Convert numpy audio array to WAV bytes."""
        import numpy as np

        audio_int16 = (audio_array * 32767).astype(np.int16)

        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav_file:
            wav_file.setnchannels(self.config.channels)
            wav_file.setsampwidth(self.config.sample_width)
            wav_file.setframerate(self.config.sample_rate)
            wav_file.writeframes(audio_int16.tobytes())

        return buffer.getvalue()

    @modal.method()
    def generate_streaming(
        self,
        text: str,
        language_id: str = "en",
        audio_prompt_path: Optional[str] = None,
        temperature: float = 0.8,
        output_format: str = "pcm",  # "pcm" or "wav"
    ) -> Generator[bytes, None, None]:
        """
        Generate audio in streaming chunks for minimum TTFB.

        Args:
            text: Text to synthesize
            language_id: Language code (en, es, fr, etc.)
            audio_prompt_path: Optional reference audio for voice cloning
            temperature: Generation temperature (0.1-2.0)
            output_format: "pcm" for raw PCM16 or "wav" for WAV chunks

        Yields:
            Audio chunks as bytes
        """
        import torch

        logger.info(f"Starting streaming generation: '{text[:50]}...' lang={language_id}")

        # Prepare voice if provided
        if audio_prompt_path:
            self._prepare_voice(audio_prompt_path, language_id)

        if language_id == "en":
            # Use streaming token generation for English (Turbo model)
            token_buffer = []
            chunk_count = 0

            for token in self._generate_speech_tokens_streaming(
                text=text,
                language_id=language_id,
                temperature=temperature,
            ):
                token_buffer.append(token)

                # Check if we have enough tokens for a chunk
                is_first_chunk = chunk_count == 0
                min_tokens = self.config.min_first_chunk_tokens if is_first_chunk else self.config.token_chunk_size

                if len(token_buffer) >= min_tokens:
                    # Convert buffered tokens to audio
                    all_tokens = torch.cat(token_buffer, dim=1).squeeze(0)
                    audio_chunk = self._tokens_to_audio_chunk(all_tokens, is_final=False)

                    if audio_chunk is not None:
                        if output_format == "wav":
                            yield self._audio_to_wav_bytes(audio_chunk)
                        else:
                            yield self._audio_to_pcm_bytes(audio_chunk)

                    token_buffer = []
                    chunk_count += 1

            # Handle remaining tokens
            if token_buffer:
                all_tokens = torch.cat(token_buffer, dim=1).squeeze(0)
                audio_chunk = self._tokens_to_audio_chunk(all_tokens, is_final=True)

                if audio_chunk is not None:
                    if output_format == "wav":
                        yield self._audio_to_wav_bytes(audio_chunk)
                    else:
                        yield self._audio_to_pcm_bytes(audio_chunk)
        else:
            # For non-English, use multilingual model (non-streaming for now)
            # Generate full audio and yield in chunks
            wav = self.multilingual_model.generate(
                text,
                language_id=language_id,
                audio_prompt_path=audio_prompt_path,
                temperature=temperature,
            )

            audio_array = wav.squeeze(0).numpy()

            # Split into chunks for streaming
            chunk_samples = int(self.config.sample_rate * 0.5)  # 500ms chunks

            for i in range(0, len(audio_array), chunk_samples):
                chunk = audio_array[i:i + chunk_samples]
                if output_format == "wav":
                    yield self._audio_to_wav_bytes(chunk)
                else:
                    yield self._audio_to_pcm_bytes(chunk)

        logger.info("Streaming generation complete")

    @modal.method()
    def generate_full(
        self,
        text: str,
        language_id: str = "en",
        audio_prompt_path: Optional[str] = None,
        temperature: float = 0.8,
        exaggeration: float = 0.5,
        cfg_weight: float = 0.5,
    ) -> bytes:
        """
        Generate complete audio (non-streaming).

        Use this for cases where you need the complete audio file.
        """
        if language_id == "en":
            wav = self.turbo_model.generate(
                text,
                audio_prompt_path=audio_prompt_path,
                temperature=temperature,
            )
        else:
            wav = self.multilingual_model.generate(
                text,
                language_id=language_id,
                audio_prompt_path=audio_prompt_path,
                temperature=temperature,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight,
            )

        return self._audio_to_wav_bytes(wav.squeeze(0).numpy())

    @modal.method()
    def health_check(self) -> dict:
        """Health check endpoint."""
        return {
            "status": "healthy",
            "turbo_model_loaded": self.turbo_model is not None,
            "multilingual_model_loaded": self.multilingual_model is not None,
            "device": self.device,
        }


# WebSocket handler for real-time streaming
@app.function(
    image=chatterbox_image,
    timeout=300,
)
@modal.asgi_app()
def websocket_app():
    """
    FastAPI WebSocket application for real-time TTS streaming.

    Protocol compatible with bot-voice system:
    - Receives: JSON messages with text and configuration
    - Sends: Binary audio chunks (PCM16) + JSON status messages
    """
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    import base64

    api = FastAPI(title="Chatterbox Streaming TTS")

    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Get reference to the TTS service
    tts_service = StreamingTTSService()

    @api.get("/health")
    async def health():
        return {"status": "healthy"}

    @api.websocket("/ws/tts")
    async def websocket_tts(websocket: WebSocket):
        """
        WebSocket endpoint for streaming TTS.

        Message format (client → server):
        {
            "type": "synthesize",
            "text": "Hello world",
            "language_id": "en",
            "audio_prompt_url": null,
            "temperature": 0.8,
            "interaction_id": "session_123"
        }

        Message format (server → client):
        - Audio chunks: Binary PCM16 data
        - Status messages: JSON {"type": "status", "status": "generating|complete|error"}
        """
        await websocket.accept()
        logger.info("WebSocket connection established")

        try:
            while True:
                # Receive request
                data = await websocket.receive_text()
                request = json.loads(data)

                msg_type = request.get("type", "synthesize")

                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue

                if msg_type == "synthesize":
                    text = request.get("text", "")
                    language_id = request.get("language_id", "en")
                    audio_prompt_url = request.get("audio_prompt_url")
                    temperature = request.get("temperature", 0.8)
                    interaction_id = request.get("interaction_id", "unknown")

                    if not text:
                        await websocket.send_json({
                            "type": "error",
                            "message": "No text provided",
                            "interaction_id": interaction_id,
                        })
                        continue

                    # Send start status
                    await websocket.send_json({
                        "type": "status",
                        "status": "generating",
                        "interaction_id": interaction_id,
                    })

                    # Stream audio chunks
                    chunk_index = 0
                    for audio_chunk in tts_service.generate_streaming.remote(
                        text=text,
                        language_id=language_id,
                        audio_prompt_path=audio_prompt_url,
                        temperature=temperature,
                        output_format="pcm",
                    ):
                        # Send audio chunk as binary
                        await websocket.send_bytes(audio_chunk)
                        chunk_index += 1

                    # Send completion status
                    await websocket.send_json({
                        "type": "status",
                        "status": "complete",
                        "interaction_id": interaction_id,
                        "chunks_sent": chunk_index,
                    })

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": str(e),
                })
            except:
                pass

    @api.websocket("/talk")
    async def websocket_talk(websocket: WebSocket):
        """
        WebSocket endpoint compatible with bot-voice /talk protocol.

        This endpoint follows the Mitrol bot-voice protocol for seamless integration.
        """
        await websocket.accept()
        logger.info("bot-voice WebSocket connection established")

        # Session state
        session_state = {
            "interaction_id": None,
            "bot_name": None,
            "tarea": {},
            "voice_config": {
                "language_id": "es",
                "temperature": 0.8,
            }
        }

        try:
            while True:
                data = await websocket.receive_text()
                request = json.loads(data)

                event_name = request.get("EventName", "")
                interaction_id = request.get("InteractionId", "")
                bot_name = request.get("BotName", "")
                message = request.get("Message", "")
                tarea = request.get("Tarea", {})

                session_state["interaction_id"] = interaction_id
                session_state["bot_name"] = bot_name
                session_state["tarea"] = tarea

                if event_name == "*online":
                    # Session initialization
                    # Extract voice config from tarea if provided
                    if isinstance(tarea, dict):
                        session_state["voice_config"]["language_id"] = tarea.get("language_id", "es")
                        session_state["voice_config"]["audio_prompt_url"] = tarea.get("voice_prompt_url")

                    # Send acknowledgment
                    response = {
                        "InteractionId": interaction_id,
                        "BotName": bot_name,
                        "EventName": "*online",
                        "Tarea": tarea,
                        "Voice": {
                            "language_id": session_state["voice_config"]["language_id"],
                            "sample_rate": 24000,
                            "format": "pcm16",
                        },
                        "Events": [{
                            "name": "*text",
                            "message": "TTS service ready"
                        }]
                    }
                    await websocket.send_text(json.dumps(response))

                elif event_name == "*text":
                    # Text-to-speech request with token streaming
                    if not message:
                        continue

                    language_id = session_state["voice_config"].get("language_id", "es")
                    audio_prompt_url = session_state["voice_config"].get("audio_prompt_url")

                    # Stream audio chunks
                    for audio_chunk in tts_service.generate_streaming.remote(
                        text=message,
                        language_id=language_id,
                        audio_prompt_path=audio_prompt_url,
                        temperature=session_state["voice_config"]["temperature"],
                        output_format="pcm",
                    ):
                        # Send audio chunk as base64 in JSON (bot-voice compatible)
                        audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                        response = {
                            "InteractionId": interaction_id,
                            "BotName": bot_name,
                            "EventName": "*audio",
                            "Tarea": tarea,
                            "Events": [{
                                "name": "*audio",
                                "audio": audio_b64,
                                "format": "pcm16",
                                "sample_rate": 24000,
                            }]
                        }
                        await websocket.send_text(json.dumps(response))

                    # Send completion event
                    response = {
                        "InteractionId": interaction_id,
                        "BotName": bot_name,
                        "EventName": "*text",
                        "Tarea": tarea,
                        "Events": [{
                            "name": "*audio_complete",
                            "message": ""
                        }]
                    }
                    await websocket.send_text(json.dumps(response))

                elif event_name == "*offline":
                    # Session end
                    response = {
                        "InteractionId": interaction_id,
                        "BotName": bot_name,
                        "EventName": "*offline",
                        "Tarea": tarea,
                        "Events": [{
                            "name": "*offline",
                            "message": "Session ended"
                        }]
                    }
                    await websocket.send_text(json.dumps(response))
                    break

        except WebSocketDisconnect:
            logger.info("bot-voice WebSocket disconnected")
        except Exception as e:
            logger.error(f"bot-voice WebSocket error: {e}")

    return api


# Local development / testing entry point
@app.local_entrypoint()
def main():
    """Test the streaming TTS service locally."""
    print("Testing Chatterbox Streaming TTS...")

    service = StreamingTTSService()

    # Test health check
    health = service.health_check.remote()
    print(f"Health check: {health}")

    # Test streaming generation
    print("\nTesting streaming generation...")
    chunks = []
    for chunk in service.generate_streaming.remote(
        text="Hello, this is a test of the streaming text to speech system.",
        language_id="en",
    ):
        chunks.append(chunk)
        print(f"Received chunk: {len(chunk)} bytes")

    print(f"\nTotal chunks: {len(chunks)}")
    print(f"Total audio bytes: {sum(len(c) for c in chunks)}")

    # Test Spanish
    print("\nTesting Spanish generation...")
    spanish_chunks = []
    for chunk in service.generate_streaming.remote(
        text="Hola, esta es una prueba del sistema de síntesis de voz.",
        language_id="es",
    ):
        spanish_chunks.append(chunk)
        print(f"Received Spanish chunk: {len(chunk)} bytes")

    print(f"\nSpanish total chunks: {len(spanish_chunks)}")
