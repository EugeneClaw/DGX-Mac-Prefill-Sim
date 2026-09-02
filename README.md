# DGX-Mac-Prefill-Sim

A token speed simulator for local LLM hardware. Pick a DGX Spark cluster configuration and a Mac Studio, pick a model, and watch them work through the same real ~60,000-token agentic context in real time — prefill first, then the typed-out reply.

**Who it's for:** anyone comparing Mac Studio generations for local LLM speed (M3 Ultra vs M5 Max vs M5 Ultra, across 96/128/256/512 GB configurations), and anyone weighing Mac Studio against DGX Spark clusters — machines whose memory bandwidth looks far lower on paper, yet which prefill MoE models significantly faster in practice, and which scale by simply adding units.

**Why the gap:** prefill is compute-bound and scales with the silicon you can put in parallel, while decode is memory-bandwidth-bound — which is why the Macs win the streaming numbers and the Spark clusters win the wait. The simulator models both phases separately so you can see where each machine wins.

## Try it

**https://eugeneclaw.github.io/DGX-Mac-Prefill-Sim/**

Nothing to install, nothing to run — it's a static page, served by GitHub
Pages. Works on desktop and phone.

## The numbers

Decode figures marked **M** are measured on real hardware; **~** figures are
modelled. All figures are based on credible published sources and local
testing. M5 Ultra figures are not yet measurable (hardware ships late
September 2026) and are derived from Apple's announced performance relative to
its own previous generation.

## License

MIT
