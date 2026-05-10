# RouteFlow — Backend Handoff (Supabase + Realtime)

This document is a complete, executable spec for an IDE agent (Cursor, Claude Code, etc. via MCP) to take the existing RouteFlow frontend and wire a real Supabase backend with realtime sync. Every frontend behaviour is mapped to a concrete backend operation.

---

## 0 — Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 (already built — `RouteFlow.html` + `*.jsx`) |
| Auth | Supabase Auth (email + password) |
| DB | Supabase Postgres |
| Realtime | Supabase Realtime (Postgres changes) |
| Storage | Supabase Storage (CSV imports, PDF exports) |
| Compute | Supabase Edge Functions (Deno) for `optimise-route` |
| Geocoding | postcodes.io (UK, free) → fallback Mapbox/Google for non-UK |
| Maps | Leaflet + OSM tiles in app, Google Maps for external nav handoff |
| Hosting | Vercel (static + serverless) |

---

## 1 — Environment variables

Create a `.env.local` (Vercel: Project → Settings → Environment Variables):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_GOOGLE_MAPS_KEY=AIzaSy...           # optional, only for external "Navigate" deep link
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # server-side only, never bundled
```

---

## 2 — Database schema (run in Supabase SQL editor)

```sql
-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2.1 profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text,
  units text default 'metric',
  data_saver boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end; $$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2.2 trips
create table public.trips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  status text not null default 'draft', -- draft | optimising | optimised | in-progress | completed
  mode text not null default 'hybrid',   -- hybrid | walking | driving
  start_time time,
  end_time time,
  total_distance_km numeric(8,2) default 0,
  total_time_min int default 0,
  time_saved_min int default 0,
  date date default current_date,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index trips_user_idx on public.trips(user_id, created_at desc);

-- 2.3 stops (one row per stop in a trip, ordered by sequence)
create table public.stops (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  sequence int not null,
  postcode text not null,
  place text,
  cluster_id text,
  mode text,                           -- walking | driving
  latitude numeric(9,6),
  longitude numeric(9,6),
  distance_from_previous_km numeric(6,2) default 0,
  walking_time_min int default 0,
  driving_time_min int default 0,
  selected_time_min int default 0,
  arrival_time time,
  reasoning text,
  status text default 'pending',       -- pending | delivered | skipped | failed
  delivered_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

create index stops_trip_idx on public.stops(trip_id, sequence);

-- 2.4 activity log (powers the live feed)
create table public.activity (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users on delete cascade,
  trip_id uuid references public.trips on delete cascade,
  type text not null,                  -- auth | submit | optimise | delete | alert | info
  title text not null,
  meta text,
  created_at timestamptz default now()
);
create index activity_user_idx on public.activity(user_id, created_at desc);

-- 2.5 driver positions (real-time tracking; only most recent per user kept)
create table public.driver_positions (
  user_id uuid primary key references auth.users on delete cascade,
  trip_id uuid references public.trips on delete cascade,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  heading numeric(5,2),
  speed_mps numeric(6,2),
  accuracy_m numeric(6,2),
  source text default 'gps',           -- gps | sim
  updated_at timestamptz default now()
);
```

---

## 3 — Row-level security

```sql
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.stops enable row level security;
alter table public.activity enable row level security;
alter table public.driver_positions enable row level security;

-- profiles: each user sees/updates their own
create policy "profiles self read" on public.profiles for select using (auth.uid() = id);
create policy "profiles self upd"  on public.profiles for update using (auth.uid() = id);

-- trips
create policy "trips self read" on public.trips for select using (auth.uid() = user_id);
create policy "trips self ins"  on public.trips for insert with check (auth.uid() = user_id);
create policy "trips self upd"  on public.trips for update using (auth.uid() = user_id);
create policy "trips self del"  on public.trips for delete using (auth.uid() = user_id);

-- stops
create policy "stops self all" on public.stops for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- activity (insert is server-side via trigger or edge fn)
create policy "activity self read" on public.activity for select using (auth.uid() = user_id);
create policy "activity self ins"  on public.activity for insert with check (auth.uid() = user_id);

-- driver_positions
create policy "pos self all" on public.driver_positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Enable Realtime in the Supabase dashboard for: `trips`, `stops`, `activity`, `driver_positions`.

---

## 4 — Frontend → Backend mapping

The frontend already speaks to a `window.RF` adapter (`store.js`). The IDE agent's job is to **replace the body of each function** with Supabase calls — no UI files change.

### 4.1 `signUp({ email, password, fullName })`
```js
const { data, error } = await supabase.auth.signUp({
  email, password,
  options: { data: { full_name: fullName } }
});
if (error) throw error;
return { id: data.user.id, email, fullName };
```

### 4.2 `signIn({ email, password })`
```js
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error) throw error;
const { data: prof } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
return prof;
```

### 4.3 `signOut()`
```js
await supabase.auth.signOut();
```

### 4.4 `getCurrentUser()` — synchronous-ish via cached session
Use `supabase.auth.getSession()` on app boot, store in module state, expose synchronously.

### 4.5 `getTrips()` → `select * from trips where user_id = auth.uid() order by created_at desc`
### 4.6 `getTrip(id)` → `select trips.*, stops.* (joined or two queries)`
### 4.7 `saveTrip(trip)` → `upsert` on `trips`, then `delete + insert` on `stops` for that trip_id
### 4.8 `deleteTrip(id)` → `delete from trips where id = ?` (cascades to stops)

### 4.9 `optimiseRoute(stops, mode, onProgress)` — **call Edge Function**
```js
const { data, error } = await supabase.functions.invoke('optimise-route', {
  body: { stops, mode }
});
// onProgress(...) calls become polling on stops table or a streamed response
```

### 4.10 `pushActivity({ type, title, meta, tripId })`
```js
await supabase.from('activity').insert({ type, title, meta, trip_id: tripId });
```

### 4.11 `updateDriverPosition({ tripId, lat, lng, heading, speed, accuracy })`
```js
await supabase.from('driver_positions').upsert({
  user_id: (await supabase.auth.getUser()).data.user.id,
  trip_id: tripId,
  latitude: lat, longitude: lng, heading, speed_mps: speed, accuracy_m: accuracy,
  updated_at: new Date().toISOString()
});
```

---

## 5 — Realtime subscriptions (live data, no polling)

In the frontend adapter, expose a `subscribe()` API:

```js
// Dashboard live activity feed
supabase.channel('activity:user')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'activity', filter: `user_id=eq.${uid}` },
    (payload) => onActivity(payload.new))
  .subscribe();

// Trip list (status changes optimising → optimised → in-progress → completed)
supabase.channel('trips:user')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `user_id=eq.${uid}` },
    (payload) => onTripChange(payload))
  .subscribe();

// Stops on the live page (if a manager updates remotely or another device delivers)
supabase.channel(`stops:trip:${tripId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'stops', filter: `trip_id=eq.${tripId}` },
    (payload) => onStopChange(payload))
  .subscribe();

