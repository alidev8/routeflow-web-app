// RouteFlow data layer - Supabase as the source of truth.
//
// Pages talk to the in-memory `trips` / `activity` arrays via the RF.*
// sync getters; those arrays are populated by fetchTrips/fetchActivity
// on boot and kept fresh by Supabase Realtime channels (debounced so
// bulk inserts don't stampede the connection pool).
//
// localStorage is used only for two things, both well-scoped:
//   1. `rf:pending-deliveries` - offline write queue. Mark-delivered taps
//      that fire while navigator.onLine === false are stashed here and
//      replayed automatically on the next 'online' event.
//   2. `rf:weights:<tripId>` - per-stop package weights the user typed
//      in the create wizard. The optimise edge fn doesn't accept weight
//      yet, so we splice them into the resulting stop rows ourselves.
// Critical writes go through directRest() (cached access token, no SDK)
// to dodge the supabase-js auto-refresh hang on slow connections.

(function () {
  // ---------- config ----------
  const cfg = window.RF_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || '';
  const GOOGLE_MAPS_KEY = cfg.GOOGLE_MAPS_KEY || '';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[RouteFlow] Supabase SDK not loaded - check the <script> tag in RouteFlow.html');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[RouteFlow] Missing SUPABASE_URL or SUPABASE_ANON_KEY in window.RF_CONFIG');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  // ---------- in-memory state ----------
  let currentUser = null;     // { id, email, fullName, units, dataSaver }
  let trips = [];             // shaped for the React pages
  let activity = [];
  let ready = false;          // true once first auth/session check finishes
  let realtimeChannels = [];

  function emit(kind = 'store-changed', detail) {
    window.dispatchEvent(new CustomEvent('rf:' + kind, { detail }));
  }

  function uid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---------- DB <-> view-model mappers ----------
  function parseClusterMeta(notes) {
    // Edge fn encodes hybrid metadata as "__rf:park_anchor=true;cluster_size=4;walk_from_park_min=3;walk_from_park_m=85;approximate=true;weight_kg=12"
    const out = { isParkAnchor: false, clusterSize: 1, walkFromParkMin: 0, walkFromParkM: 0, approximate: false, weightKg: 0 };
    if (!notes || !notes.startsWith('__rf:')) return out;
    const body = notes.slice(5);
    body.split(';').forEach((kv) => {
      const [k, v] = kv.split('=');
      if (k === 'park_anchor' && v === 'true') out.isParkAnchor = true;
      if (k === 'cluster_size') out.clusterSize = Math.max(1, parseInt(v, 10) || 1);
      if (k === 'walk_from_park_min') out.walkFromParkMin = Math.max(0, parseInt(v, 10) || 0);
      if (k === 'walk_from_park_m') out.walkFromParkM = Math.max(0, parseInt(v, 10) || 0);
      if (k === 'approximate' && v === 'true') out.approximate = true;
      if (k === 'weight_kg') out.weightKg = Math.max(0, parseFloat(v) || 0);
    });
    return out;
  }
  function buildClusterNotes(meta) {
    const parts = [];
    if (meta.isParkAnchor) parts.push('park_anchor=true');
    if (meta.clusterSize > 1) parts.push('cluster_size=' + meta.clusterSize);
    if (meta.walkFromParkMin > 0) parts.push('walk_from_park_min=' + meta.walkFromParkMin);
    if (meta.walkFromParkM > 0) parts.push('walk_from_park_m=' + meta.walkFromParkM);
    if (meta.approximate) parts.push('approximate=true');
    if (meta.weightKg > 0) parts.push('weight_kg=' + meta.weightKg);
    return parts.length ? '__rf:' + parts.join(';') : null;
  }

  function dbStop(s) {
    const meta = parseClusterMeta(s.notes);
    return {
      id: s.id,
      sequence: s.sequence,
      postcode: s.postcode,
      place: s.place,
      clusterId: s.cluster_id,
      clusterSize: meta.clusterSize,
      isParkAnchor: meta.isParkAnchor,
      walkFromParkMin: meta.walkFromParkMin,
      walkFromParkM: meta.walkFromParkM,
      approximate: meta.approximate,
      weightKg: meta.weightKg,
      mode: s.mode,
      latitude: s.latitude != null ? Number(s.latitude) : null,
      longitude: s.longitude != null ? Number(s.longitude) : null,
      distanceFromPrevious: Number(s.distance_from_previous_km || 0),
      walkingTime: s.walking_time_min || 0,
      drivingTime: s.driving_time_min || 0,
      selectedTime: s.selected_time_min || 0,
      arrivalTime: (s.arrival_time || '').slice(0, 5),
      reasoning: s.reasoning,
      status: s.status || 'pending',
    };
  }

  function dbTrip(row, stopRows) {
    const stops = (stopRows || []).slice().sort((a, b) => a.sequence - b.sequence);
    const optimised = stops.filter((s) => s.latitude != null).map(dbStop);
    const stopList = stops.map((s) => s.postcode);
    return {
      id: row.id,
      name: row.name,
      mode: row.mode,
      status: row.status,
      startTime: (row.start_time || '').slice(0, 5),
      endTime: (row.end_time || '').slice(0, 5),
      date: row.date || row.created_at,
      stops: stops.length,
      stopList,
      optimised,
      totalDistance: Number(row.total_distance_km || 0),
      timeSaved: Number(row.time_saved_min || 0),
      totalTime: Number(row.total_time_min || 0),
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ---------- session / user ----------
  // Cached user id is the fast path; if it's gone we decode the user id
  // straight out of the JWT in localStorage instead of round-tripping to
  // /auth/v1/user (which goes through the SDK's refresh logic and can hang).
  function _userIdFromCachedToken() {
    const token = _cachedAccessToken();
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.sub || null;
    } catch { return null; }
  }
  async function requireUserId() {
    if (currentUser?.id) return currentUser.id;
    const fromToken = _userIdFromCachedToken();
    if (fromToken) return fromToken;
    // Last resort - hits the network. Time-bound so it can't hang the UI.
    const resp = await timeBound(sb.auth.getUser(), 5000, null);
    const id = resp?.data?.user?.id;
    if (!id) throw new Error('Sign in required');
    return id;
  }

  // Time-limited helper: never let a network stall outlast `ms`.
  function timeBound(promise, ms, fallback) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(fallback), ms);
      Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
    });
  }

  async function loadProfile(userId) {
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data || null;
  }

  async function syncUserFromSession() {
    // getSession reads from local storage and is fast, but bound it anyway.
    // Sentinel `__timeout__` lets us tell the difference between "supabase
    // told us there's no session" (we should sign out) and "the call took
    // too long" (we should keep whatever we already have - critically, this
    // prevents a momentary network hiccup mid-session from booting the user
    // back to the landing page).
    const TIMEOUT = Symbol('rf-session-timeout');
    const sessionResp = await timeBound(sb.auth.getSession(), 4000, TIMEOUT);
    if (sessionResp === TIMEOUT) {
      console.warn('[RF] getSession timed out - keeping current state');
      return currentUser;
    }
    const session = sessionResp?.data?.session;
    if (!session) {
      currentUser = null;
      teardownChannels();
      trips = [];
      activity = [];
      emit('user-changed');
      emit('store-changed');
      return null;
    }
    // The profile fetch is the slowest hop on cold reload. Cap it at 5s and
    // fall back to fields from the JWT user object so we still expose a
    // signed-in user object. If the profile didn't land in time, retry in
    // the background so role/full_name update once it does (admins won't be
    // mis-classified as drivers for more than a few seconds).
    const profile = await timeBound(loadProfile(session.user.id).catch(() => null), 5000, null);
    function applyProfile(p) {
      currentUser = {
        id: session.user.id,
        email: session.user.email,
        fullName: p?.full_name || session.user.user_metadata?.full_name || (session.user.email || '').split('@')[0],
        units: p?.units || 'metric',
        dataSaver: !!p?.data_saver,
        role: p?.role || 'user',
        isAdmin: p?.role === 'admin',
        createdAt: session.user.created_at,
      };
    }
    applyProfile(profile);
    setupChannels(currentUser.id);
    emit('user-changed');
    if (!profile) {
      // Background retry so the role/admin flag is correct once the network
      // recovers. Re-emit user-changed so the React tree picks it up.
      (async () => {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
          const p = await loadProfile(session.user.id).catch(() => null);
          if (p) {
            applyProfile(p);
            emit('user-changed');
            refreshAll().catch(() => {});
            return;
          }
        }
      })();
    }
    return currentUser;
  }

  // ---------- data fetchers ----------
  async function fetchTrips(userId) {
    const { data: rows, error } = await sb
      .from('trips')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { console.warn('[RF] fetchTrips', error); return []; }
    if (!rows.length) return [];
    const ids = rows.map((t) => t.id);
    const { data: stopRows, error: serr } = await sb
      .from('stops')
      .select('*')
      .in('trip_id', ids)
      .order('sequence', { ascending: true });
    if (serr) { console.warn('[RF] fetchStops', serr); }
    const stopsByTrip = (stopRows || []).reduce((acc, s) => {
      (acc[s.trip_id] ||= []).push(s);
      return acc;
    }, {});
    return rows.map((t) => dbTrip(t, stopsByTrip[t.id]));
  }

  async function fetchActivity(userId) {
    const { data, error } = await sb
      .from('activity')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { console.warn('[RF] fetchActivity', error); return []; }
    return (data || []).map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      meta: a.meta,
      tripId: a.trip_id,
      ts: a.created_at,
    }));
  }

  async function refreshAll() {
    if (!currentUser) { trips = []; activity = []; emit('store-changed'); return; }
    const [t, a] = await Promise.all([
      fetchTrips(currentUser.id),
      fetchActivity(currentUser.id),
    ]);
    trips = t;
    activity = a;
    emit('store-changed');
  }

  // ---------- realtime ----------
  function teardownChannels() {
    realtimeChannels.forEach((ch) => { try { sb.removeChannel(ch); } catch {} });
    realtimeChannels = [];
  }

  // Debounced refresh: when bulk operations fire many postgres_changes events
  // (e.g. inserting 25 stops triggers 25 events), we coalesce into a single
  // refreshAll after a quiet period. Without this, the realtime callbacks
  // create a stampede that competes with the user's own writes for the
  // browser's per-host HTTP connection pool - and on slow networks, the
  // user's saveTrip can sit queued behind 50+ refresh SELECTs.
  let refreshDebounceTimer = null;
  function scheduleRefresh() {
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null;
      refreshAll().catch((e) => console.warn('[RF] debounced refresh failed', e));
    }, 400);
  }

  function setupChannels(userId) {
    teardownChannels();
    const uidFilter = `user_id=eq.${userId}`;
    realtimeChannels.push(
      sb.channel('rf:trips:' + userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: uidFilter }, scheduleRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'stops', filter: uidFilter }, scheduleRefresh)
        .subscribe()
    );
    realtimeChannels.push(
      sb.channel('rf:activity:' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: uidFilter }, (payload) => {
          // Activity is append-only and we already have the row in the
          // payload, so we don't need a refresh - just splice it in locally.
          const a = payload.new;
          if (!activity.find((x) => x.id === a.id)) {
            activity = [{
              id: a.id, type: a.type, title: a.title, meta: a.meta, tripId: a.trip_id, ts: a.created_at,
            }, ...activity].slice(0, 50);
            emit('store-changed');
          }
        })
        .subscribe()
    );
  }

  // ---------- auth lifecycle ----------
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      teardownChannels();
      trips = [];
      activity = [];
      emit('user-changed');
      emit('store-changed');
      return;
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      await syncUserFromSession();
      if (currentUser) await refreshAll();
      return;
    }
    if (event === 'TOKEN_REFRESHED') {
      // The SDK has already swapped the new access token onto its internal
      // client. We do NOT want to re-fetch the profile here - if that fetch
      // fails on a slow network, syncUserFromSession would replace currentUser
      // with a half-loaded copy (or worse, drop role='admin' to 'user'). The
      // safest move is to just keep what we have.
      if (session?.user?.id && currentUser?.id !== session.user.id) {
        // Different user (rare: account-switching in the same tab). Re-sync.
        await syncUserFromSession();
        if (currentUser) await refreshAll();
      }
      return;
    }
    if (event === 'USER_UPDATED') {
      // Profile metadata changed (e.g. email/name). Refresh in background;
      // don't block the UI.
      syncUserFromSession().catch(() => {});
    }
  });

  // ---------- Auth public API ----------
  async function signUp({ email, password, fullName }) {
    if (!email || !password) throw new Error('Email and password required');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    const cleanName = (fullName || '').trim() || (email.split('@')[0] || '').trim();
    if (!cleanName) throw new Error('Full name is required');
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: cleanName } },
    });
    if (error) throw new Error(error.message);
    // Supabase returns no session when "Confirm email" is enabled in the
    // project's auth settings. Our auto-confirm trigger marks the user as
    // confirmed at insert time, so a follow-up password sign-in works
    // immediately - no email click needed. This makes signup feel like a
    // single step regardless of how the project is configured.
    if (!data.session) {
      try {
        const { data: si, error: serr } = await sb.auth.signInWithPassword({ email, password });
        if (serr || !si?.session) {
          throw new Error('Check your email to confirm your account, then sign in');
        }
      } catch (e) {
        if (e?.message?.includes('Check your email')) throw e;
        throw new Error('Check your email to confirm your account, then sign in');
      }
    }
    await syncUserFromSession();
    await refreshAll();
    pushActivity({ type: 'auth', title: 'Account created', meta: email }).catch(() => {});
    return currentUser;
  }

  async function signIn({ email, password }) {
    if (!email || !password) throw new Error('Enter email and password');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    // Profile row is created by the handle_new_user trigger at signup time
    // (idempotent, SECURITY DEFINER). syncUserFromSession picks it up - no
    // need to upsert from the client during signIn.
    await syncUserFromSession();
    await refreshAll();
    pushActivity({ type: 'auth', title: 'Signed in', meta: email }).catch(() => {});
    return currentUser;
  }

  async function signOut() {
    try { await sb.auth.signOut(); } catch {}
    currentUser = null;
    teardownChannels();
    trips = [];
    activity = [];
    emit('user-changed');
    emit('store-changed');
  }

  function getCurrentUser() { return currentUser; }

  // ---------- Trips ----------
  function getTrips() { return trips; }
  function getTrip(id) { return trips.find((t) => t.id === id) || null; }

  // ---------- Direct REST escape hatch ----------
  // The supabase-js SDK auto-refreshes the access token before any REST call
  // it routes. On a slow connection that refresh can hang for tens of
  // seconds, taking down all `from(...)` calls with it - this is what was
  // causing the "Saving trip timed out after 25s" the user kept hitting
  // even though Supabase itself answers a trip upsert in 300ms. The direct
  // path below uses the cached access token from localStorage and calls
  // PostgREST without touching the SDK's refresh path. If the token is
  // genuinely expired, we get a 401 back fast and surface a clear error.
  function _projectRef() {
    const m = (SUPABASE_URL || '').match(/https:\/\/([^.]+)\./);
    return m ? m[1] : '';
  }
  function _cachedAccessToken() {
    try {
      const ref = _projectRef();
      if (!ref) return null;
      const raw = localStorage.getItem(`sb-${ref}-auth-token`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.access_token || parsed?.currentSession?.access_token || null;
    } catch { return null; }
  }
  async function directRest(path, { method = 'POST', body, prefer, timeoutMs = 25000 } = {}) {
    const token = _cachedAccessToken();
    if (!token) throw new Error('No active session - please sign in again');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': prefer || 'return=minimal',
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        const err = new Error(text || `HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return r;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`Timed out after ${Math.round(timeoutMs/1000)}s - check your connection`);
      throw e;
    } finally { clearTimeout(timer); }
  }

  // Wraps a Supabase promise so a stalled network connection surfaces as a
  // clean error instead of leaving the UI spinning forever.
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s - check your connection`)), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  // One-shot retry on a transient network/timeout failure. Slow connections
  // (mobile, hotel wifi) routinely lose a single round-trip - we don't want
  // to fail a user's whole save just because one packet got dropped.
  async function withRetry(fn, label, ms) {
    try { return await withTimeout(fn(), ms, label); }
    catch (e) {
      const transient = /timed out|network|fetch|abort|econnreset|503|504/i.test(e?.message || '');
      if (!transient) throw e;
      console.warn(`[RF] ${label} failed once (${e.message}) - retrying`);
      return await withTimeout(fn(), ms, label);
    }
  }

  async function saveTrip(trip) {
    const userId = await withTimeout(requireUserId(), 8000, 'Auth check');
    if (!trip.id) trip.id = uid();
    // If the trip isn't in our in-memory cache, treat it as fresh and skip
    // the wasted "do stops already exist?" SELECT - we know they don't.
    // This shaves a whole round-trip (and its potential retry) off the
    // critical path of "user clicks Start optimising".
    const isFreshTrip = !trips.find((t) => t.id === trip.id);

    const tripRow = {
      id: trip.id,
      user_id: userId,
      name: trip.name,
      status: trip.status || 'draft',
      mode: trip.mode || 'hybrid',
      start_time: trip.startTime || null,
      end_time: trip.endTime || null,
      total_distance_km: Number(trip.totalDistance || 0),
      total_time_min: Number(trip.totalTime || 0),
      time_saved_min: Number(trip.timeSaved || 0),
      completed_at: trip.completedAt || null,
    };
    // Use the direct REST path here so the SDK's session-refresh logic
    // can't hang the write. On slow networks, that refresh was the source
    // of the 25s timeouts.
    await withRetry(
      () => directRest('trips?on_conflict=id', {
        body: tripRow,
        prefer: 'resolution=merge-duplicates,return=minimal',
        timeoutMs: 25000,
      }),
      'Saving trip',
      25000
    );

    function buildOptimisedRows() {
      return trip.optimised.map((s) => ({
        trip_id: trip.id,
        user_id: userId,
        sequence: s.sequence,
        postcode: s.postcode,
        place: s.place || null,
        cluster_id: s.clusterId || null,
        mode: s.mode || null,
        latitude: s.latitude ?? null,
        longitude: s.longitude ?? null,
        distance_from_previous_km: Number(s.distanceFromPrevious || 0),
        walking_time_min: Number(s.walkingTime || 0),
        driving_time_min: Number(s.drivingTime || 0),
        selected_time_min: Number(s.selectedTime || 0),
        arrival_time: s.arrivalTime ? `${s.arrivalTime}:00` : null,
        reasoning: s.reasoning || null,
        status: s.status || 'pending',
      }));
    }

    if (Array.isArray(trip.optimised) && trip.optimised.length) {
      const rows = buildOptimisedRows();
      if (isFreshTrip) {
        await withRetry(
          () => directRest('stops', { body: rows, timeoutMs: 30000 }),
          `Saving ${rows.length} stops`,
          30000
        );
      } else {
        // Existing trip - need to figure out whether to overwrite. Use the
        // SDK here (low-volume read, doesn't matter if the SDK is slow).
        const { data: existing } = await withRetry(
          () => sb.from('stops').select('id, status, delivered_at, latitude').eq('trip_id', trip.id),
          'Checking existing stops',
          15000
        );
        const hasMutation = (existing || []).some((r) => r.status === 'delivered' || r.delivered_at);
        const alreadyOptimised =
          (existing || []).length === trip.optimised.length &&
          (existing || []).every((r) => r.latitude != null);
        if (!hasMutation && !alreadyOptimised) {
          await withRetry(
            () => directRest(`stops?trip_id=eq.${trip.id}`, { method: 'DELETE', timeoutMs: 15000 }),
            'Clearing old stops',
            15000
          );
          if (rows.length) {
            await withRetry(
              () => directRest('stops', { body: rows, timeoutMs: 30000 }),
              `Saving ${rows.length} stops`,
              30000
            );
          }
        }
      }
    } else if (Array.isArray(trip.stopList) && trip.stopList.length) {
      const rows = trip.stopList.map((pc, i) => ({
        trip_id: trip.id,
        user_id: userId,
        sequence: i + 1,
        postcode: pc,
        status: 'pending',
      }));
      if (isFreshTrip) {
        // Fresh trip: just insert. No existing stops by definition.
        await withRetry(
          () => directRest('stops', { body: rows, timeoutMs: 30000 }),
          `Saving ${rows.length} stops`,
          30000
        );
      } else {
        const { count } = await withRetry(
          () => sb.from('stops').select('id', { count: 'exact', head: true }).eq('trip_id', trip.id),
          'Checking existing stops',
          15000
        );
        if (!count) {
          await withRetry(
            () => directRest('stops', { body: rows, timeoutMs: 30000 }),
            `Saving ${rows.length} stops`,
            30000
          );
        }
      }
    }

    // Optimistically inject the trip into in-memory state so the next page
    // can resolve it via getTrip(id) immediately. refreshAll will reconcile
    // shortly with the canonical row from Postgres. Carry stopList/optimised
    // forward so page-optimise can feed the optimiser without waiting.
    const placeholder = {
      id: trip.id,
      name: trip.name,
      mode: trip.mode || 'hybrid',
      status: trip.status || 'draft',
      startTime: trip.startTime || '',
      endTime: trip.endTime || '',
      date: trip.date || new Date().toISOString(),
      stops: Array.isArray(trip.stopList) ? trip.stopList.length : (trip.stops || 0),
      stopList: Array.isArray(trip.stopList) ? trip.stopList : [],
      optimised: Array.isArray(trip.optimised) ? trip.optimised : [],
      totalDistance: Number(trip.totalDistance || 0),
      timeSaved: Number(trip.timeSaved || 0),
      totalTime: Number(trip.totalTime || 0),
      completedAt: trip.completedAt || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    trips = [placeholder, ...trips.filter((t) => t.id !== trip.id)];
    emit('store-changed');
    // refreshAll is a best-effort UI sync; do not let it block the caller
    // if a realtime/network hiccup makes the follow-up SELECTs slow.
    withTimeout(refreshAll(), 8000, 'Refresh').catch(() => {});
    return getTrip(trip.id);
  }

  async function deleteTrip(id) {
    await requireUserId();
    const { error } = await sb.from('trips').delete().eq('id', id);
    if (error) throw new Error(error.message);
    pushActivity({ type: 'delete', title: 'Trip deleted', meta: id, tripId: null }).catch(() => {});
    await refreshAll();
  }

  // ---------- Activity ----------
  function getActivity() { return activity; }
  async function pushActivity({ type, title, meta, tripId }) {
    const userId = await requireUserId().catch(() => null);
    if (!userId) return;
    // pushActivity is fire-and-forget by every caller (.catch chained), so
    // we just need it to not pin a connection. directRest with a short
    // timeout - activity is best-effort logging, not critical state.
    await directRest('activity', {
      timeoutMs: 6000,
      body: {
        user_id: userId,
        trip_id: tripId || null,
        type,
        title,
        meta: meta || null,
      },
    }).catch((e) => console.warn('[RF] pushActivity', e?.message));
  }

  // ---------- Optimisation (Edge Function) ----------
  // `origin` is an optional {lat, lng}. When present (e.g., driver's live
  // GPS), the edge fn starts the drive route at the cluster nearest origin
  // instead of the cluster containing the first input postcode.
  async function optimiseRoute(stopList, mode = 'hybrid', onProgress, tripId, origin = null) {
    if (!tripId) throw new Error('tripId is required');
    // Use the cached access token directly. Going through sb.auth.getSession()
    // can hang on the SDK's refresh path (same root cause as the saveTrip
    // 25s timeout). On a stale token PostgREST/edge-fn returns 401 fast and
    // we surface a clear sign-in-required error instead of a 60s spin.
    const token = _cachedAccessToken();
    if (!token) throw new Error('Sign in expired - please sign in again');

    onProgress && onProgress({ stage: 'geocoding', pct: 8 });
    let pct = 8;
    const ticker = setInterval(() => {
      pct = Math.min(90, pct + 3);
      const stage = pct < 32 ? 'geocoding' : pct < 78 ? 'optimising' : 'saving';
      onProgress && onProgress({ stage, pct });
    }, 220);

    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 60000);

    let resp, raw;
    try {
      resp = await fetch(`${SUPABASE_URL}/functions/v1/optimise-route`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stops: stopList, mode, tripId,
          ...(origin && typeof origin.lat === 'number' && typeof origin.lng === 'number'
            ? { origin: { lat: origin.lat, lng: origin.lng } }
            : {}),
        }),
        signal: ctl.signal,
      });
      raw = await resp.text();
    } catch (e) {
      clearInterval(ticker); clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('Optimisation timed out (60s) - try again');
      throw new Error(`Network error contacting optimiser: ${e.message}`);
    }
    clearInterval(ticker); clearTimeout(timeout);

    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
    if (!resp.ok || data.error) {
      throw new Error(data.error || `Optimiser returned HTTP ${resp.status}`);
    }
    const optStops = data.stops;
    if (!Array.isArray(optStops) || !optStops.length) throw new Error('Optimiser returned no stops');

    onProgress && onProgress({ stage: 'saving', pct: 96 });

    // Stash skipped postcodes (if any) on the result array via a property so the
    // optimise page can surface a warning banner without changing the call shape.
    const mapped = optStops.map((s) => ({
      sequence: s.sequence,
      postcode: s.postcode,
      place: s.place,
      clusterId: s.cluster_id,
      clusterSize: s.cluster_size || 1,
      isParkAnchor: !!s.is_park_anchor,
      walkFromParkMin: Number(s.walk_from_park_min || 0),
      walkFromParkM: Number(s.walk_from_park_m || 0),
      approximate: !!s.approximate,
      weightKg: Number(s.weight_kg || 0),
      mode: s.mode,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      distanceFromPrevious: Number(s.distance_from_previous_km),
      walkingTime: s.walking_time_min,
      drivingTime: s.driving_time_min,
      selectedTime: s.selected_time_min,
      arrivalTime: (s.arrival_time || '').slice(0, 5),
      reasoning: s.reasoning,
      status: s.status,
    }));
    mapped.skipped = Array.isArray(data.skipped) ? data.skipped : [];
    mapped.clusters = Array.isArray(data.clusters) ? data.clusters : [];

    // Inject the optimised stops into the in-memory cache directly so the
    // next page (live) sees them immediately - no need to wait for the
    // background refreshAll. This is what was causing "No active stop" on
    // the live page after optimise: the user navigated faster than the
    // refreshAll round-trip.
    const idx = trips.findIndex((t) => t.id === tripId);
    if (idx >= 0) {
      trips[idx] = {
        ...trips[idx],
        status: 'optimised',
        optimised: mapped,
        totalDistance: mapped.reduce((a, s) => a + (Number(s.distanceFromPrevious) || 0), 0),
        totalTime: mapped.reduce((a, s) => a + (Number(s.selectedTime) || 0), 0),
      };
      emit('store-changed');
    }

    // Now do weight merge + refreshAll in the background so the canonical
    // server state syncs eventually. The user's UI does NOT block on these.
    Promise.resolve()
      .then(() => applyWeightsToStops(tripId).catch((e) => console.warn('[RF] weight merge failed', e)))
      .then(() => withTimeout(refreshAll(), 8000, 'background refresh').catch(() => {}));
    onProgress && onProgress({ stage: 'done', pct: 100 });

    return mapped;
  }

  // ---------- Lightweight trip status flip ----------
  // The live page just needs to flip status to 'in-progress'. Doing a full
  // saveTrip there triggered an existing-stops SELECT through the SDK that
  // was timing out. This bypass writes only the status column via direct
  // REST and updates the in-memory cache.
  async function setTripStatus(tripId, status) {
    if (!tripId || !status) return;
    try {
      await directRest(`trips?id=eq.${tripId}`, {
        method: 'PATCH',
        body: { status },
        timeoutMs: 8000,
      });
      const idx = trips.findIndex((t) => t.id === tripId);
      if (idx >= 0) {
        trips[idx] = { ...trips[idx], status };
        emit('store-changed');
      }
    } catch (e) {
      console.warn('[RF] setTripStatus failed', e?.message);
    }
  }

  // ---------- Stops ----------
  async function markStopDelivered(stopId, opts = {}) {
    if (!stopId) return;
    // Don't touch notes unless explicitly given: it carries cluster/weight
    // metadata we need for the live-page banners.
    const patch = {
      status: opts.status || 'delivered',
      delivered_at: new Date().toISOString(),
    };
    if (opts.notes !== undefined) patch.notes = opts.notes;
    // directRest so a slow SDK session-refresh can't pin a delivery write.
    // The live page calls this on every "Mark delivered" tap - any hang here
    // breaks the driver's flow.
    await directRest(`stops?id=eq.${stopId}`, {
      method: 'PATCH',
      body: patch,
      timeoutMs: 15000,
    });
    // Background refresh - don't block the UI on the read.
    Promise.resolve().then(() => withTimeout(refreshAll(), 8000, 'background refresh').catch(() => {}));
  }

  // Same operation but offline-aware: if the network's down (or the request
  // fails because we just dropped into a black-spot) we queue the action and
  // replay on reconnect. The live page calls this instead of the raw
  // markStopDelivered so a courier in a basement isn't blocked.
  const QUEUE_KEY = 'rf:pending-deliveries';
  function getPendingDeliveries() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }
  function setPendingDeliveries(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
    emit('queue-changed');
  }
  async function markStopDeliveredQueued(stopId, opts = {}) {
    if (!stopId) return { queued: false };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const q = getPendingDeliveries();
      q.push({ stopId, opts, ts: Date.now() });
      setPendingDeliveries(q);
      return { queued: true };
    }
    try {
      await markStopDelivered(stopId, opts);
      return { queued: false };
    } catch (e) {
      if ((typeof navigator !== 'undefined' && navigator.onLine === false)
          || /network|fetch|timeout/i.test(e?.message || '')) {
        const q = getPendingDeliveries();
        q.push({ stopId, opts, ts: Date.now() });
        setPendingDeliveries(q);
        return { queued: true, error: e };
      }
      throw e;
    }
  }
  async function flushPendingDeliveries() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    const q = getPendingDeliveries();
    if (!q.length) return 0;
    const remaining = [];
    let flushed = 0;
    for (const item of q) {
      try { await markStopDelivered(item.stopId, item.opts); flushed += 1; }
      catch { remaining.push(item); }
    }
    setPendingDeliveries(remaining);
    return flushed;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      flushPendingDeliveries().catch(() => {});
      emit('online-changed');
    });
    window.addEventListener('offline', () => emit('online-changed'));
  }

  // ---------- Driver position ----------
  async function updateDriverPosition({ tripId, lat, lng, heading, speed, accuracy, source }) {
    const userId = await requireUserId().catch(() => null);
    if (!userId || lat == null || lng == null) return;
    // GPS pings happen every ~3s during a delivery; we MUST NOT block on
    // the SDK's refresh path here. directRest with a tight timeout - if a
    // single ping fails, the next one will overwrite it anyway.
    await directRest('driver_positions?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      timeoutMs: 6000,
      body: {
        user_id: userId,
        trip_id: tripId || null,
        latitude: lat,
        longitude: lng,
        heading: heading ?? null,
        speed_mps: speed ?? null,
        accuracy_m: accuracy ?? null,
        source: source || 'gps',
        updated_at: new Date().toISOString(),
      },
    }).catch((e) => console.warn('[RF] driver position upsert failed', e?.message));
  }

  // ---------- Profile ----------
  async function updateProfile({ fullName, units, dataSaver }) {
    const userId = await requireUserId();
    const patch = {};
    if (fullName !== undefined) patch.full_name = fullName;
    if (units !== undefined) patch.units = units;
    if (dataSaver !== undefined) patch.data_saver = !!dataSaver;
    const { error } = await sb.from('profiles').update(patch).eq('id', userId);
    if (error) throw new Error(error.message);
    await syncUserFromSession();
  }

  async function clearAllTrips() {
    const userId = await requireUserId();
    await sb.from('trips').delete().eq('user_id', userId);
    await sb.from('activity').delete().eq('user_id', userId);
    await refreshAll();
  }

  // ---------- Admin (RLS allows cross-user access only when profile.role='admin') ----------
  function requireAdmin() {
    if (!currentUser?.isAdmin) throw new Error('Admin access required');
  }

  async function adminFetchUsers() {
    requireAdmin();
    // Trips per user + last activity, joined client-side from two queries.
    const [{ data: profiles, error: pe }, { data: tripCounts, error: te }, { data: actLast, error: ae }] = await Promise.all([
      sb.from('profiles').select('id, email, full_name, role, units, created_at, updated_at').order('created_at', { ascending: true }),
      sb.from('trips').select('user_id, status'),
      sb.from('activity').select('user_id, created_at').order('created_at', { ascending: false }),
    ]);
    if (pe || te || ae) throw new Error((pe || te || ae).message);
    const byUser = {};
    (tripCounts || []).forEach((t) => {
      const u = (byUser[t.user_id] ||= { total: 0, active: 0, completed: 0 });
      u.total += 1;
      if (t.status === 'completed') u.completed += 1;
      else if (t.status === 'in-progress' || t.status === 'optimised' || t.status === 'optimising') u.active += 1;
    });
    const lastSeen = {};
    (actLast || []).forEach((a) => { if (!lastSeen[a.user_id]) lastSeen[a.user_id] = a.created_at; });
    return (profiles || []).map((p) => ({
      id: p.id,
      email: p.email,
      fullName: p.full_name,
      role: p.role,
      units: p.units,
      createdAt: p.created_at,
      lastActiveAt: lastSeen[p.id] || null,
      tripsTotal: byUser[p.id]?.total || 0,
      tripsActive: byUser[p.id]?.active || 0,
      tripsCompleted: byUser[p.id]?.completed || 0,
    }));
  }

  // PostgREST can't auto-embed profiles via the trips/activity FK (those
  // target auth.users, not public.profiles). So we fetch driver info in a
  // second query and merge in JS.
  async function fetchDriverMap(userIds) {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return {};
    const { data } = await sb.from('profiles').select('id, full_name, email, role').in('id', ids);
    return (data || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
  }

  async function adminFetchAllTrips(limit = 50) {
    requireAdmin();
    const { data: rows, error } = await sb
      .from('trips')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];
    const ids = rows.map((t) => t.id);
    const [stopRowsResp, drivers] = await Promise.all([
      sb.from('stops').select('*').in('trip_id', ids).order('sequence', { ascending: true }),
      fetchDriverMap(rows.map((t) => t.user_id)),
    ]);
    const stopRows = stopRowsResp.data;
    const stopsByTrip = (stopRows || []).reduce((acc, s) => { (acc[s.trip_id] ||= []).push(s); return acc; }, {});
    return rows.map((r) => {
      const t = dbTrip(r, stopsByTrip[r.id]);
      const driver = drivers[r.user_id];
      t.driverName = driver?.full_name || 'Unknown';
      t.driverEmail = driver?.email || null;
      t.userId = r.user_id;
      return t;
    });
  }

  async function adminFetchActivity(limit = 100) {
    requireAdmin();
    const { data, error } = await sb
      .from('activity')
      .select('id, type, title, meta, trip_id, user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const drivers = await fetchDriverMap((data || []).map((a) => a.user_id));
    return (data || []).map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      meta: a.meta,
      tripId: a.trip_id,
      userId: a.user_id,
      driverName: drivers[a.user_id]?.full_name || 'Unknown',
      driverEmail: drivers[a.user_id]?.email || null,
      ts: a.created_at,
    }));
  }

  async function adminStats() {
    requireAdmin();
    const [users, trips, stops, todayActivity] = await Promise.all([
      sb.from('profiles').select('id', { count: 'exact', head: true }),
      sb.from('trips').select('status, total_distance_km, total_time_min, time_saved_min'),
      sb.from('stops').select('status', { count: 'exact', head: true }),
      sb.from('activity').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ]);
    const tripsArr = trips.data || [];
    const completed = tripsArr.filter((t) => t.status === 'completed').length;
    const active = tripsArr.filter((t) => t.status === 'in-progress' || t.status === 'optimised' || t.status === 'optimising').length;
    const totalKm = tripsArr.reduce((a, t) => a + Number(t.total_distance_km || 0), 0);
    const totalSavedMin = tripsArr.reduce((a, t) => a + Number(t.time_saved_min || 0), 0);
    return {
      users: users.count || 0,
      trips: tripsArr.length,
      tripsCompleted: completed,
      tripsActive: active,
      stops: stops.count || 0,
      activity24h: todayActivity.count || 0,
      totalDistanceKm: Math.round(totalKm * 10) / 10,
      totalSavedMin: Math.round(totalSavedMin),
    };
  }

  async function adminDeleteTrip(tripId) {
    requireAdmin();
    const { error } = await sb.from('trips').delete().eq('id', tripId);
    if (error) throw new Error(error.message);
    await refreshAll();
  }

  async function adminPromoteUser(userId, role) {
    requireAdmin();
    if (!['user', 'admin'].includes(role)) throw new Error('Invalid role');
    const { data, error } = await sb.from('profiles').update({ role }).eq('id', userId).select('id').single();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('No profile row for that user - signup may not have completed.');
    // If the admin just changed their own role, re-sync the in-memory user
    // object so the App router immediately reflects the new permissions.
    if (currentUser?.id === userId) {
      await syncUserFromSession();
    }
  }

  // ---------- Subscribe ----------
  function subscribe(cb) {
    const handler = () => cb();
    window.addEventListener('rf:store-changed', handler);
    window.addEventListener('rf:user-changed', handler);
    return () => {
      window.removeEventListener('rf:store-changed', handler);
      window.removeEventListener('rf:user-changed', handler);
    };
  }

  function isReady() { return ready; }
  function onReady(cb) {
    if (ready) { cb(); return () => {}; }
    const handler = () => { cb(); window.removeEventListener('rf:ready', handler); };
    window.addEventListener('rf:ready', handler);
    return () => window.removeEventListener('rf:ready', handler);
  }

  // ---------- Weights side-channel ----------
  // The optimise edge fn doesn't know about per-stop package weight yet, so we
  // hold the user's input here, flush it onto the freshly-inserted stop rows
  // *after* the edge fn writes them, and re-encode any cluster meta the edge
  // fn put in the notes column. Cached in localStorage keyed by tripId so a
  // page reload between create and optimise doesn't lose it.
  const _weightsByTrip = new Map();
  function setTripWeights(tripId, weights) {
    if (!tripId) return;
    _weightsByTrip.set(tripId, weights || {});
    try { localStorage.setItem('rf:weights:' + tripId, JSON.stringify(weights || {})); } catch {}
  }
  function getTripWeights(tripId) {
    if (!tripId) return {};
    if (_weightsByTrip.has(tripId)) return _weightsByTrip.get(tripId);
    try {
      const w = JSON.parse(localStorage.getItem('rf:weights:' + tripId) || '{}');
      _weightsByTrip.set(tripId, w);
      return w;
    } catch { return {}; }
  }
  async function applyWeightsToStops(tripId) {
    const weights = getTripWeights(tripId);
    const pcs = Object.keys(weights).filter((p) => Number(weights[p]) > 0);
    if (!pcs.length) return;
    const { data: rows } = await sb.from('stops').select('id, postcode, notes').eq('trip_id', tripId);
    if (!rows?.length) return;
    for (const r of rows) {
      const w = Number(weights[r.postcode] || 0);
      if (w <= 0) continue;
      const meta = parseClusterMeta(r.notes);
      meta.weightKg = w;
      const newNotes = buildClusterNotes(meta);
      if (newNotes !== r.notes) {
        await sb.from('stops').update({ notes: newNotes }).eq('id', r.id);
      }
    }
  }

  // ---------- Real-time mode decision (Routes API v2 + traffic) ----------
  // After every delivery the live page asks: is the *planned* mode for the
  // next stop still the right one given current GPS, current van location,
  // and live traffic? Returns null if anything is missing or the call fails.
  async function decideMode({ from, van, to, parkingBufferSec = 90 }) {
    if (!GOOGLE_MAPS_KEY || !from || !to || from.lat == null || to.lat == null) return null;
    function buildBody(origin, mode) {
      const body = {
        origin: { location: { latLng: { latitude: Number(origin.lat), longitude: Number(origin.lng) } } },
        destination: { location: { latLng: { latitude: Number(to.lat), longitude: Number(to.lng) } } },
        travelMode: mode,
      };
      if (mode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      return body;
    }
    async function callOne(origin, mode) {
      try {
        const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_KEY,
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
          },
          body: JSON.stringify(buildBody(origin, mode)),
        });
        if (!r.ok) return null;
        const j = await r.json();
        const route = j.routes && j.routes[0];
        if (!route) return null;
        const sec = parseInt(String(route.duration || '0s').replace('s', ''), 10) || 0;
        return { sec, m: Number(route.distanceMeters || 0) };
      } catch { return null; }
    }
    const [walk, drive] = await Promise.all([
      callOne(from, 'WALK'),
      van && van.lat != null ? callOne(van, 'DRIVE') : Promise.resolve(null),
    ]);
    if (!walk && !drive) return null;
    if (!drive) return { recommended: 'walking', walkSec: walk.sec, walkM: walk.m, driveSec: null, driveM: null, deltaSec: 0 };
    if (!walk)  return { recommended: 'driving', walkSec: null, walkM: null, driveSec: drive.sec, driveM: drive.m, deltaSec: 0 };
    const driveTotalSec = drive.sec + parkingBufferSec;
    const recommended = walk.sec <= driveTotalSec ? 'walking' : 'driving';
    return {
      recommended,
      walkSec: walk.sec, walkM: walk.m,
      driveSec: drive.sec, driveM: drive.m,
      parkingBufferSec,
      deltaSec: Math.abs(walk.sec - driveTotalSec),
    };
  }

  // ---------- Postcode parsing ----------
  const PC_RX = /([A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2})/gi;
  function parsePostcodes(text) {
    if (!text) return [];
    const found = (text.match(PC_RX) || []).map((p) => p.toUpperCase().replace(/\s+/g, ' ').trim());
    const seen = new Set();
    const out = [];
    for (const p of found) {
      const compact = p.replace(/\s+/g, '');
      const fmt = compact.slice(0, compact.length - 3) + ' ' + compact.slice(-3);
      if (!seen.has(fmt)) { seen.add(fmt); out.push(fmt); }
    }
    return out;
  }

  // ---------- Public RF surface ----------
  window.RF = {
    signUp, signIn, signOut, getCurrentUser,
    getTrips, getTrip, saveTrip, setTripStatus, deleteTrip, clearAllTrips,
    markStopDelivered, markStopDeliveredQueued, updateDriverPosition,
    getPendingDeliveries, flushPendingDeliveries,
    getActivity, pushActivity,
    optimiseRoute, parsePostcodes,
    updateProfile,
    setTripWeights, getTripWeights,
    decideMode,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    uid, subscribe, isReady, onReady,
    admin: {
      fetchUsers: adminFetchUsers,
      fetchAllTrips: adminFetchAllTrips,
      fetchActivity: adminFetchActivity,
      stats: adminStats,
      deleteTrip: adminDeleteTrip,
      promoteUser: adminPromoteUser,
    },
    cloud: {
      configured: true,
      url: SUPABASE_URL,
      label: 'Cloud sync · live',
      info: 'Trips, activity, and live driver position sync via Supabase Realtime.',
    },
  };

  // ---------- boot ----------
  // The auth listener will fire INITIAL_SESSION shortly; we still kick a
  // synchronous-ish path so RF.isReady flips even if no session exists.
  // Hard-cap the boot at 8s so a stalled network never strands the splash.
  let bootDone = false;
  function markReady() {
    if (bootDone) return;
    bootDone = true;
    ready = true;
    window.dispatchEvent(new CustomEvent('rf:ready'));
  }
  setTimeout(() => {
    if (!bootDone) console.warn('[RF] boot timed out after 8s - rendering anyway');
    markReady();
  }, 8000);
  (async () => {
    try {
      await syncUserFromSession();
      if (currentUser) await refreshAll();
    } catch (e) {
      console.warn('[RF] boot error', e);
    } finally {
      markReady();
    }
  })();
})();
