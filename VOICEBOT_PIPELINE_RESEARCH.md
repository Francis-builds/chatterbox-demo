# Investigacion: Pipeline de Voicebot Sub-200ms

## Contexto del Problema

**Pipeline actual (nuestro):** Audio → STT API → LLM API → TTS API → Audio
**Latencia actual:** ~2s p50
**Target competidor:** 200ms p50 (pasando por SIP + red movil Mexico)

El competidor esta usando SLM + lambda local + audio embeddings. No es full-duplex.

---

## 1. Por que nuestro pipeline actual es lento

Cada paso agrega latencia acumulativa:

| Paso | Latencia tipica | Problema |
|------|----------------|----------|
| Red movil + SIP | ~50-80ms | Fijo, no controlable |
| STT (Whisper API / Google) | 300-800ms | Espera audio completo, transcribe, responde |
| LLM API (GPT-4, Claude) | 500-1500ms | TTFT alto, red ida/vuelta a cloud |
| TTS API (ElevenLabs, etc.) | 200-500ms | Genera audio, otra ida/vuelta cloud |
| **Total** | **~1.5-3s** | Pipeline serial, 3 network hops |

**Problema fundamental:** 3 servicios cloud en serie = 3 round-trips de red + 3 colas de inferencia.

---

## 2. Como lograr 200ms p50: Las 3 Arquitecturas Viables

### Arquitectura A: Speech-to-Speech Nativa (Elimina TODO el pipeline)

**Modelo unico que recibe audio y genera audio directamente.**

| Modelo | Params | Latencia | Hardware | Notas |
|--------|--------|----------|----------|-------|
| **Moshi (Kyutai)** | 7B | 160-200ms | 1x L4 GPU | Full-duplex, streaming, codec Mimi. CC-BY 4.0 |
| **Qwen2.5-Omni** | 9B | ~200ms | 1x GPU | Thinker/Talker architecture, 26 idiomas |
| **GLM-4-Voice** | 9B | ~200ms | 1x GPU | 26 idiomas, multi-turn |
| **Mini-Omni2** | 0.5B | <200ms | Consumer GPU | Qwen2 base, SNAC tokenizer, vision+audio |
| **LLaMA-Omni** | 8B | Baja | 1x GPU | Basado en Llama-3.1-8B-Instruct, ICLR 2025 |

**Ventaja:** Un solo modelo, cero pipeline, latencia minima.
**Desventaja:** Calidad de razonamiento inferior a LLMs texto puros. Function calling limitado.

**Papers clave:**
- Moshi: https://arxiv.org/abs/2410.00037
- Mini-Omni: https://arxiv.org/abs/2408.16725
- Mini-Omni2: https://arxiv.org/abs/2410.11190

---

### Arquitectura B: Audio Embeddings + SLM Local (MAS PROBABLE del competidor)

**Elimina STT como paso separado. El audio entra directamente al LLM como embeddings.**

```
Audio → Whisper Encoder (solo encoder, NO decoder/transcripcion)
     → Multimodal Projector → embedding space del LLM
     → SLM local (1-8B params)
     → Audio tokens (SNAC/EnCodec)
     → Vocoder local
     → Audio output
```

**Componentes clave:**

#### Input: Ultravox (Fixie AI)
- Usa el **encoder** de whisper-large-v3-turbo para generar audio embeddings
- Un "multimodal projector" mapea esos embeddings al espacio del LLM
- **TTFT: ~150ms** en A100
- El LLM "escucha" el audio como tokens nativos, sin transcripcion intermedia
- Backbone: Llama 3.1 8B o GLM 4.6
- Versiones desde 1B hasta 70B params
- GitHub: https://github.com/fixie-ai/ultravox
- Versiones en HuggingFace: v0.4 hasta v0.7

#### LLM: SLM local con inferencia ultra-rapida
- **Llama 3.2 1B/3B** cuantizado a INT4 → corre en CPU/edge
- **Qwen2 0.5B** → usado por Mini-Omni2
- Inferencia via **vLLM** con FP8 quantization
- **Cerebras:** 2,100+ TPS en Llama 3.3 70B, TTFT <200ms
- **Groq:** Sub-400ms TTFT, optimizado para chat/voice

#### Output: Orpheus TTS + SNAC
- **Orpheus TTS (3B, Llama backbone):** Genera SNAC audio tokens
- **Streaming latencia: ~100-200ms** con input streaming
- SNAC tokenizer: 7 tokens por frame, decodificacion incremental
- Corre en **1x RTX 3090** (24GB VRAM)
- **Together AI** lo ofrece como API
- GitHub: https://github.com/canopyai/Orpheus-TTS

#### Output alternativo: Kyutai Pocket TTS (100M params)
- **Corre en CPU** - no necesita GPU para TTS
- **Sub-50ms latencia**, 6x mas rapido que real-time en MacBook M4
- Streaming progresivo, voice cloning incluido
- Solo 100M parametros, Apache 2.0
- GitHub: https://github.com/kyutai-labs/pocket-tts

---

### Arquitectura C: Pipeline Optimizado (STT→LLM→TTS pero ultra-rapido)

**Mantiene pipeline pero optimiza cada paso al maximo con edge deployment.**

```
Audio → Streaming STT (NVIDIA Parakeet: 72ms TTFT)
     → SLM local cuantizado (Llama 3.2 1B, INT4)
     → Streaming TTS (Pocket TTS: <50ms / Orpheus: ~130ms)
     → Audio
```

