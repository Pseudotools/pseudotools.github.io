---
title: Workflow Wizard
description: How the Package Workflow wizard converts a ComfyUI export into a Pseudorandom workflow, and how the Image Info provenance inspector reads it back out of a render.
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

You don't need to hand-write any of this. The **Package Workflow** wizard builds it for you from a workflow you've already built in ComfyUI — you upload an export, confirm what it detected, and download a `.pseudorandom.json` file.

---

## 1 • Using the Wizard

The wizard is a six-step form at `/package-workflow`:

1. **Upload** — drop in your ComfyUI workflow JSON (see §2 for the required export type). The wizard parses it immediately and reports how many nodes it found, plus counts of database models, possible model files, unrecognized loaders, variables, and seed nodes.
2. **Models** — every model picked via a *vetted* loader node in ComfyUI. The wizard looks each one up in the model database (by model ID, falling back to filename) and shows its category, vetting status, license, and attribution. Anything it can't match is flagged for you to fill in by hand on the next step.
3. **Other Models** — every other filename-shaped string the wizard found in the graph (e.g. `.safetensors`, `.ckpt`, `.pt` files on ordinary loader nodes), plus any loader node that looks like it loads a model but exposes no filename at all (this happens with preset-based loaders like the IPAdapter unified loader — the wizard can see the node but not which file it resolves to at runtime). Confirm which ones are real requirements, set their category, and fill in provenance by hand. You can also add a model manually here if the scan missed something entirely.
4. **Variables** — one row per `PseudoVar*` node found in the graph (see §5). Name each one (this also generates its `binds_to` token), write a short description, and confirm the default/min/max/step. Seed nodes are listed separately here too, but they aren't configurable — the plugin drives the seed automatically.
5. **Metadata** — workflow name, description, optional thumbnail, attribution (author/author URL/license), and the global/regional/spatial guidance capability checkboxes. Capabilities are pre-checked based on how the graph is wired (see §3) — you're confirming, not starting from scratch.
6. **Preview & Download** — review the assembled JSON and download it as `<workflow_name>.pseudorandom.json`, ready to drop into a workflow library.

---

## 2 • What the Wizard Expects as Input

