# RouteFlow

Hybrid walk/drive route optimisation for last-mile delivery. Pastes a list of UK postcodes, decides per-segment whether to drive or walk, and clusters nearby drops so the courier parks once and walks to multiple addresses before moving on.

- **Frontend:** React 18 (UMD via CDN, in-browser Babel — no build step), Google Maps JS API, custom dark theme.
- **Backend:** Supabase Postgres + Auth + Realtime + Edge Functions (Deno).
- **Routing:** Google Distance Matrix for travel times, Google Directions for road-following polylines, Google Geocoding for unmatched postcodes (UK addresses prefer postcodes.io batch lookup).
- **Algorithm:** divisive hierarchical clustering with a 12-min walking-diameter cap, per-cluster TSP (NN multi-start + 2-opt + or-opt + 2-opt) for the walking inside each cluster, and a separate driving TSP across cluster anchors.

---

## Quick start (local)

```bash
# 1. Clone + enter
git clone https://github.com/<your-username>/routeflow-web-app.git
cd routeflow-web-app

# 2. Copy the config template and fill in keys
cp config.example.js config.local.js
# edit config.local.js -> set SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_MAPS_KEY

# 3. Serve the static files (any static server works)
python -m http.server 5173
# or: npx serve -l 5173 .

# 4. Open
# http://localhost:5173/RouteFlow.html
```

Demo account (after seeding it in Supabase Auth — see `BACKEND_HANDOFF.md` §8):
- email `demo@routeflow.app`
- password `demo123`

---

## Required Supabase setup

Run the SQL in `BACKEND_HANDOFF.md` §2 + §3 against your Supabase project. That creates:

- `profiles`, `trips`, `stops`, `activity`, `driver_positions` tables
- RLS policies (every user sees only their own rows)
- A `handle_new_user` trigger that auto-creates a `profiles` row on signup
- `user_stats` view for the analytics page
- `supabase_realtime` publication + `replica identity full` on the relevant tables

Then deploy the edge function:

```bash
# Using the Supabase CLI from this repo's root
supabase functions deploy optimise-route --project-ref <your-project-ref>
```

Edge function source is meant to live at `supabase/functions/optimise-route/index.ts` — see `BACKEND_HANDOFF.md` §6 for the canonical version. (The repo currently relies on the deployed copy; if you want infra-as-code, mirror it locally and check it in.)

---

## Required Google Cloud APIs

In your Google Cloud project, enable:

- Maps JavaScript API
- Geocoding API
- Distance Matrix API
- Directions API
- Routes API (newer, optional)

Restrict the key to your domain via **APIs & Services → Credentials → HTTP referrer**. The same key is used client-side (Maps + Directions) and server-side (Distance Matrix + Geocoding) by the edge function — server-side calls don't honour HTTP referrer restrictions, so set up an additional unrestricted server key if you want defence in depth.

---

## File map

```
RouteFlow.html        Static shell. Loads Supabase SDK + config.local.js + all .jsx via Babel.
config.example.js     Template for the keys block.
config.local.js       (gitignored) your real keys.
store.js              window.RF data layer - auth, trips, stops, realtime, optimiser invocation.
ui.jsx                Reusable UI: ToastProvider, Sidebar, MobileHeader, FakeMap (Google Maps).
icons.jsx             Inline SVG icon set (window.I).
app.jsx               Top-level routing + auth gate.
page-landing.jsx      Marketing landing.
page-auth.jsx         Sign in / Sign up / Try the demo.
page-dashboard.jsx    KPIs, recent trips, live activity feed.
page-create.jsx       Multi-step trip creation wizard.
page-optimise.jsx     Optimisation progress + result preview.
page-live.jsx         Live delivery view (full-screen Google Map + bottom sheet).
page-summary.jsx      Per-trip summary + CSV export.
page-misc.jsx         Settings + Analytics.
styles.css            Theme + component styles.
BACKEND_HANDOFF.md    Original spec for the Supabase backend + edge function.
```

---

## How the optimiser works

`hybrid` mode (the smart courier mode):

1. **Geocode** every input postcode. Fast path is the free postcodes.io batch endpoint (UK only). Misses fall through to Google Geocoding, then to the postcodes.io outcode centroid as a last-resort safety net. Postcodes that resolve nowhere are returned in `response.skipped`.
2. **Coarse haversine grouping** at 1.5 km — a loose net so any potentially walkable pair starts in the same group.
3. **Walking distance matrix** per group via Google Distance Matrix (batched ≤100 elements per call).
4. **Divisive bisection** — recursively split any cluster whose pairwise walking diameter exceeds 12 min, using the farthest pair as seeds and assigning every other stop to whichever seed it's closer to.
5. **Walking TSP** inside each cluster: NN multi-start (start, midpoint, end) → 2-opt → or-opt (segment lengths 1/2/3) → 2-opt again, with a forced rotation so the original start index is index 0.
6. **Driving distance matrix** between cluster anchors (first stop of each cluster).
7. **Driving TSP** through the anchors (same solver chain).
8. Output flat stop sequence with `cluster_id`, `cluster_size`, `is_park_anchor`, mode-tagged segments, and per-cluster diagnostics in the response (`max_walk_min`, `mean_walk_min`, `drive_from_prev_min`).

`walking` and `driving` modes skip the cluster step and run a single full-network TSP at the chosen mode.

The frontend renders **real road polylines** by calling `google.maps.DirectionsService` per segment with concurrency 6, falling back to a faint straight line if a Directions request fails.

---

## License

Personal project / BSc final year — not currently licensed for redistribution.