| Componente | Opcion | Latencia | Notas |
|------------|--------|----------|-------|
| STT | NVIDIA Parakeet TDT 1.1B | 72ms TTFT | 100+ idiomas, WER 1.92% |
| STT | Deepgram Nova | 118ms TTFT | 35+ idiomas, robusto a ruido |
| LLM | Llama 3.2 1B (INT4, local) | 30-80ms TTFT | vLLM/llama.cpp |
| LLM | Groq API (Llama 3.1 8B) | <200ms TTFT | Si prefieres cloud |
| TTS | Kyutai Pocket TTS | <50ms | CPU-only, 100M params |
| TTS | Orpheus TTS (vLLM+SNAC) | ~130ms TTFB | GPU, mejor calidad |
| TTS | Deepgram Aura-2 | <200ms TTFB | Cloud API |

**Total teorico:** 150-300ms (sin red). Con SIP+movil: 200-400ms.

---

## 3. Que esta haciendo el competidor (hipotesis mas probable)

Dado:
- 200ms p50 incluyendo SIP + red movil Mexico (~50-80ms)
- Usa SLM + lambda local + audio embeddings
- No es full-duplex

**Hipotesis: Arquitectura B con Ultravox + SLM + Orpheus/Pocket TTS**

```
SIP → Audio chunks (streaming)
   → Ultravox encoder (audio → embeddings, ~50ms)
   → SLM local 1-3B cuantizado (~30-50ms TTFT)
   → Orpheus/SNAC streaming (~100ms primer chunk)
   → Audio response
```

**Budget de latencia:**
- SIP + red movil: ~50-80ms
- Audio encoding + embedding: ~50ms
- SLM inference (TTFT): ~30-50ms
- TTS first audio chunk: ~50-100ms
- **Total: ~180-280ms** ← cuadra con 200ms p50

**Hardware probable:** 1x GPU (A10/L4/RTX 4090) por instancia, con lambda/serverless scaling.

---

## 4. Recomendacion: Plan de Migracion

### Fase 1: Quick Win (1-2 semanas)
**Reemplazar TTS cloud por Pocket TTS local**
- Elimina un network hop completo
- Sub-50ms en CPU
- pip install pocket-tts
- Voice cloning incluido

### Fase 2: Eliminar STT como paso separado (2-4 semanas)
**Adoptar Ultravox como reemplazo de STT+LLM**
- Audio embeddings directo al LLM
- TTFT ~150ms incluye "entender" el audio
- Deploy en Cerebrium o GPU propia
- https://www.cerebrium.ai/blog/deploying-ultravox-on-cerebrium

### Fase 3: Pipeline completo local (4-8 semanas)
**Stack final:**
```
SIP → Streaming audio
   → Ultravox (audio embeddings + SLM, 1-8B)
   → Orpheus TTS + SNAC (streaming audio tokens)
   → Audio response
```

**Orquestar con:**
- **Pipecat (by Daily):** Framework para voice AI pipelines
  - Soporte nativo para Ultravox: https://docs.pipecat.ai/server/services/stt/ultravox
- **LiveKit:** Voice pipeline agents, WebRTC nativo

### Fase 4: Evaluar Speech-to-Speech puro (investigacion)
**Si el razonamiento del SLM es suficiente para el caso de uso:**
- Probar Moshi (Kyutai) - 200ms, full-duplex
- Probar Qwen2.5-Omni - 200ms, multimodal
- Evaluar si la calidad de respuesta es aceptable sin LLM texto

---

## 5. Papers y Referencias Clave para Revisar

### Arquitectura de Modelos
1. **Moshi** - Speech-text foundation model for real-time dialogue
   https://arxiv.org/abs/2410.00037

2. **Mini-Omni** - Language Models Can Hear, Talk While Thinking in Streaming
   https://arxiv.org/abs/2408.16725

3. **Mini-Omni2** - Towards Open-source GPT-4o with Vision, Speech and Duplex
   https://arxiv.org/abs/2410.11190

4. **Low-Latency End-to-End Voice Agents for Telecom** (Aug 2025)
   https://arxiv.org/html/2508.04721v1 - Directamente relevante a nuestro caso SIP

5. **Speech-to-Speech Models 2026 Review** - Comparativa de las 3 arquitecturas
   https://ai.ksopyla.com/posts/voice-to-voice-models-2026-review/

### Audio Tokenizers
6. **SNAC** - Multi-Scale Neural Audio Codec (usado por Orpheus, Mini-Omni2)
7. **Mimi** - Neural audio codec de Kyutai (usado por Moshi)
8. **EnCodec** - Meta's neural audio codec

### Deployment y Optimizacion
9. **Voice AI Stack 2026** - AssemblyAI
   https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents

10. **Orpheus streaming con vLLM + SNAC**
    https://bitbasti.com/blog/audio-streaming-with-orpheus

11. **Ultravox en Cerebrium** - Deploy guide
    https://www.cerebrium.ai/blog/deploying-ultravox-on-cerebrium

---

## 6. Sobre Chatterbox (nuestro repo actual)

Chatterbox es un **TTS-only** de alta calidad (500M params, 24kHz, voice cloning). Para el pipeline de voicebot:

- **No reemplaza** STT ni LLM
- Latencia TTS: 1.5-2.5s (Turbo) / 3-6.5s (Regular) - demasiado lento para 200ms target
- Tiene `AlignmentStreamAnalyzer` para streaming parcial, pero no esta expuesto
- **Veredicto:** Chatterbox no es viable para el target de 200ms. Orpheus (streaming SNAC, ~130ms TTFB) o Pocket TTS (<50ms, CPU) son mejores opciones para este caso de uso.

Chatterbox sigue siendo valioso para:
- Generacion de audio offline de alta calidad
- Voice cloning con control de emocion fino (exaggeration, CFG)
- Soporte multilingue (23 idiomas) para contenido pre-generado
