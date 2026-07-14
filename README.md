# Amah Phone Copilot

**A dialect-speaking, cross-app GUI agent for elderly Chinese immigrants.** Speak one sentence in Cantonese; the phone does the task itself.

> Status: **Stage 0 prototype — validated end-to-end.** Two flows run on a real Android environment at 100% success. See [results](#results) and the full write-up in [`docs/stage0-findings.md`](docs/stage0-findings.md).

---

## Why

Many overseas Chinese seniors speak Cantonese, Teochew, Hokkien, Taishanese, or dialect-mixed English — not standard Mandarin, not written English. In the U.S. alone, **69% of Chinese Americans aged 55+ have limited English proficiency, and over half live in a household where no one over 14 speaks English fluently.** Standard voice assistants don't recognize their dialects; app interfaces are in a language they can't read. They are shut out of their own phones at exactly the moments a family member isn't around — calling their children abroad, finding a bus, filling an arrival card at a border.

They are excluded three times over: by the local language, by *standard* Mandarin (so even a Chinese-language app doesn't help), and by the GUI itself. Only **dialect voice input + real on-device task execution** breaks through all three layers.

**The goal is not to make seniors adapt to complicated apps. It's to make the phone adapt to them.**

---

## What it does

The elder's entire interface is **one button**. Hold it, say one sentence in dialect, answer *yes/no* once. Zero typing, zero reading, zero maps, zero multiple-choice.

Two tasks in this prototype:

| Task | Elder says | The agent does |
|---|---|---|
| **Dialect calling** | 「帮我打畀阿女」(*call my daughter*) | Matches the family whitelist → confirms in Cantonese → dials via Android Intent |
| **Dialect navigation** | 「我想去唐人街」(*I want to go to Chinatown*) | Opens Maps → picks a route by the family's preference → speaks turn-by-turn **landmark** directions in Cantonese |

The phone's GUI is the agent's **workbench**, not the elder's interface. The elder only ever hears and speaks.

---

## Results

Measured on a real Android emulator (API 34, Play Store image), brain = Claude Opus 4.8 via the Claude Agent SDK, execution = ADB:

| Flow | Success | Avg turns | Avg cost | Mechanism |
|---|---|---|---|---|
| Dialect calling | **5/5 (100%)** | 12.6 | $0.66 | Intent-direct `ACTION_CALL` — fast, no GUI, no snags |
| Dialect navigation | **3/3 (100%)** | 19.0 | $0.98 | `geo:` launch → GUI loop → landmark Cantonese guidance |

The navigation run showed real judgment: on finding transit unavailable (destination too close), it **auto-downgraded to walking per the family's preference without asking the elder**, but — because the plan changed from *ride* to *walk* — **honestly re-confirmed once**, and silently dismissed 3 system permission dialogs. See [`docs/stage0-findings.md`](docs/stage0-findings.md) for per-run data and analysis.

---

## Architecture

```
Dialect sentence (text in Stage 0)
        │
        ▼
   Claude (intent → plan → GUI decisions)
        │  reads: contacts.json / places.json / prefs.json  (family-managed config)
        ▼
   ADB tool layer  (screenshot · ui_dump · tap · swipe · key · type · launch_intent)
        │
        ▼
   Android emulator (API 34, Google Maps preinstalled)
```

Two hard rules baked into the design:

- **Intent-first.** Anything reachable by an Android Intent (dialing, launching Maps) skips GUI tapping entirely — faster and far more robust. GUI clicking is the fallback, not the default.
- **The failure exit is always "call your daughter."** Any dead end routes back to the whitelist's emergency contact. The failure mode *is* a core feature.

### The elder-side contract (non-negotiable)

**One tap + one sentence + one yes/no. No typing, no reading, no maps, no multiple-choice.** When a route has options, the agent picks one by the family's preset preference and just tells the elder — it never hands them a list.

### Safety

- **Whitelist-only dialing, enforced in code** — every `tel:` intent is digit-matched against `contacts.json` at the tool layer (`src/policy.ts`) before execution, so even a misled model cannot dial an unlisted number (blocks the most common elder-targeting scam). Prompt rules are guidance; this gate is deterministic.
- **Confirmation gate** — every dial / navigation start is restated in Cantonese and waits for *yes*.
- Family-managed config is the single source of truth for contacts, places, and preferences.

---

## Repo layout

```
src/
  adb.ts        7 ADB primitives; ui_dump distills the a11y tree into a
                coordinate-tagged element list (token-lean, easy to target)
  tools.ts      those primitives as Agent SDK tools + speak/confirm elder channels
  agent.ts      main loop: dialect in → Claude → tool execution → JSONL log
config/         contacts.json / places.json / prefs.json (family-managed, demo data)
scripts/
  assemble-sdk.sh      assemble SDK from mirror zips + build AVD (China-network workaround)
  post-boot-setup.sh   install IME, set mock location, verify Maps
  smoke-adb.ts         verify all 7 ADB primitives on a live device (7/7)
  run-eval.ts          batch-run a flow N times → success rate → eval-summary.jsonl
docs/stage0-findings.md   quantified results + Stage 1 spike list
```

## Quick start

Prereqs: macOS + an Android emulator/device on `adb`, Node 20+. Set `ANTHROPIC_API_KEY`.

```bash
npm install

# One-time: assemble the emulator + build the AVD (see script for the China-mirror path)
bash scripts/assemble-sdk.sh
emulator -avd stage0 -no-snapshot -no-boot-anim &

# After boot: install IME, set mock location, verify Maps
bash scripts/post-boot-setup.sh

# Verify the tool layer, then run a flow
npx tsx scripts/smoke-adb.ts
npx tsx src/agent.ts "帮我打畀阿女"      # dialect calling
npx tsx src/agent.ts "我想去唐人街"      # dialect navigation

# Batch evaluation
npx tsx scripts/run-eval.ts "帮我打畀阿女" 5
```

---

## Roadmap

**Stage 0 (this repo) — proof the chain works.** Dialect → intent → cross-app GUI execution, validated end-to-end. Brain = Opus, execution = ADB, input = text.

**Stage 1 — competition / on-device build:**
- Swap the brain to **on-device Gemma 3n** (with Gemini as cloud fallback) — offline-capable, the answer to the "no SIM at the border" scenario.
- Real **Cantonese ASR** (Stage 0 uses text input to isolate the GUI-agent question) and on-device TTS — elder-facing speech already goes through real Cantonese TTS (macOS `say`, zh_HK voice) as a placeholder for the on-device engine.
- **Accessibility Service** instead of ADB (zero-config, survives reboot, `isAccessibilityTool` legitimacy for the elder-accessibility use case).
- A **system-dialog auto-handler** — the biggest snag Stage 0 surfaced (permission popups, banners eating turns in long GUI flows).

---

## Honest limitations (Stage 0)

- Input is **text**, not real speech (ASR is Stage 1). Output speech is real Cantonese TTS on the host Mac (`say -v Sinji`); on-device TTS is Stage 1.
- Brain is **Claude Opus 4.8**, not the on-device model.
- Runs on an **emulator**, not a real phone; calls don't actually connect (no SIM), WeChat untested (emulator anti-fraud).
- The navigation batch is N=3 (single runs are slow) — directional signal, not statistically rigorous.

These are precisely what Stage 1 addresses. The Stage 0 architecture is model-agnostic: swapping the brain is a config change, not a rewrite.
