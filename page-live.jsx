// Live delivery page — full-screen map + bottom sheet, with real-time GPS simulation
function LivePage({ navigate, params }) {
  const toast = RFUI.useToast();
  const [trip, setTrip] = React.useState(null);
  const [current, setCurrent] = React.useState(0);
  const [stops, setStops] = React.useState([]);
  const [expanded, setExpanded] = React.useState(false);
  const [now, setNow] = React.useState(new Date());
  const [me, setMe] = React.useState(null);   // simulated driver position
  const [tracking, setTracking] = React.useState(true);
  const [decision, setDecision] = React.useState(null);     // last RF.decideMode result
  const [dismissed, setDismissed] = React.useState(false);  // user dismissed the suggestion banner
  const [online, setOnline] = React.useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [pending, setPending] = React.useState(() => {
    try { return RF.getPendingDeliveries ? RF.getPendingDeliveries().length : 0; } catch { return 0; }
  });
  const [loadState, setLoadState] = React.useState('loading'); // loading | ready | not-found | no-trip-id

  React.useEffect(() => {
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    const onQueue = () => setPending(RF.getPendingDeliveries ? RF.getPendingDeliveries().length : 0);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    window.addEventListener('rf:queue-changed', onQueue);
    window.addEventListener('rf:online-changed', onQueue);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
      window.removeEventListener('rf:queue-changed', onQueue);
      window.removeEventListener('rf:online-changed', onQueue);
    };
  }, []);

  React.useEffect(() => {
    const tripId = params?.tripId;
    if (!tripId) { setLoadState('no-trip-id'); return; }
    let cancelled = false;
    let off = () => {};
    let interval = null;
    let retryHandle = null;

    function tryLoad(attempt) {
      if (cancelled) return;
      const t = RF.getTrip(tripId);
      if (t) {
        setTrip(t);
        setStops(t.optimised || []);
        setLoadState('ready');
        if (t.status !== 'in-progress' && t.status !== 'completed') {
          RF.saveTrip({ ...t, status: 'in-progress' }).catch(() => {});
        }
        off = RF.subscribe(() => {
          const fresh = RF.getTrip(tripId);
          if (fresh) { setTrip(fresh); setStops(fresh.optimised || []); }
        });
        interval = setInterval(() => setNow(new Date()), 1000);
        return;
      }
      // The in-memory trips list may still be hydrating from Supabase. Retry
      // up to ~3s before declaring the trip really missing - much friendlier
      // than the old behaviour that toasted "Trip not found" the moment the
      // page mounted under a slow network.
      if (attempt < 6) {
        retryHandle = setTimeout(() => tryLoad(attempt + 1), 500);
      } else {
        setLoadState('not-found');
      }
    }
    tryLoad(0);

    return () => {
      cancelled = true;
      if (retryHandle) clearTimeout(retryHandle);
      if (interval) clearInterval(interval);
      off();
    };
  }, [params?.tripId]);

  // Try to use real geolocation; otherwise simulate movement toward the current stop.
  React.useEffect(() => {
    if (!tracking || !stops.length) return;
    let watchId = null;
    let lastPush = 0;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          setMe({ lat: c.latitude, lng: c.longitude, source: 'gps' });
          // Throttle: at most one DB upsert every 3s
          const t = Date.now();
          if (t - lastPush > 3000) {
            lastPush = t;
            RF.updateDriverPosition({
              tripId: params?.tripId,
              lat: c.latitude, lng: c.longitude,
              heading: c.heading, speed: c.speed, accuracy: c.accuracy,
              source: 'gps',
            }).catch(() => {});
          }
        },
        () => {/* fall through to simulation */},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
      );
    }
    // Simulation tick — moves "driver" toward current stop every second
    const sim = setInterval(() => {
      setMe((prev) => {
        const target = stops[current]; if (!target) return prev;
        const start = prev || { lat: target.latitude - 0.004, lng: target.longitude - 0.004 };
        const dx = target.latitude - start.lat;
        const dy = target.longitude - start.lng;
        const step = 0.06; // 6% closer per tick
        return { lat: start.lat + dx * step, lng: start.lng + dy * step, source: prev?.source || 'sim' };
      });
    }, 1000);
    return () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); clearInterval(sim); };
  }, [tracking, current, stops]);

  async function markDelivered() {
    const s = stops[current];
    setStops((arr) => arr.map((x, i) => i === current ? { ...x, status: 'delivered' } : x));
    setDismissed(false);
    setDecision(null);
    if (s?.id) {
      try {
        const res = await RF.markStopDeliveredQueued(s.id);
        if (res?.queued) toast('Saved offline - will sync when back online', 'info');
      } catch (e) {
        toast(e?.message || 'Could not save delivery', 'error');
      }
    }
    if (current < stops.length - 1) {
      setCurrent((c) => c + 1);
      if (!(typeof navigator !== 'undefined' && navigator.onLine === false)) {
        toast('Stop delivered', 'success');
      }
      RF.pushActivity({ type: 'submit', title: 'Stop delivered', meta: s?.postcode, tripId: params?.tripId }).catch(() => {});
    } else {
      complete();
    }
  }

  async function complete() {
    const updated = { ...trip, status: 'completed', completedAt: new Date().toISOString() };
    await RF.saveTrip(updated);
    RF.pushActivity({ type: 'submit', title: 'Trip completed', meta: trip.name, tripId: trip.id });
    toast('Trip complete', 'success');
    navigate('summary', { tripId: trip.id });
  }

  function navigateExternal(modeOverride) {
    const cur = stops[current];
    if (!cur) return;
    // Build a Google Maps deep link. Prefer lat/lng for accuracy; postcode as fallback.
    const dest = (cur.latitude != null && cur.longitude != null)
      ? `${cur.latitude},${cur.longitude}`
      : encodeURIComponent(cur.postcode);
    const m = (modeOverride || cur.mode) === 'walking' ? 'walking' : 'driving';
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${m}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Adaptive traffic-aware re-decide on each delivery / current-stop change.
  // Calls Routes API v2 with TRAFFIC_AWARE_OPTIMAL via store.js. We only run
  // when we have a real GPS fix (avoids spurious suggestions during the demo
  // simulation tick) and when the next stop has coordinates.
  // CRITICAL: this hook must live ABOVE any early `return` so the hook call
  // order is stable between loading/ready renders (Rules of Hooks).
  React.useEffect(() => {
    if (loadState !== 'ready') return;
    const c = stops[current];
    if (!c || !me || me.source !== 'gps' || c.latitude == null) return;
    // Find the active park anchor inline (mirrors the activeParkAnchor IIFE
    // below, kept self-contained so we can run before that constant is defined).
    let anchor = null;
    if ((c.clusterSize || 1) > 1) {
      if (c.isParkAnchor) anchor = c;
      else for (let i = current; i >= 0; i--) {
        if (stops[i].clusterId === c.clusterId && stops[i].isParkAnchor) { anchor = stops[i]; break; }
      }
    }
    let cancelled = false;
    const van = anchor && anchor.latitude != null
      ? { lat: Number(anchor.latitude), lng: Number(anchor.longitude) }
      : null;
    RF.decideMode({
      from: { lat: me.lat, lng: me.lng },
      van,
      to: { lat: Number(c.latitude), lng: Number(c.longitude) },
    })
      .then((res) => { if (!cancelled) setDecision(res); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [current, stops, me?.source, loadState]);

  if (loadState !== 'ready' || !trip) {
    let title, body, primary;
    if (loadState === 'no-trip-id') {
      title = 'No trip selected';
      body = 'Open a trip from the dashboard to start delivering.';
      primary = { label: 'Go to dashboard', onClick: () => navigate('dashboard') };
    } else if (loadState === 'not-found') {
      title = 'Trip not found';
      body = 'It may have been deleted, or you opened a stale link. Return to your dashboard to pick up an active trip.';
      primary = { label: 'Go to dashboard', onClick: () => navigate('dashboard') };
    } else {
      title = 'Loading your trip...';
      body = 'Pulling stops, position, and live status. This usually takes under a second.';
      primary = null;
    }
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 440, width: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-lg)', padding: 24, textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 14px', borderRadius: 12, background: loadState === 'not-found' ? 'rgba(255, 69, 58, 0.18)' : 'rgba(10, 132, 255, 0.18)', display: 'grid', placeItems: 'center', color: loadState === 'not-found' ? '#ff453a' : 'var(--color-accent)' }}>
            {loadState === 'loading' ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }}></span> : <I.Info size={20} />}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.5 }}>{body}</div>
          {primary && (
            <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={primary.onClick}>{primary.label}</button>
          )}
        </div>
      </div>
    );
  }
  const cur = stops[current];
  const remaining = stops.length - current - (cur?.status === 'delivered' ? 1 : 0);
  const sheetH = expanded ? '60vh' : '38vh';

  // The "parked van" while the driver is in a cluster: most recent park-anchor
  // stop in the same cluster as the current stop. Only meaningful when the
  // cluster actually involves walking (size > 1) - a "cluster" of 1 is just a
  // drive-up drop and doesn't need a separate van marker.
  const activeParkAnchor = (() => {
    if (!cur || (cur.clusterSize || 1) <= 1) return null;
    if (cur.isParkAnchor) return cur;
    for (let i = current; i >= 0; i--) {
      if (stops[i].clusterId === cur.clusterId && stops[i].isParkAnchor) return stops[i];
    }
    return null;
  })();

  // Walking radius for the active cluster - take the worst walk_from_park_min
  // across walking stops in the cluster. Falls back to 0 when the backend
  // hasn't shipped the per-stop walk distance yet (older edge fn version).
  const parkRadiusMin = activeParkAnchor
    ? Math.max(0, ...stops.filter((s) => s.clusterId === activeParkAnchor.clusterId).map((s) => s.walkFromParkMin || 0))
    : 0;

  // Last walking stop in the current cluster? After this drop the driver
  // walks back to the parked van before any drive-on.
  const isLastWalkInCluster = !!cur && cur.mode === 'walking' &&
    (cur.clusterSize || 1) > 1 &&
    (current === stops.length - 1 || stops[current + 1]?.clusterId !== cur.clusterId);
  const returnWalkMin = cur?.walkFromParkMin || 0;

  // Haversine in metres - used for the live "X m from the van" chip while the
  // driver is walking inside a cluster. Cheap; runs each render with `me`.
  function metresBetween(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
  }
  const liveVanDistanceM = (cur?.mode === 'walking' && !cur?.isParkAnchor && activeParkAnchor && me)
    ? metresBetween(me, { lat: Number(activeParkAnchor.latitude), lng: Number(activeParkAnchor.longitude) })
    : null;

  // Heavy-load override: if the next walking drop is heavy, suggest driving
  // even if the planner picked walking. Threshold scales with distance.
  const heavyWalkWarning = (() => {
    if (!cur || cur.mode !== 'walking') return null;
    const kg = Number(cur.weightKg || 0);
    if (kg < 12) return null;
    // 12-18kg: warn only if walk leg > 60s; 18kg+: always warn.
    const walkSec = (cur.selectedTime || cur.walkingTime || 0) * 60;
    if (kg < 18 && walkSec < 60) return null;
    return { kg, walkSec };
  })();

  // Did the live decision flip the planned mode? (Only flag meaningful
  // savings: at least 45s difference, otherwise it's noise.)
  const decisionFlip = (decision && cur && !dismissed
    && decision.recommended && decision.recommended !== cur.mode
    && decision.deltaSec >= 45) ? decision : null;

  function fmtSec(s) {
    if (s == null) return '—';
    if (s < 90) return `${Math.round(s)}s`;
    return `${Math.round(s / 60)} min`;
  }
  function fmtMetres(m) {
    if (m == null) return '—';
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(2)} km`;
  }

  return (
    <div className="live-shell">
      <div className="live-header">
        <button className="icon-btn" onClick={() => navigate('dashboard')} title="Back"><I.ArrowLeft size={16} /></button>
        <div className="live-header-card">
          <div className="left">
            <div className="small">Currently</div>
            <div className="big">{cur ? cur.postcode : 'No stops'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small">Remaining</div>
            <div className="big mono">{remaining}/{stops.length}</div>
          </div>
        </div>
        <div className="live-header-card" style={{ flex: '0 0 auto', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!online && (
            <span title="Offline - deliveries will sync when back online" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              padding: '3px 7px', borderRadius: 999,
              background: 'rgba(255, 159, 10, 0.18)', color: '#FF9F0A',
              border: '1px solid rgba(255, 159, 10, 0.45)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: '#FF9F0A' }}></span>
              OFFLINE
            </span>
          )}
          {pending > 0 && (
            <span title={`${pending} delivery write${pending === 1 ? '' : 's'} queued for sync`} style={{
              fontSize: 10, fontWeight: 700,
              padding: '3px 7px', borderRadius: 999,
              background: 'rgba(10, 132, 255, 0.18)', color: 'var(--color-accent)',
              border: '1px solid rgba(10, 132, 255, 0.40)',
            }}>{pending} queued</span>
          )}
          <div className="mono fw-600" style={{ fontSize: 13 }}>
            {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
          </div>
        </div>
      </div>

      <div className="live-map">
        <RFUI.FakeMap
          stops={stops}
          current={current}
          me={me}
          parkAnchor={activeParkAnchor}
          parkRadiusMin={parkRadiusMin}
          height="100%"
        />
      </div>

      <div className="bottom-sheet" style={{ maxHeight: sheetH, overflowY: 'auto', transition: 'max-height 0.3s ease' }}>
        <div className="bottom-sheet-handle" onClick={() => setExpanded((e) => !e)} style={{ cursor: 'pointer' }}></div>

        {!cur && (
          <div style={{ padding: '24px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>No active stop</div>
            <div className="text-sm text-secondary" style={{ marginTop: 6 }}>
              {stops.length === 0
                ? 'This trip has no optimised stops yet. Open it from the dashboard to optimise first.'
                : 'All stops have been delivered.'}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => navigate('dashboard')}>
              Back to dashboard
            </button>
          </div>
        )}
        {cur && (
          <div>
            {decisionFlip && (
              <div style={{
                background: decisionFlip.recommended === 'driving'
                  ? 'linear-gradient(135deg, rgba(10,132,255,0.18), rgba(10,132,255,0.06))'
                  : 'linear-gradient(135deg, rgba(48,209,88,0.18), rgba(48,209,88,0.06))',
                border: decisionFlip.recommended === 'driving'
                  ? '1px solid rgba(10,132,255,0.45)' : '1px solid rgba(48,209,88,0.45)',
                borderRadius: 'var(--r-md)',
                padding: '12px 14px',
                marginBottom: 12,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 9,
                  background: decisionFlip.recommended === 'driving' ? 'rgba(10,132,255,0.28)' : 'rgba(48,209,88,0.28)',
                  display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  {decisionFlip.recommended === 'driving' ? <I.Car size={14} /> : <I.Walk size={14} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fw-700" style={{ fontSize: 13 }}>
                    Live traffic suggests {decisionFlip.recommended} this leg
                  </div>
                  <div className="text-xs text-secondary" style={{ marginTop: 2 }}>
                    Plan said <b>{cur.mode}</b> · live check via Routes API:
                    {' '}walk {fmtSec(decisionFlip.walkSec)} ({fmtMetres(decisionFlip.walkM)}),
                    {' '}drive {fmtSec(decisionFlip.driveSec)} ({fmtMetres(decisionFlip.driveM)})
                    {decisionFlip.parkingBufferSec ? ` + ${decisionFlip.parkingBufferSec}s parking` : ''}.
                    {' '}<b>Saves ~{fmtSec(decisionFlip.deltaSec)}.</b>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => navigateExternal(decisionFlip.recommended === 'driving' ? 'driving' : 'walking')}
                      style={{
                        background: decisionFlip.recommended === 'driving' ? 'var(--color-accent)' : '#30D158',
                        color: decisionFlip.recommended === 'driving' ? '#fff' : '#052013',
                        padding: '7px 12px', fontSize: 12, fontWeight: 700,
                        borderRadius: 'var(--r-sm)', border: 'none',
                      }}>
                      Switch to {decisionFlip.recommended} →
                    </button>
                    <button onClick={() => setDismissed(true)}
                      style={{ padding: '7px 10px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      Keep plan
                    </button>
                  </div>
                </div>
              </div>
            )}
            {heavyWalkWarning && !decisionFlip && (
              <div style={{
                background: 'rgba(255, 159, 10, 0.10)',
                border: '1px solid rgba(255, 159, 10, 0.35)',
                borderRadius: 'var(--r-md)',
                padding: '10px 14px',
                marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255, 159, 10, 0.20)', display: 'grid', placeItems: 'center' }}>
                  <I.Info size={14} stroke="#FF9F0A" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fw-700" style={{ fontSize: 13 }}>Heavy load on this drop</div>
                  <div className="text-xs text-secondary">
                    {heavyWalkWarning.kg.toFixed(1)} kg over {(heavyWalkWarning.walkSec / 60).toFixed(1)} min walk.
                    {' '}Consider driving — tap the blue arrow above to override.
                  </div>
                </div>
                <button onClick={() => navigateExternal('driving')}
                  style={{
                    background: 'var(--color-accent)', color: '#fff',
                    padding: '6px 10px', fontSize: 11, fontWeight: 700,
                    borderRadius: 'var(--r-sm)',
                  }}>
                  Drive instead
                </button>
              </div>
            )}
            {cur.weightKg > 0 && !heavyWalkWarning && (
              <div className="text-xs text-muted" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--color-text-muted)' }}></span>
                Package: {Number(cur.weightKg).toFixed(1)} kg
              </div>
            )}
            {cur.isParkAnchor && cur.clusterSize > 1 && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(255,159,10,0.18), rgba(255,159,10,0.06))',
                border: '1px solid rgba(255,159,10,0.45)',
                borderRadius: 'var(--r-md)',
                padding: '10px 14px',
                marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#FF9F0A', display: 'grid', placeItems: 'center', fontWeight: 800, color: '#0a0a0c' }}>P</div>
                <div style={{ minWidth: 0 }}>
                  <div className="fw-700" style={{ fontSize: 14 }}>Park here</div>
                  <div className="text-xs text-secondary">
                    {cur.clusterSize - 1} more drop{cur.clusterSize - 1 === 1 ? '' : 's'} on foot
                    {parkRadiusMin > 0 ? ` within ~${parkRadiusMin} min walk` : ' nearby'}.
                    {' '}Loop back to the van after the last drop.
                  </div>
                </div>
              </div>
            )}
            {cur.mode === 'walking' && !cur.isParkAnchor && activeParkAnchor && (
              <div style={{
                background: 'rgba(48, 209, 88, 0.10)',
                border: '1px solid rgba(48, 209, 88, 0.30)',
                borderRadius: 'var(--r-md)',
                padding: '10px 14px',
                marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(48, 209, 88, 0.20)', display: 'grid', placeItems: 'center' }}>
                  <I.Walk size={14} stroke="#30D158" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fw-700" style={{ fontSize: 13 }}>Walking from your van</div>
                  <div className="text-xs text-secondary">
                    Van parked at <b>{activeParkAnchor.postcode}</b>
                    {cur.walkFromParkMin > 0 && <> · ~{cur.walkFromParkMin}m walk from there</>}
                    {liveVanDistanceM != null && <> · <b>{liveVanDistanceM < 1000 ? `${liveVanDistanceM} m` : `${(liveVanDistanceM/1000).toFixed(2)} km`}</b> away now</>}
                  </div>
                </div>
              </div>
            )}
            {isLastWalkInCluster && (
              <div style={{
                background: 'rgba(10, 132, 255, 0.10)',
                border: '1px solid rgba(10, 132, 255, 0.30)',
                borderRadius: 'var(--r-md)',
                padding: '10px 14px',
                marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(10, 132, 255, 0.20)', display: 'grid', placeItems: 'center' }}>
                  <I.Car size={14} stroke="var(--color-accent)" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="fw-700" style={{ fontSize: 13 }}>Last drop in this cluster</div>
                  <div className="text-xs text-secondary">
                    After "Mark delivered", walk back to your van
                    {activeParkAnchor ? <> at <b>{activeParkAnchor.postcode}</b></> : null}
                    {returnWalkMin > 0 && <> (~{returnWalkMin} min)</>}
                    {' '}before driving on.
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div className={`stop-num ${cur.mode}`} style={{ width: 44, height: 44, borderRadius: 12 }}>
                  {cur.mode === 'walking' ? <I.Walk size={18} /> : <I.Car size={18} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="text-xs text-muted">Stop {current + 1} of {stops.length}{cur.clusterSize > 1 ? ` · cluster of ${cur.clusterSize}` : ''}</div>
                  <div className="mono fw-700" style={{ fontSize: 18 }}>{cur.postcode}</div>
                </div>
              </div>
              <span className={`chip ${cur.mode === 'walking' ? 'chip-walk' : 'chip-drive'}`}>
                {cur.mode === 'walking' ? <I.Walk size={11} /> : <I.Car size={11} />}
                {cur.mode}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
              <Stat label="ETA" value={cur.arrivalTime} mono />
              <Stat label="Distance" value={`${cur.distanceFromPrevious}km`} mono />
              <Stat label="Time" value={`${cur.selectedTime}m`} mono />
            </div>

            <div className="text-sm text-secondary mt-4" style={{ padding: 12, background: 'var(--color-surface-2)', borderRadius: 'var(--r-md)' }}>
              <I.Info size={12} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--color-accent)' }} />
              {cur.reasoning}
            </div>

            {(() => {
              // Primary action: a big mode-aware CTA that launches external
              // navigation in the right travel mode. Colour + label come from
              // the current planned mode + the cluster context.
              let label, sub, bg, fg, border, Icon, mode;
              if (cur.mode === 'walking') {
                mode = 'walking';
                Icon = I.Walk;
                if (isLastWalkInCluster) {
                  label = `WALK TO ${cur.postcode}`;
                  sub = activeParkAnchor
                    ? `Last drop · then walk back to van at ${activeParkAnchor.postcode}`
                    : 'Last drop in this cluster';
                  bg = 'linear-gradient(180deg, #FF9F0A, #C77600)'; fg = '#0a0a0c';
                  border = '1px solid #FF9F0A';
                } else {
                  label = `WALK TO ${cur.postcode}`;
                  sub = activeParkAnchor ? `Van parked at ${activeParkAnchor.postcode}` : 'On foot from your last drop';
                  bg = 'linear-gradient(180deg, #30D158, #1F9F40)'; fg = '#052013';
                  border = '1px solid #30D158';
                }
              } else {
                mode = 'driving';
                Icon = I.Car;
                label = `DRIVE TO ${cur.postcode}`;
                sub = `${cur.distanceFromPrevious || 0} km · ${cur.selectedTime || 0} min planned`;
                bg = 'linear-gradient(180deg, #0A84FF, #0961C7)'; fg = '#fff';
                border = '1px solid #0A84FF';
              }
              return (
                <button onClick={() => navigateExternal(mode)}
                  style={{
                    width: '100%', marginTop: 14,
                    background: bg, color: fg, border,
                    borderRadius: 'var(--r-lg)', padding: '14px 18px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    fontWeight: 800, letterSpacing: '0.01em',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
                    cursor: 'pointer',
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,0,0,0.18)', display: 'grid', placeItems: 'center' }}>
                      <Icon size={18} stroke={fg} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                      <span style={{ fontSize: 16, lineHeight: '20px' }}>{label}</span>
                      <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60vw' }}>{sub}</span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, opacity: 0.85 }}>
                    OPEN MAPS <I.ArrowRight size={14} stroke={fg} />
                  </span>
                </button>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 8, marginTop: 8 }}>
              <button onClick={() => navigateExternal()} title="Open in Maps (planned mode)"
                style={{
                  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center',
                  height: 44,
                }}>
                <I.Map size={16} />
              </button>
              <button className="btn btn-primary" onClick={markDelivered} style={{ height: 44 }}>
                <I.Check size={14} /> Mark delivered
              </button>
            </div>

            {expanded && (
              <div className="mt-6">
                <div className="text-xs fw-600 text-secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>All stops</div>
                <div>
                  {stops.map((s, i) => (
                    <div key={i} className={`stop-row ${i === current ? 'current' : ''} ${s.status === 'delivered' ? 'done' : ''}`}>
                      <div className={`stop-num ${s.mode}`} style={s.isParkAnchor ? { boxShadow: '0 0 0 2px #FF9F0A' } : {}}>{i + 1}</div>
                      <div className="stop-meta">
                        <div className="stop-pc">
                          {s.postcode}
                          {s.isParkAnchor && (
                            <span className="chip" style={{ marginLeft: 8, background: 'rgba(255,159,10,0.15)', color: '#FF9F0A', borderColor: 'rgba(255,159,10,0.4)', fontSize: 10 }}>
                              <I.Car size={10} /> Park · {s.clusterSize}
                            </span>
                          )}
                        </div>
                        <div className="stop-sub">{s.mode} · {s.selectedTime}m · ETA {s.arrivalTime}</div>
                      </div>
                      {s.status === 'delivered' ? <I.CheckCircle size={18} stroke="var(--color-walk)" /> : i === current ? <I.ChevronRight size={18} stroke="var(--color-accent)" /> : <I.ChevronRight size={16} stroke="var(--color-text-muted)" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, mono }) {
  return (
    <div style={{ background: 'var(--color-surface-2)', padding: '10px 12px', borderRadius: 'var(--r-md)' }}>
      <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>{label}</div>
      <div className={mono ? 'mono fw-700' : 'fw-700'} style={{ fontSize: 16, marginTop: 2 }}>{value}</div>
    </div>
  );
}

window.LivePage = LivePage;
