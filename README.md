# DGX-Mac-Prefill-Sim

A token speed simulator for local LLM hardware. Pick a DGX Spark cluster configuration and a Mac Studio, pick a model, and watch them work through the same real ~60,000-token agentic context in real time — prefill first, then the typed-out reply.

**Who it's for:** anyone comparing Mac Studio generations for local LLM speed (M3 Ultra vs M5 Max vs M5 Ultra, across 96/128/256/512 GB configurations), and anyone weighing Mac Studio against DGX Spark clusters — machines whose memory bandwidth looks far lower on paper, yet which prefill MoE models significantly faster in practice, and which scale by simply adding units.

**Why the gap:** prefill is compute-bound and scales with the silicon you can put in parallel, while decode is memory-bandwidth-bound — which is why the Macs win the streaming numbers and the Spark clusters win the wait. The simulator models both phases separately so you can see where each machine wins, and serving-stack choice (llama.cpp / vLLM / MLX) is included because it moves prefill throughput more than the hardware does.

## Run

Any static file server works:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## How it works

- **Cold first.** The default race assumes no prefix cache — the honest first
  turn. The results card then invites you to run it again warm (95% prefix
  cached, an agent's normal state) so you can feel the difference.
- **Measured vs modelled.** Decode numbers marked **M** come from published
  community receipts; **~** numbers are modelled from hardware bandwidth and
  serving-stack efficiency. M5 Ultra lanes are pre-release estimates.
- **Serving stack matters.** Each side can toggle between llama.cpp and
  tuned vLLM (Spark) or llama.cpp-Metal and MLX (Mac) — the stack shifts
  prefill throughput more than the silicon does.

`site/race-data.json` contains every lane with its provenance: bandwidth,
usable TFLOPS, stack efficiency, quant sizes, and the source class of each
figure.

## Provenance highlights

- 2× DGX Spark decode receipts: MiaAI_lab published prose tables
- Single-Spark Qwen3.8-27B decode: independent measured bake-off (131–137 t/s)
- M3 Ultra 512 decode receipt: Omar Shabab's published GLM-5.1 measurements
- Prefill law calibrated against vLLM PR #41834 (2× Spark, 1.65–1.78k t/s)
  and the mlx systematic benchmark set (M3 Ultra usable ~54 TFLOPS)

Full per-lane provenance (source class + URL) ships inside
`site/race-data.json`.

## License

MIT
