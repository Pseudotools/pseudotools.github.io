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

- **`riskTolerance`** — passed through from whatever risk-tolerance setting exists in the plugin. The page accepts it and displays it, but nothing about the page's display logic reacts to it yet — no thresholds, no filtering. Treat it as a placeholder for future behavior, not a working feature.

---

## 2 • Live re-resolution, not a snapshot

For every requirement that carries a `record_id`, the page re-fetches that model's card live (the same lookup described in the [Workflow Wizard](./workflow-wizard) §3.2) rather than trusting the `provenance` object embedded in the document. A model's review status can change after a workflow was packaged and downloaded, and the point of showing a badge here is to reflect its status *now*, not a stale snapshot from whenever the workflow was exported.

A requirement whose `record_id` was given but doesn't resolve (broken pointer, deleted card) is shown with an explanation rather than a badge; a requirement that never had a `record_id` at all (added manually in the wizard, or the built-in `pseudocomfy` extension entry) is labeled "Manually added, not reviewed" rather than given a colored status badge — that's a deliberate distinction between "unreviewed because nobody's gotten to it" and "not the kind of thing that gets reviewed."

One accuracy note worth knowing if you're building against this: the [Workflow Wizard](./workflow-wizard) always writes a `record_id` key (possibly `null`) for anything that came from a vetted-loader node, even if the database match failed — only Possible-Models/manual entries omit the key entirely (§4.1). This page's own resolution logic treats "falsy `record_id`" (`null` or absent) as the same case, so a vetted-loader match that simply failed to resolve currently displays identically to a genuinely manual entry — "Manually added, not reviewed" — rather than as a broken pointer. Not necessarily wrong, just worth knowing if the distinction ever matters to you.

---

## 3 • What the page shows, top to bottom

1. **Workflow identity** — thumbnail (if set), the workflow name as the page title (falling back to "Untitled workflow"), its description, and — shown only when present — the author (linked to `author_url` when given) and license.

2. **Status banner** — two elements, plus a sentence:
   - An amber **"N not in database"** count badge, shown only when that count is greater than zero — covers requirements with no `record_id` at all, plus any `record_id` that failed to resolve.
   - The workflow-level status badge (§4) next to it.
   - Below both, a full sentence spelling out the breakdown rather than leaving the badge to speak for coverage on its own — e.g. *"5 of 6 requirements have a review record — 4 assessed, 1 pending review — 1 not in the database."* If nothing has completed review yet, this collapses to a plain *"No models in this workflow have completed review yet."*
   - If `riskTolerance` was passed, a muted line underneath notes it's accepted but not yet used (§1).

3. **Guidance Capabilities** — all eight possible flags, grouped Global / Regional / Spatial, shown always by human label (Scene Text, Style Text, Negative Text, Style Image / Regional Text, Regional Image / Spatial Depth, Spatial Edge). The ones this workflow actually uses are shown filled and bold; the rest are shown hollow and muted — every flag is visible either way, not just the ones set `true`.

4. **Variables** — every entry in `variables[]`: name, type, `binds_to`, description, default, and min/max/step for numeric ones. "This workflow has no adjustable variables." when the array is empty.

5. **Requirements** — one card per `endpoint_requirements[]` entry (same `ModelProvenanceCard` component the [Image Inspector](./workflow-wizard#6--image-drop--provenance-inspector) uses), each showing `display_name`, `category`, and whatever provenance fields it has — attribution, license, download link, size, and, for a resolved database record, reviewer, reviewed-at, license findings, evidence, and rationale — plus that individual requirement's own status badge or "not reviewed" label per §2.

---

## 4 • Workflow-level status

This is a separate computation from the per-model status in the [Workflow Wizard](./workflow-wizard) §4.2, built on top of it.

Every requirement, based on its **live-resolved** record (not the document's embedded copy), sorts into exactly one of three buckets:

- **assessed** — has a live database record, and that record's status is not "Not Yet Reviewed."
- **pending review** — has a live database record, but its status *is* "Not Yet Reviewed."
- **not in database** — no live record at all (this bucket doesn't distinguish "never had a `record_id`" from "had one, but it didn't resolve" — the per-card display in point 5 above does, but the rollup itself only asks "is there a record to grade at all").

**Only the assessed bucket ever influences the workflow's overall badge — worst case wins**, in this order: Potentially Problematic > Needs Review > Likely Safe > Vetted. Pending and not-in-database requirements never pull the badge in either direction. If there are zero assessed requirements, the workflow status is "Not Yet Reviewed," and the page says outright that nothing has completed review — never something that could be misread as a safety claim about a workflow nobody has actually reviewed.

This is deliberate: a workflow badge implying a verdict about a model nobody has actually reviewed would be a false claim, so review coverage is always shown as plainly as the verdict itself.

**Same known rough edge as the Workflow Wizard docs, §4.2:** because every live model card today still carries old-format string review scores rather than real `0`–`4` integers, every requirement currently resolves to "Not Yet Reviewed," so every workflow's assessed count is currently zero and every workflow shows "Not Yet Reviewed" here too. Expected, not a bug, until the cards carry real scores.

