// RouteFlow data layer - Supabase as the only source of truth.
// No localStorage caching of business data. In-memory state only,
// kept fresh by Supabase Realtime channels. Pages still call the
// existing RF.* sync getters; they read the in-memory state, which
// is populated as soon as the session resolves on boot.

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
    // Edge fn encodes hybrid metadata as "__rf:park_anchor=true;cluster_size=4"
    const out = { isParkAnchor: false, clusterSize: 1 };
    if (!notes || !notes.startsWith('__rf:')) return out;
    const body = notes.slice(5);
    body.split(';').forEach((kv) => {
      const [k, v] = kv.split('=');
      if (k === 'park_anchor' && v === 'true') out.isParkAnchor = true;
      if (k === 'cluster_size') out.clusterSize = Math.max(1, parseInt(v, 10) || 1);
    });
    return out;
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
  // Always source of truth: ask Supabase. Cache the user id but never trust it
  // beyond a single mutation - re-resolves automatically if cleared.
  async function requireUserId() {
    if (currentUser?.id) return currentUser.id;
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) throw new Error('Sign in required');
    return data.user.id;
  }

  async function loadProfile(userId) {
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data || null;
  }

  async function syncUserFromSession() {
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if (!session) {
      currentUser = null;
      teardownChannels();
      trips = [];
      activity = [];
      emit('user-changed');
      emit('store-changed');
      return null;
    }
    const profile = await loadProfile(session.user.id).catch(() => null);
    currentUser = {
      id: session.user.id,
      email: session.user.email,
      fullName: profile?.full_name || session.user.user_metadata?.full_name || (session.user.email || '').split('@')[0],
      units: profile?.units || 'metric',
      dataSaver: !!profile?.data_saver,
      createdAt: session.user.created_at,
    };
    setupChannels(currentUser.id);
    emit('user-changed');
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

  function setupChannels(userId) {
    teardownChannels();
    const uidFilter = `user_id=eq.${userId}`;
    realtimeChannels.push(
      sb.channel('rf:trips:' + userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: uidFilter }, () => refreshAll())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'stops', filter: uidFilter }, () => refreshAll())
        .subscribe()
    );
    realtimeChannels.push(
      sb.channel('rf:activity:' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: uidFilter }, (payload) => {
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
  sb.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      teardownChannels();
      trips = [];
      activity = [];
      emit('user-changed');
      emit('store-changed');
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      await syncUserFromSession();
      if (currentUser) await refreshAll();
    }
  });

  // ---------- Auth public API ----------
  async function signUp({ email, password, fullName }) {
    if (!email || !password) throw new Error('Email and password required');
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName || (email.split('@')[0]) } },
    });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('Check your email to confirm your account');
    await syncUserFromSession();
    await refreshAll();
    pushActivity({ type: 'auth', title: 'Account created', meta: email }).catch(() => {});
    return currentUser;
  }

  async function signIn({ email, password }) {
    if (!email || !password) throw new Error('Enter email and password');
    let { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error && /Invalid login credentials/i.test(error.message) && /^demo@routeflow\.app$/i.test(email)) {
      const created = await sb.auth.signUp({ email, password, options: { data: { full_name: 'Alex Driver' } } });
      if (created.error) throw new Error(created.error.message);
      if (!created.data.session) {
        const retry = await sb.auth.signInWithPassword({ email, password });
        if (retry.error) throw new Error('Demo account exists but needs email confirmation. Disable confirmation in Supabase or use your own account.');
        data = retry.data;
      } else {
        data = created.data;
      }
      error = null;
    }
    if (error) throw new Error(error.message);
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

  // Wraps a Supabase promise so a stalled network connection surfaces as a
  // clean error instead of leaving the UI spinning forever.
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s - check your connection`)), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  async function saveTrip(trip) {
    const userId = await withTimeout(requireUserId(), 8000, 'Auth check');
    if (!trip.id) trip.id = uid();

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
    const { error: upErr } = await withTimeout(
      sb.from('trips').upsert(tripRow, { onConflict: 'id' }),
      15000,
      'Saving trip'
    );
    if (upErr) throw new Error(upErr.message);

    if (Array.isArray(trip.optimised) && trip.optimised.length) {
      const { data: existing } = await sb.from('stops').select('id, status, delivered_at, latitude').eq('trip_id', trip.id);
      const hasMutation = (existing || []).some((r) => r.status === 'delivered' || r.delivered_at);
      const alreadyOptimised =
        (existing || []).length === trip.optimised.length &&
        (existing || []).every((r) => r.latitude != null);
      if (!hasMutation && !alreadyOptimised) {
        await sb.from('stops').delete().eq('trip_id', trip.id);
        const rows = trip.optimised.map((s) => ({
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
        if (rows.length) {
          const { error: insErr } = await sb.from('stops').insert(rows);
          if (insErr) throw new Error(insErr.message);
        }
      }
    } else if (Array.isArray(trip.stopList) && trip.stopList.length) {
      const { count } = await withTimeout(
        sb.from('stops').select('id', { count: 'exact', head: true }).eq('trip_id', trip.id),
        10000,
        'Checking existing stops'
      );
      if (!count) {
        const rows = trip.stopList.map((pc, i) => ({
          trip_id: trip.id,
          user_id: userId,
          sequence: i + 1,
          postcode: pc,
          status: 'pending',
        }));
        const { error: insErr } = await withTimeout(
          sb.from('stops').insert(rows),
          20000,
          `Saving ${rows.length} stops`
        );
        if (insErr) throw new Error(insErr.message);
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
    const { error } = await sb.from('activity').insert({
      user_id: userId,
      trip_id: tripId || null,
      type,
      title,
      meta: meta || null,
    });
    if (error) console.warn('[RF] pushActivity', error);
  }

  // ---------- Optimisation (Edge Function) ----------
  async function optimiseRoute(stopList, mode = 'hybrid', onProgress, tripId) {
    if (!tripId) throw new Error('tripId is required');
    const { data: sess } = await sb.auth.getSession();
    const token = sess?.session?.access_token;
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
        body: JSON.stringify({ stops: stopList, mode, tripId }),
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
    await refreshAll();
    onProgress && onProgress({ stage: 'done', pct: 100 });

    // Stash skipped postcodes (if any) on the result array via a property so the
    // optimise page can surface a warning banner without changing the call shape.
    const mapped = optStops.map((s) => ({
      sequence: s.sequence,
      postcode: s.postcode,
      place: s.place,
      clusterId: s.cluster_id,
      clusterSize: s.cluster_size || 1,
      isParkAnchor: !!s.is_park_anchor,
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
    return mapped;
  }

  // ---------- Stops ----------
  async function markStopDelivered(stopId, opts = {}) {
    await requireUserId();
    if (!stopId) return;
    const { error } = await sb.from('stops').update({
      status: opts.status || 'delivered',
      delivered_at: new Date().toISOString(),
      notes: opts.notes || null,
    }).eq('id', stopId);
    if (error) throw new Error(error.message);
    await refreshAll();
  }

  // ---------- Driver position ----------
  async function updateDriverPosition({ tripId, lat, lng, heading, speed, accuracy, source }) {
    const userId = await requireUserId().catch(() => null);
    if (!userId || lat == null || lng == null) return;
    await sb.from('driver_positions').upsert(
      {
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
      { onConflict: 'user_id' }
    );
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

  // Minimal geocode helpers retained for the FakeMap preview.
  function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
  function mockGeocode(pc) {
    const h = hashStr(pc);
    return { lat: 51.27 + ((h % 1000) / 1000) * 0.06, lng: 1.07 + (((h >> 7) % 1000) / 1000) * 0.06 };
  }
  async function geocodeBatch(postcodes) {
    const out = {};
    try {
      const res = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes }),
      });
      if (res.ok) {
        const data = await res.json();
        (data.result || []).forEach((r) => {
          if (r.result) {
            const place = `${r.result.parish || r.result.admin_ward || ''}, ${r.result.admin_district || ''}`.replace(/^,\s*/, '');
            out[r.query] = { lat: r.result.latitude, lng: r.result.longitude, place };
          }
        });
      }
    } catch {}
    postcodes.forEach((p) => { if (!out[p]) out[p] = { ...mockGeocode(p), place: 'Approx. location' }; });
    return out;
  }

  // ---------- Public RF surface ----------
  window.RF = {
    signUp, signIn, signOut, getCurrentUser,
    getTrips, getTrip, saveTrip, deleteTrip, clearAllTrips,
    markStopDelivered, updateDriverPosition,
    getActivity, pushActivity,
    optimiseRoute, parsePostcodes, geocodeBatch, mockGeocode,
    updateProfile,
    uid, subscribe, isReady, onReady,
    _supabase: sb,
    cloud: {
      configured: true,
      url: SUPABASE_URL,
      label: 'Cloud sync · live',
      info: 'Trips, activity, and live driver position sync via Supabase Realtime.',
      googleMapsKey: GOOGLE_MAPS_KEY,
    },
  };

  // ---------- boot ----------
  // The auth listener will fire INITIAL_SESSION shortly; we still kick a
  // synchronous-ish path so RF.isReady flips even if no session exists.
  (async () => {
    try {
      await syncUserFromSession();
      if (currentUser) await refreshAll();
    } catch (e) {
      console.warn('[RF] boot error', e);
    } finally {
      ready = true;
      window.dispatchEvent(new CustomEvent('rf:ready'));
    }
  })();
})();
