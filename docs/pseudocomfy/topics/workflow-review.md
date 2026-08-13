---
title: Workflow Review
description: A browser page, opened from the Rhino plugin, showing a workflow's full metadata and model provenance in one place.
---

# Workflow Review

**Workflow Review** is a plain link/button next to the currently-selected workflow's name in the Rhino plugin's panel. Clicking it opens a browser tab showing that workflow's full metadata and provenance — everything about the workflow other than the raw ComfyUI graph itself, all in one page, without needing the plugin UI. It replaces what used to be a "Workflow Details" panel inside the plugin.

---

## 1 • The URL contract

The page lives at:

```
/workflow-review?workflowSource=<url>&riskTolerance=<value>
```

Both are query parameters rather than a path segment — a `record_id` elsewhere in this system already has to work around a repo path containing a slash (see the [Workflow Wizard](./workflow-wizard), §3.2), and this page is never linked from site navigation, so a human-readable path buys nothing.

- **`workflowSource`** — a URL pointing at the entire Pseudorandom workflow document for the workflow in question: the exact JSON the [Workflow Wizard](./workflow-wizard) produces and downloads as `<name>.pseudorandom.json` (name, description, thumbnail, attribution, the three capability-flag objects, `variables`, `endpoint_requirements`). The one field never read here is `workflow` — the raw ComfyUI graph — which is out of scope for this page entirely.

  The page fetches this URL server-side on every load (no caching) and fails with a plain error message if it can't be fetched, or if the response doesn't look like a workflow document (missing `endpoint_requirements`).

  **How the plugin actually produces a fetchable link for the currently-loaded workflow is not wired up yet.** That mechanism doesn't exist — this is a real, open gap, not a detail left out of these docs. The document shape and the page that consumes it are both real and shipped; the delivery mechanism from the plugin isn't.

- **`riskTolerance`** — one of `high`, `low`, or `dev`, passed through from a setting in the Rhino plugin. Unlike an earlier revision of this page, it's genuinely used now — it selects how requirement scores get aggregated into the workflow-level badge (§4). Anything other than exactly `high` or `dev` — including the param being missing entirely — falls back to `low`, the most conservative aggregation. That's a deliberate choice: there's no spec for what an absent value should mean, so the page errs toward surfacing concerns rather than hiding them by default.

---

## 2 • Live re-resolution, not a snapshot

For every requirement that carries a `record_id`, the page re-fetches that model's card live (the same lookup described in the [Workflow Wizard](./workflow-wizard) §3.2) rather than trusting the `provenance` object embedded in the document. A model's review scores can change after a workflow was packaged and downloaded, and the point of showing a badge here is to reflect its status *now*, not a stale snapshot from whenever the workflow was exported.

A requirement whose `record_id` was given but doesn't resolve (broken pointer, deleted card) shows an explanatory message instead of provenance rows. A requirement that never had a `record_id` at all — added manually in the wizard, or the built-in `pseudocomfy` extension entry — is treated as its own kind of unscored requirement: its badge is computed from whatever it embedded (which, for a manual entry, is all `-1`s), so it displays the same "Review Pending" tag as a real model nobody has gotten to yet. This page doesn't currently distinguish "never meant to be reviewed" from "reviewed nothing so far" in its badge — both read identically.

One accuracy note worth knowing if you're building against this: the [Workflow Wizard](./workflow-wizard) always writes a `record_id` key (possibly `null`) for anything that came from a vetted-loader node, even if the database match failed — only Possible-Models/manual entries omit the key entirely (§4.1 there). This page's own resolution logic treats a `record_id` that's `null` the same as one that's absent, so a vetted-loader match that simply failed to resolve renders identically to a genuinely manual entry too.

---

## 3 • What the page shows, top to bottom

1. **Workflow identity** — the workflow name as the page title, with a small icon-only badge (§4) and a small thumbnail (if set) inline next to it; the description below; and, shown only when present, the author (linked to `author_url` when given) and license.