// Driver position broadcast (manager view)
supabase.channel(`pos:trip:${tripId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_positions', filter: `trip_id=eq.${tripId}` },
    (payload) => onPositionChange(payload))
  .subscribe();
```

Wire each channel into the corresponding page mount/unmount lifecycle.

---

## 6 — Edge Function: `optimise-route`

Supabase → Edge Functions → New → name `optimise-route`. Deno code:

```ts
// supabase/functions/optimise-route/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const auth = req.headers.get('Authorization')!;
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { stops, mode, tripId } = await req.json();

  // 1) Geocode via postcodes.io
  const r = await fetch('https://api.postcodes.io/postcodes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postcodes: stops })
  });
  const geo = (await r.json()).result.map((x: any) => ({
    pc: x.query,
    lat: x.result?.latitude, lng: x.result?.longitude,
    place: x.result ? `${x.result.admin_ward}, ${x.result.admin_district}` : null,
  }));

  // 2) Cluster (350m radius) — same algorithm as in store.js
  // 3) Nearest-neighbour + 2-opt over cluster centres
  // 4) Walk order within each cluster
  // (Port the functions from store.js — keep them identical so dev/prod match)

  // 5) Persist optimised stops
  await sb.from('stops').delete().eq('trip_id', tripId);
  await sb.from('stops').insert(/* optStops mapped to schema */);
  await sb.from('trips').update({ status: 'optimised', total_distance_km, time_saved_min }).eq('id', tripId);

  return new Response(JSON.stringify({ ok: true, stops: optStops }),
    { headers: { 'Content-Type': 'application/json' } });
});
```

Deploy: `supabase functions deploy optimise-route`.

---

## 7 — Frontend feature → backend behaviour, in depth

### 7.1 Landing page
No backend. Static.

### 7.2 Auth page
- Sign in: `auth.signInWithPassword` → on success, fetch profile, write activity row `{type:'auth', title:'Signed in'}`, navigate to `dashboard`.
- Sign up: `auth.signUp` → trigger creates `profiles` row → activity `{type:'auth', title:'Account created'}` → navigate.
- "Try the demo" button: signs in with `demo@routeflow.app / demo123` (seed this user).

### 7.3 Dashboard
On mount:
1. `getTrips()` → render KPIs + table.
2. Subscribe to `trips:user` channel — on `*`, refetch.
3. Subscribe to `activity:user` channel — prepend rows to the feed.
4. Cloud sync pill reads `RF.cloud.configured` (set true once Supabase URL is present).

### 7.4 Create trip
- Form data is held locally; on "Start optimising":
  1. `insert into trips (...) values (...) returning id`
  2. `insert into stops` rows (sequence by input order, status='pending', mode=null)
  3. `pushActivity({type:'submit', title:'Trip created'})`
  4. Navigate to `optimise?tripId=...`

### 7.5 Optimise
On mount:
1. Set `trips.status = 'optimising'`.
2. Call `optimise-route` edge function with `{ stops, mode, tripId }`.
3. Subscribe to `stops:trip:<id>` — UI progress bar advances on each row update or via a `progress` channel broadcast from the function.
4. On completion, edge fn sets `trips.status='optimised'`, recomputes `total_distance_km`, `time_saved_min`. Frontend reacts to the realtime update.

### 7.6 Live delivery — **the realtime page**
This is the page that needs the most backend wiring:

**On mount:**
- Load trip + stops (single query with join).
- Subscribe to `stops:trip:<id>` for cross-device sync.
- Subscribe to `trips:user` filtered to this trip.
- Set `trips.status = 'in-progress'`.

**Geolocation loop (every 1–3s):**
```js
const watchId = navigator.geolocation.watchPosition(
  async (pos) => {
    const { latitude, longitude, heading, speed, accuracy } = pos.coords;
    setMe({ lat: latitude, lng: longitude });
    // Throttle: only push to DB every 3s
    if (Date.now() - lastPush > 3000) {
      await supabase.from('driver_positions').upsert({
        user_id: uid, trip_id: tripId,
        latitude, longitude, heading, speed_mps: speed, accuracy_m: accuracy,
        source: 'gps', updated_at: new Date().toISOString()
      });
      lastPush = Date.now();
    }
  },
  null, { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
);
```

**Mark delivered:**
```js
await supabase.from('stops')
  .update({ status: 'delivered', delivered_at: new Date().toISOString() })
  .eq('id', currentStop.id);
await supabase.from('activity').insert({
  trip_id: tripId, type: 'submit', title: 'Stop delivered', meta: currentStop.postcode
});
```
The realtime subscription will then update the local state — single source of truth.

**Complete trip:** when last stop delivered, set `trips.status='completed', completed_at=now()`, navigate to summary.

### 7.7 Trip summary
Pure read: `select * from trips where id=? ; select * from stops where trip_id=? order by sequence`. Stats are computed client-side (or via a Postgres view).

### 7.8 Settings
- Profile edits → `update profiles set full_name=?, units=?, data_saver=? where id=auth.uid()`.
- Sign out → `auth.signOut`.
- Clear data → `delete from trips where user_id=auth.uid()` (stops cascade).

### 7.9 Analytics
A Postgres view makes this clean:

```sql
create or replace view public.user_stats as
select
  user_id,
  count(*) filter (where status='completed') as trips_completed,
  count(*) as trips_total,
  coalesce(sum(total_distance_km),0) as total_km,
  coalesce(sum(time_saved_min),0) as time_saved_min
from public.trips
group by user_id;

grant select on public.user_stats to authenticated;
```

Frontend: `select * from user_stats where user_id = auth.uid()`.

---

## 8 — Sample seed data (manager demo)

```sql
-- Seed a demo user via Auth dashboard first, then:
insert into public.trips (user_id, name, status, mode, total_distance_km, time_saved_min)
values ('<demo-user-uuid>', 'Tuesday CT route', 'completed', 'hybrid', 18.4, 27);
```

---

## 9 — Step-by-step IDE agent task list

> Run each step in order; stop on any failure.

1. **Install** `@supabase/supabase-js` (npm or via ESM CDN).
2. Create `src/supabaseClient.js` — exports a configured `supabase` instance reading `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Open `store.js`. Keep the same exported function names. Replace each function body with the Supabase call shown in section 4. Set `RF.cloud.configured = true`.
4. Add `RF.subscribe()` (section 5) and call it from `app.jsx` on mount.
5. In `page-live.jsx`, add the GPS upsert throttled to 3s (section 7.6).
6. In `page-optimise.jsx`, replace `RF.optimiseRoute` with `supabase.functions.invoke('optimise-route', ...)`.
7. Run schema SQL (section 2) + RLS (section 3) in Supabase SQL editor.
8. Enable Realtime on `trips`, `stops`, `activity`, `driver_positions`.
9. Deploy edge function (`supabase functions deploy optimise-route`).
10. `vercel --prod`. Add env vars in Vercel dashboard.
11. Smoke test: sign up → create trip with 5 postcodes → optimise → live → mark all delivered → verify stats update on dashboard via realtime.

---

## 10 — What stays, what changes

| File | Action |
|---|---|
| `RouteFlow.html` | Add `<script>` for Supabase client (CDN) before `store.js`. No other changes. |
| `styles.css`, `icons.jsx`, `ui.jsx`, `page-*.jsx`, `app.jsx` | **No changes.** They consume `RF.*` and `RFUI.*` only. |
| `store.js` | **Replace internals only.** Keep all exported function names + signatures. |
| New: `supabase/functions/optimise-route/index.ts` | Port clustering + 2-opt from store.js. |
| New: `supabase/migrations/0001_init.sql` | Sections 2 + 3 of this doc. |

---

## 11 — Acceptance criteria

- Two browsers signed in as the same user see live updates instantly (open dashboard in one, complete a stop in the other → activity feed prepends).
- Refreshing the page mid-trip preserves all state (progress, stops delivered, position).
- Realtime works on iOS Safari (verified via dev tools network tab — WebSocket upgrade present).
- RLS prevents user A from reading user B's trips (verified via SQL editor with `set role`).
- Edge function returns within 3 s for ≤25 stops.

---

End of handoff document.
