---
title: Workflow Wizard
description: How the Workflow Converter (Package Workflow) wizard turns a ComfyUI export into a Pseudorandom workflow, and how the Image Inspector reads it back out of a render.
---

# Workflow Wizard

Here's what a finished **Pseudorandom workflow** file looks like — the format described in full in the [Workflow Specification](./workflow-specification):

```json
{
  "pseudorandom_workflow_schema_version": 0.3,
  "type": "comfy",
  "name": "Architectural Daytime",
  "description": "...",
  "thumbnail": null,
  "attribution": { "author": "...", "author_url": "...", "license": "..." },
  "global_guidance_capabilities": { "txt_scene": true, "txt_style": true, "txt_negative": true, "img_style": false },
  "regional_guidance_capabilities": { "text": true, "image": false },
  "spatial_guidance_capabilities": { "depth": true, "edge": false },
  "variables": [ /* see §5 */ ],
  "endpoint_requirements": [ /* see §4 */ ],
  "workflow": { /* the ComfyUI graph, with tokens substituted in */ }
}
```

You don't need to hand-write any of this. The wizard — labeled **Workflow Converter** in the app, at the `/package-workflow` route — builds it for you from a workflow you've already built in ComfyUI: you upload an export, confirm what it detected, and download a `.pseudorandom.json` file.