The wizard only accepts a ComfyUI **API export** — in ComfyUI, **Workflow → Export (API)**, not the plain **Save**/**Export** menu item.

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

This is the same shape ComfyUI's own `/prompt` endpoint consumes, and the graph the wizard embeds is handed to that endpoint unmodified at render time — a canvas export (positions, wiring, but not a runnable prompt) would package cleanly but could never actually render, so the wizard rejects it outright with an explanation, rather than failing silently later.

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

**Model requirement scanning:**

- Nodes matching a known *vetted loader* class type (`PseudoVettedCheckpointLoader`, `PseudoVettedControlNetLoader`, `PseudoVettedLoraLoader`, `PseudoVettedClipLoader`, `PseudoVettedVaeLoader`, and — pending, see §5 — a CLIP Vision equivalent) are looked up against the model database and become `endpoint_requirements` entries sourced from that database record.
- Every other string in the graph that ends in a model-weight-shaped extension (`.safetensors`, `.ckpt`, `.pt`, `.pth`, `.bin`, `.onnx`, `.sft`, `.gguf`) and isn't already claimed by a vetted loader is surfaced as a "possible model" for you to confirm or dismiss.
- Loader nodes that pick a model by preset label instead of filename (e.g. an IPAdapter unified loader) resolve their model at runtime and never show a filename in the graph at all, so the scan can't name them automatically — the wizard flags the node itself so it isn't silently dropped.
- Any other node whose class type contains "Loader" and that the scan didn't otherwise account for gets the same catch-all flag, on the assumption that by ComfyUI convention a "Loader" node loads something off disk.
- If the workflow uses any `Pseudo*`-prefixed node at all, a `pseudocomfy` custom-node requirement is added automatically (ComfyUI's API export carries no record of which extension a node came from, so the `Pseudo` class-type prefix is the only signal available).

**Capability auto-detection:** the wizard reads which output slots of `PseudoUnpackModelSnapshot` are actually wired to something downstream, and pre-checks the matching capability box in step 5 (slot 0 → regional text, slot 3 → global scene prompt, slot 6 → spatial depth, etc.) — see §5 for the full slot map. You're free to override any of these; auto-detection just saves re-confirming what the graph already shows.

---

## 4 • What the Wizard Outputs

The output is a complete Pseudorandom workflow JSON matching the [Workflow Specification](./workflow-specification), assembled as:

- `type`, `name`, `description`, `thumbnail`, `attribution` — from step 5 (Metadata).
- `global_guidance_capabilities`, `regional_guidance_capabilities`, `spatial_guidance_capabilities` — from step 5's checkboxes.
- `variables` — one entry per confirmed variable, in the order `name`, `type`, `description`, `default`, `binds_to`, then `min`/`max`/`step` for numeric types.
- `endpoint_requirements` — the combined list from steps 2 and 3, plus the automatic `pseudocomfy` requirement when applicable.
- `workflow` — the token-substituted graph from §3.

### Provenance sub-object — TBD, pending Claudius

Each `endpoint_requirements` entry the wizard produces currently includes two fields not yet reflected in the published [Workflow Specification](./workflow-specification):

```json
{
  "category": "checkpoints",
  "requirement": "sd_xl_base_1.0.safetensors",
  "provenance_id": "…uuid from the model database, or null…",
  "vetting_status": "vetted | community | unknown",
  "provenance": { "...": "as documented in the Workflow Specification, §8" }
}
```

`provenance_id` points back to the model database record a requirement was matched against (used by the Image Info inspector, §6, to fetch live data rather than relying on the copy baked into the file). `vetting_status` reflects that same record's review state. Both are populated by the wizard today, but the finalized shape of this sub-object is still pending confirmation — don't treat it as settled until the Workflow Specification is updated to match.

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
| `PseudoUnpackModelSnapshot` | Unpack Model Snapshot | Unpacks a loaded snapshot into its guidance outputs (material prompts/images/masks, environment prompts, depth/edge/style images). Which output slots are wired downstream is what drives capability auto-detection in §3. |

For a `PseudoVar*` node, the value the wizard reads for its default comes from whichever of the node's `val`/`value` inputs holds a literal (not a wire) — and its **name comes from the node's title** in ComfyUI (`_meta.title`), i.e. whatever you renamed the node to on the canvas, not the class type. Renaming a variable node from "Value" to "Mask Softness" is what gives you a variable named "Mask Softness" with `binds_to: "__MASK_SOFTNESS__"`.

**Vetted model loaders**, which pull their model choice from the model database rather than a bare filename, are also detected: `PseudoVettedCheckpointLoader`, `PseudoVettedControlNetLoader`, `PseudoVettedLoraLoader`, `PseudoVettedClipLoader`, `PseudoVettedVaeLoader`. A CLIP Vision equivalent is referenced in the wizard's node-matching config but has not yet shipped in Pseudocomfy — treat it as pending until it appears in the node package.

---

## 6 • Image Drop / Provenance Inspector

The **Image Info** page (`/image-info`) is the read side of all this: drop in a PNG rendered by the Pseudorandom Rhino plugin, and it shows you what went into that render.

**How it works:** every render the plugin produces embeds a `tEXt` chunk (keyword prefixed `pseudorandom_v`) in the PNG containing the workflow's `endpoint_requirements` and an environmental-impact record. The inspector reads that chunk directly in the browser — no upload to a server — and then, for any requirement that carries a `provenance_id`, looks that ID up live against the model database rather than trusting the copy embedded in the file (the database is the living record and may have been corrected since the image was rendered). If the live lookup fails — the pointer is broken, or the record's gone — it falls back to whatever provenance was baked into the image itself, and says so.

**What you see:**

- **Environmental Impact** — energy usage (kWh), carbon (kg CO₂e), water use (L), and worker location for the render, when that data was recorded. If it wasn't captured at render time, the inspector says so rather than guessing.
- **Model Provenance**, one card per endpoint requirement — its category and vetting status, plus attribution, license, download link, file size, and training-data notes, sourced live from the database when possible ("Live from the model database") or from the image's own embedded copy otherwise ("Recorded in the image"). If neither has anything, it says so plainly.
- **Lineage** — for models that have it, one hop of related records (e.g. a dataset or base model it was derived from) with a plain-language relationship label. This is not walked recursively — only direct relationships are shown.
- **Raw metadata** — the full decoded chunk, collapsed by default, for anyone who wants to see exactly what was embedded.

See §4 above for the caveat on `provenance_id`/`vetting_status` — the same TBD note applies here, since this inspector is what actually consumes those fields.

