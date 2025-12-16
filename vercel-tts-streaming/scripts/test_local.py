#!/usr/bin/env python3
"""
Local TTS Test Script

This script tests the Chatterbox TTS locally without requiring Modal deployment.
Use this to verify the TTS is working before deploying to production.

Usage:
    python scripts/test_local.py

Requirements:
    pip install chatterbox-tts torch torchaudio
"""

import sys
import os
import time
import wave
import argparse

# Add the parent directory to path for chatterbox imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

def test_basic_tts():
    """Test basic TTS generation."""
    import torch
    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS

    print("=" * 60)
    print("Testing Basic TTS (English)")
    print("=" * 60)

    # Detect device
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    print(f"Using device: {device}")

    # Load model
    print("Loading model...")
    start_time = time.time()
    model = ChatterboxTTS.from_pretrained(device=device)
    load_time = time.time() - start_time
    print(f"Model loaded in {load_time:.2f}s")

    # Generate audio
    text = "Hello! This is a test of the Chatterbox text-to-speech system."
    print(f"\nGenerating audio for: '{text}'")

    start_time = time.time()
    wav = model.generate(text)
    gen_time = time.time() - start_time

    # Save audio
    output_path = "test_output_en.wav"
    ta.save(output_path, wav, model.sr)

    print(f"Generation time: {gen_time:.2f}s")
    print(f"Audio saved to: {output_path}")
    print(f"Sample rate: {model.sr} Hz")
    print(f"Duration: {wav.shape[1] / model.sr:.2f}s")

    return True


def test_multilingual_tts():
    """Test multilingual TTS with Spanish."""
    import torch
    import torchaudio as ta
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    print("\n" + "=" * 60)
    print("Testing Multilingual TTS (Spanish)")
    print("=" * 60)

    # Detect device
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    print(f"Using device: {device}")

    # Load model
    print("Loading multilingual model...")
    start_time = time.time()
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    load_time = time.time() - start_time
    print(f"Model loaded in {load_time:.2f}s")

    # Test Spanish
    text = "Hola, bienvenido al sistema de síntesis de voz. Esta es una prueba en español."
    print(f"\nGenerating Spanish audio for: '{text}'")

    start_time = time.time()
    wav = model.generate(text, language_id="es")
    gen_time = time.time() - start_time

    output_path = "test_output_es.wav"
    ta.save(output_path, wav, model.sr)

    print(f"Generation time: {gen_time:.2f}s")
    print(f"Audio saved to: {output_path}")
    print(f"Duration: {wav.shape[1] / model.sr:.2f}s")

    return True


def test_turbo_tts():
    """Test Turbo TTS for low-latency applications."""
    import torch
    import torchaudio as ta
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    print("\n" + "=" * 60)
    print("Testing Turbo TTS (Low Latency)")
    print("=" * 60)

    # Detect device
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    print(f"Using device: {device}")

    # Load model
    print("Loading Turbo model...")
    start_time = time.time()
    model = ChatterboxTurboTTS.from_pretrained(device=device)
    load_time = time.time() - start_time
    print(f"Model loaded in {load_time:.2f}s")

    # Generate audio
    text = "Hello! This is the turbo model optimized for low latency voice applications."
    print(f"\nGenerating audio for: '{text}'")

    start_time = time.time()
    wav = model.generate(text)
    gen_time = time.time() - start_time

    output_path = "test_output_turbo.wav"
    ta.save(output_path, wav, model.sr)

    print(f"Generation time: {gen_time:.2f}s")
    print(f"Audio saved to: {output_path}")
    print(f"Duration: {wav.shape[1] / model.sr:.2f}s")

    # Calculate RTF (Real-Time Factor)
    audio_duration = wav.shape[1] / model.sr
    rtf = gen_time / audio_duration
    print(f"Real-Time Factor (RTF): {rtf:.2f}x")
    print(f"  (< 1.0 means faster than real-time)")

    return True