:::note Model provenance moved off Supabase
As of this revision, model provenance no longer lives in a Supabase table. Every vetted model is now its own [Hugging Face](https://huggingface.co/) repo card under the `pseudotools` org, and everything below — model lookups, `endpoint_requirements`, and how a review badge gets computed — reflects that. See §4 for the current shape, including a note on a couple of rough edges that haven't fully settled yet.
:::

---

## 1 • Using the Wizard

The wizard is a six-step form:

1. **Upload** — drop in your ComfyUI workflow JSON (see §2 for the required export type). The wizard parses it immediately and reports how many nodes it found, plus counts of database models, possible model files, unrecognized loaders, variables, and seed nodes.
2. **Database Models** — every model picked via a *vetted* loader node in ComfyUI. The wizard looks each one up (by pointer, falling back to filename — see §3.1) and shows its category, review badge, license, and attribution. Anything it can't match is flagged for you to fill in by hand on the next step.
3. **Possible Models** — every other filename-shaped string the wizard found in the graph (e.g. `.safetensors`, `.ckpt`, `.pt` files on ordinary loader nodes), plus any loader node that looks like it loads a model but exposes no filename at all (this happens with preset-based loaders like the IPAdapter unified loader — the wizard can see the node but not which file it resolves to at runtime). Confirm which ones are real requirements, set their category, and fill in provenance by hand. You can also add a model manually here if the scan missed something entirely.
4. **Variables** — one row per `PseudoVar*` node found in the graph (see §5). Name each one (this also generates its `binds_to` token), write a short description, and confirm the default/min/max/step. Seed nodes are listed separately here too, but they aren't configurable — the plugin drives the seed automatically.
5. **Metadata** — workflow name, description, optional thumbnail, attribution (author/author URL/license), and the global/regional/spatial guidance capability checkboxes. Capabilities are pre-checked based on how the graph is wired (see §3) — you're confirming, not starting from scratch.
6. **Preview** — review the assembled JSON and download it as `<workflow_name>.pseudorandom.json`, ready to drop into a workflow library.

---

## 2 • What the Wizard Expects as Input

The wizard only accepts a ComfyUI **API export** — in ComfyUI, **Workflow → Export (API)**, not the plain **Save**/**Export** menu item. It rejects anything else outright (a distinct message for a canvas export vs. anything else unrecognized) rather than failing silently later.

An API export is a flat JSON object mapping node ID → node:

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": { "seed": 0, "steps": 20, "model": ["4", 0], "...": "..." },
    "_meta": { "title": "KSampler" }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" },
    "_meta": { "title": "Load Checkpoint" }
  }
}
```

This is the same shape ComfyUI's own `/prompt` endpoint consumes, and the graph the wizard embeds is handed to that endpoint unmodified at render time — a canvas export (positions, wiring, but not a runnable prompt) would package cleanly but could never actually render.

A node's editable value lives under `inputs`; a wired (as opposed to literal) input is a two-element array `[sourceNodeId, outputSlot]` rather than a plain value. A node's user-facing name is whatever you renamed it to in ComfyUI, carried in `_meta.title`.

**The wizard will refuse to package a workflow that has no `PseudoLoadModelSnapshot` node** — without it the workflow can never receive scene data from the Rhino plugin. It will also warn (but not block) if it finds more than one snapshot loader, or no `PseudoSeed` node (the workflow still renders, just with a fixed, non-rerollable seed).

---

## 3 • What the Wizard Changes

Converting the raw graph into a workflow file is mostly a matter of finding known custom nodes and replacing their literal values with reserved tokens, plus scanning the rest of the graph for models to declare as requirements.

**Token substitution** (applied to a cloned copy of the graph — your uploaded file is never modified):

| Node found | Field replaced | Replaced with |
| --- | --- | --- |
| `PseudoVarInt` / `PseudoVarFloat` / `PseudoVarString` | `val` (or `value` on older nodes) | `__<VARIABLE_NAME>__`, slugified from the name you give it in step 4 |
| `PseudoSeed` | `val`/`value` | `__PSEUDORANDOM_SEED__` (every seed node gets the same token — the plugin drives one seed for the whole workflow) |
| `PseudoLoadModelSnapshot` | `string_path` | `__PSEUDORANDOM_TEMP_PATH__` |

Everything else in the graph — wiring, other nodes, other fields — passes through untouched.

### 3.1 • Model requirement scanning

- Nodes matching a known *vetted loader* class type (six today — see §5) are looked up against the model database and become `endpoint_requirements` entries sourced from that record.
- Every other string in the graph that ends in a model-weight-shaped extension (`.safetensors`, `.ckpt`, `.pt`, `.pth`, `.bin`, `.onnx`, `.sft`, `.gguf`) and isn't already claimed by a vetted loader is surfaced as a "possible model" for you to confirm or dismiss.
- Loader nodes that pick a model by preset label instead of filename (e.g. an IPAdapter unified loader) resolve their model at runtime and never show a filename in the graph at all, so the scan can't name them automatically — the wizard flags the node itself so it isn't silently dropped.
- Any other node whose class type contains "Loader" and that the scan didn't otherwise account for gets the same catch-all flag, on the assumption that by ComfyUI convention a "Loader" node loads something off disk.
- If the workflow uses any `Pseudo*`-prefixed node at all, a `pseudocomfy` custom-node requirement is added automatically (ComfyUI's API export carries no record of which extension a node came from, so the `Pseudo` class-type prefix is the only signal available).

### 3.2 • Model lookup backend

For every vetted-loader node found, the wizard resolves it against a live web API — there is no local database and no Supabase involvement anywhere in this path anymore:

- **Primary lookup, by pointer** — `GET /api/models/hf/{record_id}`. `record_id` is a Hugging Face repo path under the `pseudotools` org (e.g. `pseudotools/checkpoint-juggernaut-x-hyper`). Because that path contains a literal `/`, each segment is percent-encoded separately when the request URL is built — encoding the whole ID as one segment would break the route.
- **Fallback, by filename** — `GET /api/models/hf/by-filename/{filename}`, used when there's no pointer yet (e.g. re-processing a graph where the loader only has a filename set). This one is more expensive: Hugging Face's listing API doesn't expose filenames, so the backend fetches and parses candidate repo cards one at a time until it finds a match. Fine at today's scale (a handful of repos); worth revisiting if the catalog grows.
- **Model-picker/dropdown listing** — `GET /api/models?category={category}`, where `category` is derived from each repo's Hugging Face tag, mapped to the same ComfyUI folder spelling the vetted loaders themselves use (`checkpoints`, `controlnet`, `clip_vision`, `loras`) — these four now agree exactly. **`clip` and `vae` still have no Hugging Face category mapping at all** — models in those two categories can be resolved directly by `record_id` or filename, but will never appear in a category-filtered listing.

Every one of these calls live-fetches Hugging Face on the server side — see [§4.3, Caching](#43--caching) for how that's made fast without a hand-rolled cache. A 404/not-found from the detail lookup is a normal, expected state — a model that hasn't been catalogued yet — not an error condition.

### 3.3 • Capability auto-detection

The wizard reads which output slots of `PseudoUnpackModelSnapshot` are actually wired to something downstream, and pre-checks the matching capability box in step 5 (slot 0 → regional text, slot 3 → global scene prompt, slot 6 → spatial depth, etc.) — see §5 for the full slot map. You're free to override any of these; auto-detection just saves re-confirming what the graph already shows.

---

## 4 • What the Wizard Outputs

The output is a complete Pseudorandom workflow JSON matching the [Workflow Specification](./workflow-specification), assembled as:

- `type`, `name`, `description`, `thumbnail`, `attribution` — from step 5 (Metadata).
- `global_guidance_capabilities`, `regional_guidance_capabilities`, `spatial_guidance_capabilities` — from step 5's checkboxes.
- `variables` — one entry per confirmed variable, in the order `name`, `type`, `description`, `default`, `binds_to`, then `min`/`max`/`step` for numeric types.
- `endpoint_requirements` — the combined list from steps 2 and 3, plus the automatic `pseudocomfy` requirement when applicable.
- `workflow` — the token-substituted graph from §3.

### 4.1 • `endpoint_requirements` — the confirmed, shipped shape

Every requirement has `display_name`, `category`, `requirement`, and `provenance` — always. `record_id` is a Hugging Face repo path, and whether that *key* is present at all depends on how the requirement was captured, not on whether it happened to resolve:

- **Requirements from a vetted-loader node** (step 2) always carry a `record_id` key — a string when the database lookup succeeded, `null` when it didn't. Either way, `provenance` is the *full* 14-key shape below (all `null`/`-1` when there was no match).
- **Requirements from the Possible Models step or the built-in `pseudocomfy` extension entry** never carry a `record_id` key at all — it's omitted, not `null`. `provenance` here is a smaller 6-key shape, because a manually-entered or scanned requirement was never run through review in the first place.

**Vetted, matched** (`record_id` present and non-null):

```json
{
  "display_name": "Stable Diffusion XL Base 1.0",
  "category": "checkpoints",
  "requirement": "sd_xl_base_1.0.safetensors",
  "record_id": "pseudotools/checkpoint-sdxl-base-1-0",
  "provenance": {
    "download_url": "string | null",
    "size_bytes": "number | null",
    "license_id": "string | null",
    "license_url": "string | null",
    "attribution_name": "string | null",
    "attribution_url": "string | null",
    "reviewer": "string | null",
    "reviewed_at": "string | null",
    "license_findings": "string | null",
    "evidence": "string | null",
    "rationale": "string | null",
    "risk_severity": "0-4, or -1 if not yet assigned",
    "evidence_completeness": "0-4, or -1 if not yet assigned",
    "evidence_reliability": "0-4, or -1 if not yet assigned"
  }
}
```

**Not vetted** (manual entry, a scanned-and-confirmed possible model, or a fixed requirement like `pseudocomfy` — `record_id` key absent entirely):

```json
{
  "display_name": "My Custom LoRA",
  "category": "loras",
  "requirement": "my_custom_lora.safetensors",
  "provenance": {
    "download_url": "string | null",
    "size_bytes": "number | null",
    "license_id": "string | null",
    "license_url": "string | null",
    "attribution_name": "string | null",
    "attribution_url": "string | null"
  }
}
```

Only 6 keys in that second shape — no reviewer/review-score fields, because this kind of entry was never reviewed. Don't render blank rows for the missing 8 keys; they're absent on purpose.

The `category` written here is always the ComfyUI model-subfolder spelling (`checkpoints`, `clip`, `clip_vision`, `controlnet`, `loras`, `vae`) — that's what determines where the file lands on disk at render time, independent of whether the database lookup succeeded, and independent of the Hugging Face category tag discussed in §3.2.

`provenance_id` and `vetting_status` — from an earlier revision of this schema — are both gone. `provenance_id` (a Supabase UUID) is replaced by `record_id` (a Hugging Face repo path) above. `vetting_status`'s old three-value enum (`vetted | community | unknown`) is replaced entirely by the three numeric review-score fields above, plus the status computation in §4.2 — there is no longer a single vetting-status string baked into the exported JSON at all.

### 4.2 • How the review badge is determined

**The exported JSON never contains a computed badge.** It only contains the three raw `risk_severity` / `evidence_completeness` / `evidence_reliability` scores shown above. Every consumer that wants to show a badge — the Model Database, this wizard's own model picker, the Image Inspector, the [Workflow Review](./workflow-review) page, and the Rhino plugin's own icon (a separate, non-shared implementation of the same formula) — computes it from those three numbers using one shared function, `computeRequirementBadge()`.

The result is a single integer, **`-1` through `3`**, not a named status string:

```
certainty = min(evidence_completeness, evidence_reliability)

risk_severity == -1 or certainty == -1   →  -1
certainty <= 1                            →   0
risk_severity >= 3                        →   1
risk_severity <= 1                        →   3
else (risk_severity == 2)                 →   2
```

`certainty` — the *weaker* of completeness and reliability, not an average — gates whether `risk_severity` is even trustworthy enough to report at all: a severe-sounding risk score backed by weak evidence resolves to `0` ("insufficient information"), not to whatever the raw severity number alone would suggest. This is the same instinct as the wizard's earlier five-level status formula, just re-numbered — a serious-sounding finding still can't outrun how well-supported it is.

Each integer has two different label sets depending on where it's shown — an icon-only tooltip variant (used by the Rhino plugin's own badge and this app's title-row badges, where there's no room for a full pill) and a visible text-tag variant (used anywhere a model or requirement gets its own card or row):

| Value | Icon tooltip | Visible tag |
| --- | --- | --- |
| `-1` | "We haven't checked yet" | Review Pending |
| `0` | "We looked, but can't tell" | Insufficient information |
| `1` | "We have significant concerns" | Not recommended |
| `2` | "We have some concerns" | Potentially problematic |
| `3` | "Looks good, have fun!" | Healthy |

Note the ordering isn't monotonic risk-to-safety in the way you might expect from the numbers alone — `1` ("Not recommended") is a stronger warning than `2` ("Potentially problematic"), because `1` means `risk_severity` itself scored high, while `2` is the middle ground where severity is moderate. Go by the label, not by assuming higher-number-is-worse or better-is-higher.

A [Workflow Review](./workflow-review#4--the-workflow-badge) badge is a further aggregation on top of this same formula, not a separate system — see that page for how multiple requirements collapse into one workflow-level number.

**Known rough edge, worth calling out explicitly:** every model card in the database today still carries the *old*, pre-badge 3-value string scores (`"low"`, `"conditional"`, etc.) rather than real `0`–`4` integers, so right now every model resolves to `-1` regardless of what its old string values said. This isn't a bug — it's the expected state until the cards are re-authored with real numeric scores.

### 4.3 • Caching

Every Hugging Face fetch the wizard's model lookups ultimately depend on (§3.2) is cached for 24 hours server-side (Next.js's built-in fetch cache, not a hand-rolled one) — first request after a cold cache pays the real Hugging Face round-trip, every request after that for the next 24h is served from cache. This is shared across everyone hitting the deployment, not per-user, and it's why a model lookup in this wizard is typically fast even though it's a live fetch under the hood. The tradeoff is up to 24h of staleness after someone edits a card on Hugging Face directly — expected, not a bug, and there's no manual bypass today.

---

## 5 • Custom Nodes

The wizard detects these Pseudocomfy custom nodes by their ComfyUI `class_type`. All of the following ship in the [Pseudocomfy](https://github.com/Pseudotools/Pseudocomfy) custom nodes package today, under the `Pseudocomfy/Vars` and `Pseudocomfy/IO` categories:

| Node (`class_type`) | Display name | What it does |
| --- | --- | --- |
| `PseudoVarInt` | Int Variable | An integer value, exposed as a tunable `variables[]` entry. |
| `PseudoVarFloat` | Float Variable | A float value, exposed as a tunable `variables[]` entry. |
| `PseudoVarString` | String Variable | A string value, exposed as a tunable `variables[]` entry. |
| `PseudoSeed` | Seed | Produces the render seed. Not user-configurable in the wizard — it's detected, tokenized, and driven by the plugin automatically rather than listed under `variables[]`. |
| `PseudoLoadModelSnapshot` | Load Model Snapshot | Loads the snapshot JSON (see the snapshot format) from a local path or URL at render time. Its `string_path` is what the wizard tokenizes to `__PSEUDORANDOM_TEMP_PATH__`. |
| `PseudoUnpackModelSnapshot` | Unpack Model Snapshot | Unpacks a loaded snapshot into its guidance outputs (material prompts/images/masks, environment prompts, depth/edge/style images). Which output slots are wired downstream is what drives capability auto-detection in §3.3. |

For a `PseudoVar*` node, the value the wizard reads for its default comes from whichever of the node's `val`/`value` inputs holds a literal (not a wire) — and its **name comes from the node's title** in ComfyUI (`_meta.title`), i.e. whatever you renamed the node to on the canvas, not the class type. Renaming a variable node from "Value" to "Mask Softness" is what gives you a variable named "Mask Softness" with `binds_to: "__MASK_SOFTNESS__"`.

**Vetted model loaders**, which pull their model choice from the model database rather than a bare filename, are all six shipped today:

| `class_type` | ComfyUI category written to `endpoint_requirements` |
| --- | --- |
| `PseudoVettedCheckpointLoader` | `checkpoints` |
| `PseudoVettedControlNetLoader` | `controlnet` |
| `PseudoVettedLoraLoader` | `loras` |
| `PseudoVettedClipLoader` | `clip` |
| `PseudoVettedClipVisionLoader` | `clip_vision` |
| `PseudoVettedVaeLoader` | `vae` |

(ClipVision was previously listed as pending here — it's shipped now, no longer a placeholder.)

**Known coverage gap:** there's no vetted loader node for IPAdapter models yet, even though the model database already recognizes `ipadapter` as a category — an IPAdapter model in a graph today is only ever picked up via the Possible Models scan or the preset-loader flag (§3.1), not a dedicated database-backed picker. Conversely, `clip` and `vae` have vetted loader nodes but (per §3.2) no matching Hugging Face category yet, so those two can be resolved by direct pointer but never appear in a category-filtered model list.

---

## 6 • Image Drop / Provenance Inspector

The **Image Inspector** (`/image-info`) is the read side of all this: drop in a PNG rendered by the Pseudorandom Rhino plugin, and it shows you what went into that render, across two tabs — **Environmental data** and **Model provenance**.

**How it works:** every render the plugin produces embeds a `tEXt` chunk (keyword prefixed `pseudorandom_v`) in the PNG containing the workflow's `endpoint_requirements` and an environmental-impact record. The inspector reads that chunk directly in the browser — no upload to a server.

**Requirements are resolved differently depending on when the image was rendered**, since the inspector has to stay backward-compatible with images rendered before the Hugging Face migration:

- **Post-migration images** carry a `record_id` per requirement. For each one, the inspector looks it up live against `GET /api/models/hf/:id` (never the old Supabase-backed route) and shows a **RiskBadge** — the same five-level status from §4.2 — sourced from that live record. If the pointer doesn't resolve, it says so plainly rather than guessing.
- **Pre-migration images** never had a `record_id` — they embedded a flat Supabase-shaped `vetting_status` string plus a flat provenance object (`download_url`/`attribution`/`attribution_url`/`license`/`data_provenance_notes`/`size_bytes`) directly in the PNG. The inspector recognizes that old shape, normalizes it into the current field names, and displays it with the legacy **VettingBadge** — it does not attempt to re-resolve these against any live pointer; a pre-migration Supabase `provenance_id`, if one happens to be present, is simply never read.

**Environmental data tab** — carbon (kg CO₂e), energy (kWh), water use (L), and worker location for the render, when that data was recorded. If it wasn't captured at render time, the inspector says so rather than guessing.

**Model provenance tab:**

- One **Model Provenance** card per endpoint requirement (the same `ModelProvenanceCard` component used by the [Workflow Review](./workflow-review) page) — category, attribution, license, download link, file size, and — for resolved post-migration records — reviewer, reviewed-at, license findings, evidence, and rationale, with the badge described above.
- A **Model lineage** graph, shown above the requirement cards: an interactive node graph (scatter/flow/layers/timeline layout options, zoom-to-expand) linking the dropped image to whatever it requires, and from there out to related datasets, papers, organizations, and people.

  **This graph looks like a shipped, live feature, but a meaningful part of what it draws is not live data.** Only the root node (the image you dropped) and its direct "requires" edges to your actual `endpoint_requirements` are computed from real, live metadata. Everything the graph shows beyond that — what a checkpoint was trained on, who published a referenced paper, what a community LoRA was built on top of — comes from the same hand-assembled, desk-research fixture dataset used by the separate, explicitly-labeled-as-a-sketch "Lineage Sketch" page in the model provenance app (not part of this docs site). Nodes the graph can't map to that fixture data are shown as an unverified placeholder (labeled as such in the on-page legend) rather than omitted. Treat anything in this graph beyond your own image's direct requirements as illustrative, not authoritative, until it's backed by something real.

- **Raw metadata** is not currently exposed as a separate collapsible panel in this revision of the page — if you need the exact embedded JSON, use the browser's dev tools against the dropped file or the PNG's own `tEXt` chunk directly.