2. **Guidance Capabilities** — three groups (Global / Regional / Spatial), all eight possible flags shown always by human label (Scene Text, Style Text, Negative Text, Style Image / Regional Text, Regional Image / Spatial Depth, Spatial Edge). The ones this workflow actually uses are shown in black; the rest are shown muted — every flag is listed either way, not just the ones set `true`.

3. **Variables** — count in the heading; one card per entry in `variables[]` — name, type, description, and default/min/max/step. "This workflow has no adjustable variables." when the array is empty.

4. **Requirements** — count in the heading; one card per `endpoint_requirements[]` entry, each showing `display_name`/`requirement`, category, a visible badge tag (§4) unless it's the `pseudocomfy` extension entry (which never gets a badge), and whatever provenance fields it has — attribution, a "Source" link (`attribution_url`), license, download link, size, and, for a resolved record, reviewer, reviewed-at, license findings, evidence, and rationale.

This page's requirement cards are a separate, page-local implementation — not the same `ModelProvenanceCard` component the [Image Inspector](./workflow-wizard#6--image-drop--provenance-inspector) uses, even though both render similar-looking provenance rows. They were deliberately kept independent during this page's redesign rather than reconciled into one shared component, so a change to one doesn't necessarily apply to the other.

---

## 4 • The workflow badge

The page shows one badge for the whole workflow, next to its name — an icon-only glyph in a colored circle with a native hover tooltip, the same visual language the Rhino plugin's own icon uses (see the [Workflow Wizard](./workflow-wizard) §4.2 for the full `-1`–`3` scale and its two label sets). It's computed by `computeWorkflowBadge()`, which is a genuinely different calculation from a single requirement's badge, not just the same formula reused:

1. Every non-extension requirement's `risk_severity`/`evidence_completeness`/`evidence_reliability` (live-resolved where possible, per §2) is collected into one list. The `pseudocomfy` extension entry is excluded — it never has a reviewable score, so including it would pollute the aggregate with an automatic `-1`/`-1`/`-1`.
2. Those per-requirement triples collapse into a single triple, using an aggregation rule chosen by `riskTolerance`:
   - **`high`** — average each dimension independently across all requirements.
   - **`low`** — worst case: the maximum `risk_severity`, and the minimum of `evidence_completeness` and `evidence_reliability`, across all requirements.
   - **`dev`** — no badge is computed at all; the title shows nothing, and (per the plugin's own contract) the workflow is expected to run regardless of score in this mode.
3. That single collapsed triple is run through the same `computeRequirementBadge()` formula described in the [Workflow Wizard](./workflow-wizard) §4.2 to produce the final `-1`–`3` value.

**A real, known asymmetry between the two tolerance modes, worth understanding rather than treating as a bug you've found:** under `low`, a single unscored requirement (any `-1`) forces the collapsed `evidence_completeness`/`evidence_reliability` to `-1` via the `min()`, which sinks the *entire workflow's* badge to `-1` regardless of how good every other requirement's scores are — one review gap is enough to make the whole workflow read as unassessed. Under `high`, an unscored requirement's `-1` is folded into a plain average alongside everyone else's real scores, which can pull the workflow's effective severity or evidence numbers in a misleading direction without necessarily sinking the result to `-1` outright. This isn't hidden or accidental — it's flagged directly in the source as worth reconciling, not yet resolved. If you're relying on the `high` aggregation for anything decision-critical, know that a mix of scored and unscored requirements can currently average out to a number that doesn't obviously represent either "reviewed and fine" or "not reviewed."

**Same known rough edge as the Workflow Wizard docs:** because every live model card today still carries old-format string review scores rather than real `0`–`4` integers, every requirement currently resolves to `-1`, so every workflow's badge is currently `-1` ("We haven't checked yet") under any tolerance except `dev`. Expected, not a bug, until the cards carry real scores.

