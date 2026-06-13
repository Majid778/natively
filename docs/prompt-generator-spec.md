# Prompt Generator — Spec & Variations

_Status: draft for review (no implementation). Author handoff: pick a variation (or composition) when you come back._

## 1. What this is

Natively's copilot quality is gated by the **Mode prompt** — the system instructions injected into every AI-panel request. A Mode today is:

```ts
type RealtimeMode = {
  id: string;
  name: string;
  prompt: string;                 // ← the thing that determines answer quality
  referenceFiles?: ModeReferenceFile[];
  createdAt: string;
  updatedAt: string;
};
```

Users create Modes in **Settings → Manage Modes** (`src/components/settings/ManageModesSettings.tsx`). Today "New Mode" starts from a static `DEFAULT_MODE_PROMPT` and the user hand-writes the rest into a textarea (placeholder _"Define this mode's speaking style and instructions…"_).

**The problem:** most users can't write a good real-time-copilot prompt. They type "help me in my interview" and get generic answers. A great prompt encodes role, the other party, goal, tone, answer format (terse one-liners vs talking points), domain vocabulary, and guardrails (first-person, speakable, no hallucinated facts). The **prompt generator** closes that gap — the user describes their situation, we produce a polished Mode prompt.

## 2. Where it hooks in (shared by all variations)

