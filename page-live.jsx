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

  React.useEffect(() => {
    const t = RF.getTrip(params?.tripId);
    if (!t) { toast('Trip not found', 'error'); navigate('dashboard'); return; }
    setTrip(t);
    setStops(t.optimised || []);
    // Mark trip in-progress as soon as the live page mounts (idempotent).
    if (t.status !== 'in-progress' && t.status !== 'completed') {
      RF.saveTrip({ ...t, status: 'in-progress' }).catch(() => {});
    }
    // Realtime: keep stops + trip in sync if another device updates them.
    const off = RF.subscribe(() => {
      const fresh = RF.getTrip(params?.tripId);
      if (fresh) { setTrip(fresh); setStops(fresh.optimised || []); }
    });
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(i); off(); };
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

  function markDelivered() {
    const s = stops[current];
    setStops((arr) => arr.map((x, i) => i === current ? { ...x, status: 'delivered' } : x));
    if (s?.id) RF.markStopDelivered(s.id).catch(() => {});
    if (current < stops.length - 1) {
      setCurrent((c) => c + 1);
      toast('Stop delivered', 'success');
      RF.pushActivity({ type: 'submit', title: 'Stop delivered', meta: s?.postcode, tripId: params?.tripId });
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

  function navigateExternal() {
    const cur = stops[current];
    if (!cur) return;
    // Build a Google Maps deep link. Prefer lat/lng for accuracy; postcode as fallback.
    const dest = (cur.latitude != null && cur.longitude != null)
      ? `${cur.latitude},${cur.longitude}`
      : encodeURIComponent(cur.postcode);
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${cur.mode === 'walking' ? 'walking' : 'driving'}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  if (!trip) return <div className="page"><div className="skel" style={{ height: 200 }}></div></div>;
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
        <div className="live-header-card" style={{ flex: '0 0 auto', padding: '10px 12px' }}>
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

        {cur && (
          <div>
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

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-secondary" onClick={navigateExternal} style={{ flex: 1 }}>
                <I.Map size={14} /> Navigate
              </button>
              <button className="btn btn-primary" onClick={markDelivered} style={{ flex: 1.5 }}>
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