def test_streaming_simulation():
    """Simulate streaming token generation."""
    import torch
    import torch.nn.functional as F
    from transformers.generation.logits_process import (
        LogitsProcessorList,
        TemperatureLogitsWarper,
        TopKLogitsWarper,
        TopPLogitsWarper,
        RepetitionPenaltyLogitsProcessor,
    )
    from chatterbox.tts_turbo import ChatterboxTurboTTS, punc_norm

    print("\n" + "=" * 60)
    print("Testing Streaming Token Generation")
    print("=" * 60)

    # Detect device
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    print(f"Using device: {device}")

    # Load model
    print("Loading Turbo model...")
    model = ChatterboxTurboTTS.from_pretrained(device=device)

    text = "Hello, this is a streaming test."
    text = punc_norm(text)

    t3 = model.t3
    tokenizer = model.tokenizer

    # Tokenize
    text_tokens = tokenizer(text, return_tensors="pt", padding=True, truncation=True)
    text_tokens = text_tokens.input_ids.to(device)

    # Setup
    logits_processors = LogitsProcessorList([
        TemperatureLogitsWarper(0.8),
        TopKLogitsWarper(1000),
        TopPLogitsWarper(0.95),
        RepetitionPenaltyLogitsProcessor(1.2),
    ])

    speech_start_token = t3.hp.start_speech_token * torch.ones_like(text_tokens[:, :1])
    embeds, _ = t3.prepare_input_embeds(
        t3_cond=model.conds.t3,
        text_tokens=text_tokens,
        speech_tokens=speech_start_token,
        cfg_weight=0.0,
    )

    # Simulate streaming generation
    print("\nSimulating streaming token generation...")
    print("Tokens generated per chunk (target: 15 for ~600ms):\n")

    generated_tokens = []
    chunk_size = 15
    chunk_count = 0

    llm_outputs = t3.tfmr(inputs_embeds=embeds, use_cache=True)
    hidden_states = llm_outputs[0]
    past_key_values = llm_outputs.past_key_values

    speech_hidden = hidden_states[:, -1:]
    speech_logits = t3.speech_head(speech_hidden)
    processed_logits = logits_processors(speech_start_token, speech_logits[:, -1, :])
    probs = F.softmax(processed_logits, dim=-1)
    next_token = torch.multinomial(probs, num_samples=1)

    generated_tokens.append(next_token)
    current_token = next_token

    start_time = time.time()
    first_chunk_time = None

    for i in range(100):  # Max 100 tokens
        current_embed = t3.speech_emb(current_token)
        llm_outputs = t3.tfmr(
            inputs_embeds=current_embed,
            past_key_values=past_key_values,
            use_cache=True
        )

        hidden_states = llm_outputs[0]
        past_key_values = llm_outputs.past_key_values
        speech_logits = t3.speech_head(hidden_states)

        input_ids = torch.cat(generated_tokens, dim=1)
        processed_logits = logits_processors(input_ids, speech_logits[:, -1, :])

        if torch.all(processed_logits == -float("inf")):
            break

        probs = F.softmax(processed_logits, dim=-1)
        next_token = torch.multinomial(probs, num_samples=1)

        generated_tokens.append(next_token)
        current_token = next_token

        # Simulate chunk output
        if len(generated_tokens) % chunk_size == 0:
            chunk_count += 1
            chunk_time = time.time() - start_time

            if first_chunk_time is None:
                first_chunk_time = chunk_time
                print(f"  Chunk {chunk_count}: {chunk_size} tokens at {chunk_time*1000:.0f}ms (FIRST CHUNK!)")
            else:
                print(f"  Chunk {chunk_count}: {chunk_size} tokens at {chunk_time*1000:.0f}ms")

        if torch.all(next_token == t3.hp.stop_speech_token):
            break

    total_time = time.time() - start_time
    total_tokens = len(generated_tokens)

    print(f"\n  Total tokens: {total_tokens}")
    print(f"  Total time: {total_time*1000:.0f}ms")
    print(f"  First chunk TTFB: {first_chunk_time*1000:.0f}ms")
    print(f"  Tokens/second: {total_tokens/total_time:.1f}")

    return True


def main():
    parser = argparse.ArgumentParser(description="Local TTS Test Script")
    parser.add_argument("--test", choices=["basic", "multilingual", "turbo", "streaming", "all"],
                       default="all", help="Which test to run")

    args = parser.parse_args()

    print("Chatterbox TTS Local Test")
    print("=" * 60)

    try:
        if args.test in ["basic", "all"]:
            test_basic_tts()

        if args.test in ["multilingual", "all"]:
            test_multilingual_tts()

        if args.test in ["turbo", "all"]:
            test_turbo_tts()

        if args.test in ["streaming", "all"]:
            test_streaming_simulation()

        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("=" * 60)

    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