- **Entry point:** a **"Generate with AI"** button next to **"New Mode"** in Manage Modes (`handleCreateMode` is the sibling). It produces a `RealtimeMode` and drops the user into the existing editor so they can tweak before saving — generation is a _starting point_, never a black box.
- **Output contract:** every variation emits `{ name, prompt }` (+ optionally suggested `referenceFiles` prompts). It slots straight into `modesConfig.modes`. Nothing downstream changes.
- **Generation engine:** reuse the already-configured text model (OpenRouter → Gemini 2.5 Flash) via the existing `generateSuggestion`/LLMHelper path. No new provider, no new keys.
- **Context we can pull in for free** (differentiator — most prompt tools can't): the active **calendar meeting** (title/description/attendees), past **meeting summaries**, and uploaded **reference files**. A generator that reads the calendar invite is meaningfully better than a blank box.
- **House style guardrail:** generated prompts must match the proven "General" mode voice — _first-person, concise, natural to say out loud live, confident, specific, no invented facts._ This is a fixed clause in the meta-prompt regardless of variation.

## 3. Design axes (what the variations trade against)

| Axis | Lightweight ⟶ Ambitious |
|---|---|
| **Input method** | pick-a-template → short wizard → freeform sentence → auto-from-context |
| **Generation** | deterministic interpolation → single LLM call → multi-candidate LLM → adaptive/learning |
| **Control vs friction** | high control/high friction → low friction/low control |
| **Cost/latency** | $0 instant → 1 call → N calls → ongoing |
| **Effort to build** | hours → 1–2 days → 2–3 days → 1–2 weeks |

---

## 4. Variations

### Variation A — Template Library (deterministic, no LLM)
Curated, expert-written Mode templates with fill-in slots.

- **UX:** user picks a template (Job Interview, Sales Discovery, Negotiation, Standup, Lecture/Study, Customer Support, Podcast Guest, Cold Call…), fills 3–5 slots (your role, company, your name, goal, tone), template interpolates → finished Mode.
- **Generation:** string interpolation. No API call.
- **Pros:** instant, free, 100% predictable quality, works offline, ships fastest. Doubles as great onboarding ("here's what a good mode looks like").
- **Cons:** bounded by the template set; least personalized; someone has to author/maintain the templates.
- **Effort:** ~hours.

### Variation B — Guided Wizard → LLM Synthesis  ⭐ recommended core
A short structured wizard whose answers feed one LLM call.

- **UX:** 4–6 quick questions — _What kind of call? Your role & goal? Who's on the other side? Tone (calm / assertive / warm)? Answer style (one-liners / talking points / full script)? Domain or keywords?_ → "Generate".
- **Generation:** answers → meta-prompt → text model → polished Mode prompt. Optionally generate **2–3 candidates** and let the user pick (cheap with Flash; big quality lift).
- **Pros:** personalized to any scenario, reuses existing OpenRouter integration, structured inputs keep quality consistent, candidates de-risk a single bad generation. Best quality-per-effort.
- **Cons:** one (or few) API calls — small cost/latency; meta-prompt needs tuning.
- **Effort:** ~1–2 days.

### Variation C — Freeform Describe → LLM Synthesis (lowest friction)
One text box: _"Describe your situation."_

- **UX:** e.g. _"Senior backend interview at a fintech; I want concise STAR answers in my own voice, calm and confident."_ → one call → structured Mode.
- **Generation:** single LLM call; the model infers all structure.
- **Pros:** fastest UX, feels magical, near-zero UI.
- **Cons:** garbage-in/garbage-out; least consistent; hard to guarantee the house style without the wizard's scaffolding.
- **Effort:** ~half day (it's Variation B with the wizard replaced by a textarea — they share the backend).

### Variation D — Context-Aware / Adaptive (ambitious, differentiating)
Generation is wired into the app's own context and improves over time.

- **D1 — Auto from invite:** when a calendar meeting is selected, one click generates a Mode from the meeting title/description/attendees (e.g. a recruiter screen invite → an interview Mode pre-filled with the role).
- **D2 — Learns from outcomes:** after calls, refine the Mode based on what was actually asked (e.g. it notices repeated system-design questions and tightens the prompt), surfaced as a suggested edit the user approves.
- **Pros:** strongest moat — turns prompt-writing into a non-task; leverages data Natively already has.
- **Cons:** most complex; D2 needs a feedback signal and careful UX so it never silently degrades a working Mode.
- **Effort:** D1 ~2–3 days; D2 ~1–2 weeks.

---

## 5. Recommended composition (one coherent product, phased)

1. **Phase 1 —** Ship **A (templates)** as the New-Mode starting points _and_ build **B (wizard → 2–3 candidates)**. Templates seed the wizard's defaults; the wizard personalizes them. This alone covers ~90% of users.
2. **Phase 2 —** Add **C** as an "Advanced / quick" tab on the same generator (shares B's backend) for power users who'd rather type a sentence.
3. **Phase 3 —** Add **D1 (auto-from-invite)** — the highest-leverage differentiator once the generator exists.
4. **Later —** **D2 (adaptive)** as a roadmap bet.

## 6. Meta-prompt sketch (the prompt that writes prompts — for B/C/D)

```
You write SYSTEM PROMPTS for a real-time spoken copilot. The prompt you produce will be
injected before live-call context, and the model's output is read aloud or paraphrased by
the user in the moment.

Produce a system prompt that:
- speaks in the FIRST PERSON as the user (it generates what THEY should say),
- yields CONCISE, natural, speakable lines — not essays,
- is confident, specific, and practical; never invents facts about the user,
- adapts to: {callType}, role/goal {role}, other party {counterpart}, tone {tone},
  answer style {answerStyle}, domain {domain}.

Output ONLY the system prompt text. No preamble, no markdown.
[For multi-candidate: return 3 distinct variants separated by "---".]
```

Inputs come from the wizard (B), the freeform box (C), or calendar/summary context (D). Always append the fixed house-style guardrail clause.

## 7. Output contract

Generator returns `{ name: string; prompt: string }` (name auto-suggested from callType+counterpart, editable). Drops into the existing `createMode()` → editor flow; user reviews, edits, saves. No schema change to `RealtimeMode` or `ModesConfig`.

## 8. Open questions (decide on return)

- **Candidates:** generate 1 or 3? (3 ≈ 3× tokens on Flash — negligible, big quality win → lean 3.)
- **Templates:** how many to author for Phase 1, and who owns them? (Suggest ~8 covering the top call types.)
- **Reference files:** should the generator also suggest _what_ reference material to upload (e.g. "paste the job description"), or just the prompt text?
- **Calendar coupling (D1):** opt-in per meeting, or always offer? Privacy framing matters.
- **Failure UX:** if the model returns junk/empty, fall back to a template (A) silently or show an error?
- **Naming:** "Generate with AI", "Smart Mode", "Mode Builder"? (Keep it plain — see the recent copy cleanup.)
