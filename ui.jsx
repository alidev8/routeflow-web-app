// Shared UI primitives + layout shells.
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// --- Toast system ---
const ToastCtx = React.createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' && <I.CheckCircle size={14} />}
            {t.kind === 'error' && <I.AlertTriangle size={14} />}
            {t.kind === 'info' && <I.Info size={14} />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => React.useContext(ToastCtx);

// --- Sidebar ---
function Sidebar({ user, route, navigate, open, onClose, onSignOut }) {
  const isAdmin = !!user?.isAdmin;
  const items = isAdmin ? [
    { key: 'admin', label: 'Operations', icon: I.Home },
    { key: 'admin-users', label: 'Drivers', icon: I.Sparkles },
    { key: 'admin-trips', label: 'All Trips', icon: I.Layers },
    { key: 'settings', label: 'Settings', icon: I.Settings },
  ] : [
    { key: 'dashboard', label: 'Dashboard', icon: I.Home },
    { key: 'create-trip', label: 'Create Trip', icon: I.Plus },
    { key: 'analytics', label: 'Analytics', icon: I.ChartBar },
    { key: 'settings', label: 'Settings', icon: I.Settings },
  ];
  return (
    <>
      {open && <div className="scrim" onClick={onClose}></div>}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark"><I.Route size={18} stroke="#fff" /></div>
          <div className="sidebar-brand-name">RouteFlow</div>
          {isAdmin && <span className="role-badge role-badge-admin">Admin</span>}
        </div>
        {items.map((it) => {
          const Ico = it.icon;
          return (
            <div key={it.key} className={`nav-item ${route === it.key ? 'active' : ''}`}
                 onClick={() => { navigate(it.key); onClose && onClose(); }}>
              <Ico className="nav-icon" size={18} />
              <span>{it.label}</span>
            </div>
          );
        })}
        <div className="sidebar-foot">
          <div className="avatar">{(user?.fullName || user?.email || '?').slice(0, 1).toUpperCase()}</div>
          <div className="user-meta flex-1">
            <div className="user-name">{user?.fullName || (isAdmin ? 'Manager' : 'Driver')}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button className="icon-btn" onClick={onSignOut} title="Sign out" style={{ width: 32, height: 32 }}>
            <I.LogOut size={14} />
          </button>
        </div>
      </aside>
    </>
  );
}

function MobileHeader({ onMenu, title }) {
  return (
    <div className="mobile-header">
      <div className="brand">
        <div className="sidebar-brand-mark" style={{ width: 28, height: 28 }}><I.Route size={15} stroke="#fff" /></div>
        <span>{title || 'RouteFlow'}</span>
      </div>
      <button className="icon-btn" onClick={onMenu} aria-label="Menu"><I.Menu size={18} /></button>
    </div>
  );
}

// --- Google Maps loader (singleton; loads the JS API on demand) ---
const GoogleMapsLoader = (() => {
  let promise = null;
  function ensure() {
    if (promise) return promise;
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    const key = (window.RF_CONFIG && window.RF_CONFIG.GOOGLE_MAPS_KEY) || '';
    if (!key) return Promise.reject(new Error('GOOGLE_MAPS_KEY missing in RF_CONFIG'));
    promise = new Promise((resolve, reject) => {
      window.__rfGoogleMapsCb = () => resolve(window.google.maps);
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry,places&callback=__rfGoogleMapsCb&v=weekly`;
      s.async = true;
      s.defer = true;
      s.onerror = () => reject(new Error('Failed to load Google Maps JS'));
      document.head.appendChild(s);
    });
    return promise;
  }
  return { ensure };
})();

// Dark-mode style closely matching the RouteFlow palette
const RF_DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d2d4d7' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0e2a18' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3aa364' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1c1f' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0a0a0c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a2d31' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#0a0a0c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1a1c1f' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#06121b' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3a6a96' }] },
];

function pinSvg(label, fill, stroke = '#fff') {
  // Compact circle pin used as a Google Maps marker icon
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
    <circle cx="17" cy="17" r="13" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <text x="17" y="21.5" text-anchor="middle" font-family="Outfit,sans-serif" font-size="13" font-weight="700" fill="#fff">${label}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

function driverSvg() {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
    <circle cx="13" cy="13" r="10" fill="#0A84FF" stroke="#fff" stroke-width="3"/>
    <circle cx="13" cy="13" r="4" fill="#fff"/>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

// Concurrency-limited batch: run async tasks `n` at a time.
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await worker(items[i], i); }
      catch (e) { results[i] = null; }
    }
  });
  await Promise.all(runners);
  return results;
}

// --- Real map (Google Maps JS API) ---
function RouteMap({ stops = [], current = -1, me = null, parkAnchor = null, parkRadiusMin = 0, parkRadiusM = 0, height = 320, withLabels = false, interactive = true }) {
  const ref = React.useRef(null);
  const mapRef = React.useRef(null);
  const markersRef = React.useRef([]);
  const polysRef = React.useRef([]);
  const meMarkerRef = React.useRef(null);
  const parkMarkerRef = React.useRef(null);
  const parkCircleRef = React.useRef(null);
  const directionsServiceRef = React.useRef(null);
  const drawTokenRef = React.useRef(0);
  const [error, setError] = React.useState(null);

  // Initialise map once
  React.useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let cancelled = false;
    GoogleMapsLoader.ensure().then((maps) => {
      if (cancelled || !ref.current) return;
      const map = new maps.Map(ref.current, {
        center: { lat: 51.5, lng: 0.05 },
        zoom: 12,
        disableDefaultUI: !interactive,
        zoomControl: interactive,
        gestureHandling: interactive ? 'auto' : 'none',
        clickableIcons: false,
        styles: RF_DARK_MAP_STYLES,
        backgroundColor: '#0a0a0c',
      });
      mapRef.current = map;
      directionsServiceRef.current = new maps.DirectionsService();
    }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [interactive]);

  // Draw stops + route polylines (real road geometry via DirectionsService)
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const maps = window.google.maps;

    // Clear previous overlays
    markersRef.current.forEach((m) => m.setMap(null));
    polysRef.current.forEach((p) => p.setMap(null));
    markersRef.current = [];
    polysRef.current = [];

    if (!stops.length) return;

    const latlngs = stops
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }));
    if (!latlngs.length) return;

    // Place markers immediately (don't wait on directions)
    stops.forEach((s, i) => {
      if (s.latitude == null) return;
      const isCur = i === current;
      const isStart = i === 0;
      const isPark = !!s.isParkAnchor;
      const fill = isCur ? '#0A84FF'
        : isPark ? '#FF9F0A'
        : isStart ? '#FF9F0A'
        : (s.mode === 'walking' ? '#30D158' : '#64D2FF');
      const m = new maps.Marker({
        position: { lat: Number(s.latitude), lng: Number(s.longitude) },
        map,
        icon: {
          url: pinSvg(String(i + 1), fill, isPark ? '#FFD58A' : '#fff'),
          scaledSize: new maps.Size(isPark ? 38 : 34, isPark ? 38 : 34),
          anchor: new maps.Point(isPark ? 19 : 17, isPark ? 19 : 17),
        },
        title: `${s.postcode}${isPark ? ' - PARK' : ''} - ${s.mode || ''} ${s.selectedTime || 0}m`,
        zIndex: isCur ? 999 : isPark ? 500 : 100 + i,
      });
      const parkLine = isPark ? `<div style="color:#a05300;font-weight:600;margin-top:2px">Park here · cluster of ${s.clusterSize || 1}</div>` : '';
      const info = new maps.InfoWindow({
        content: `<div style="font-family:Outfit,sans-serif;color:#0a0a0c"><b>${s.postcode}</b><br/>${s.mode || ''} · ${s.selectedTime || 0}m · ${s.arrivalTime || ''}${parkLine}</div>`,
      });
      m.addListener('click', () => info.open({ anchor: m, map }));
      markersRef.current.push(m);
    });

    // Fit bounds first
    if (latlngs.length === 1) {
      map.setCenter(latlngs[0]); map.setZoom(15);
    } else if (current >= 0 && latlngs[current]) {
      map.panTo(latlngs[current]); map.setZoom(15);
    } else {
      const bounds = new maps.LatLngBounds();
      latlngs.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 60);
    }

    // Real road polylines via DirectionsService - concurrency-limited batch.
    // Each segment between consecutive stops -> one Directions request matching
    // the destination stop's travel mode. We invalidate via a token so a fast
    // re-render (e.g. delivered status flipped) doesn't draw stale lines.
    const myToken = ++drawTokenRef.current;
    const service = directionsServiceRef.current;
    if (!service) return;

    const segments = [];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (a.latitude == null || b.latitude == null) continue;
      segments.push({
        from: { lat: Number(a.latitude), lng: Number(a.longitude) },
        to: { lat: Number(b.latitude), lng: Number(b.longitude) },
        mode: b.mode === 'walking' ? 'WALKING' : 'DRIVING',
      });
    }

    runWithConcurrency(segments, 6, (seg) =>
      new Promise((resolve) => {
        service.route(
          { origin: seg.from, destination: seg.to, travelMode: seg.mode },
          (res, status) => {
            if (status !== 'OK' || !res?.routes?.[0]) return resolve(null);
            resolve({ seg, route: res.routes[0] });
          },
        );
      }),
    ).then((results) => {
      if (drawTokenRef.current !== myToken) return; // a newer render started
      results.forEach((r) => {
        if (!r) {
          return; // segment failed - silently skip; straight-line fallback below
        }
        const isWalk = r.seg.mode === 'WALKING';
        const colour = isWalk ? '#30D158' : '#64D2FF';
        const poly = new maps.Polyline({
          path: r.route.overview_path,
          geodesic: false,
          strokeColor: colour,
          strokeOpacity: isWalk ? 0 : 0.9,
          strokeWeight: 4,
          icons: isWalk ? [{
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3, strokeColor: colour },
            offset: '0', repeat: '12px',
          }] : undefined,
        });
        poly.setMap(map);
        polysRef.current.push(poly);
      });

      // For any failed segment, draw a faint straight-line fallback so the route stays visually continuous.
      results.forEach((r, idx) => {
        if (r) return;
        const seg = segments[idx];
        if (!seg) return;
        const isWalk = seg.mode === 'WALKING';
        const colour = isWalk ? '#30D158' : '#64D2FF';
        const poly = new maps.Polyline({
          path: [seg.from, seg.to],
          geodesic: true,
          strokeColor: colour,
          strokeOpacity: 0.35,
          strokeWeight: 2,
        });
        poly.setMap(map);
        polysRef.current.push(poly);
      });
    });
  }, [stops, current]);

  // Parked van overlay - shows the cluster anchor while the driver is doing
  // walking deliveries inside the cluster. Includes a translucent walking
  // radius so the driver sees how far each remaining drop is from the van.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const maps = window.google.maps;

    // Always tear down before redrawing so a cluster change cleans up.
    if (parkMarkerRef.current) { parkMarkerRef.current.setMap(null); parkMarkerRef.current = null; }
    if (parkCircleRef.current) { parkCircleRef.current.setMap(null); parkCircleRef.current = null; }

    if (!parkAnchor || parkAnchor.latitude == null) return;
    const pos = { lat: Number(parkAnchor.latitude), lng: Number(parkAnchor.longitude) };
    const vanSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="14" fill="#FF9F0A" stroke="#fff" stroke-width="3"/>
      <path d="M11 13h8l2 4v3h-1.5a1.5 1.5 0 0 1-3 0H14a1.5 1.5 0 0 1-3 0H10v-6z" fill="#0a0a0c"/>
      <circle cx="13" cy="20.5" r="1.4" fill="#fff"/>
      <circle cx="19" cy="20.5" r="1.4" fill="#fff"/>
    </svg>`;
    parkMarkerRef.current = new maps.Marker({
      position: pos, map,
      icon: {
        url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(vanSvg),
        scaledSize: new maps.Size(34, 34),
        anchor: new maps.Point(17, 17),
      },
      title: `Parked van - ${parkAnchor.postcode}`,
      zIndex: 750,
    });
    if (parkRadiusM > 0 || parkRadiusMin > 0) {
      // Prefer the real metre value when the edge fn supplied it; otherwise
      // approximate from minutes (~80 m per walking minute @ 1.3 m/s, padded).
      const radiusM = parkRadiusM > 0
        ? Math.max(60, Math.round(parkRadiusM * 1.1))
        : Math.max(120, Math.round(parkRadiusMin * 80 * 1.1));
      parkCircleRef.current = new maps.Circle({
        center: pos, radius: radiusM, map,
        fillColor: '#FF9F0A', fillOpacity: 0.08,
        strokeColor: '#FF9F0A', strokeOpacity: 0.45, strokeWeight: 1.5,
        clickable: false,
      });
    }
  }, [parkAnchor, parkRadiusMin, parkRadiusM]);

  // Driver position marker
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const maps = window.google.maps;
    if (!me) {
      if (meMarkerRef.current) { meMarkerRef.current.setMap(null); meMarkerRef.current = null; }
      return;
    }
    const pos = { lat: Number(me.lat), lng: Number(me.lng) };
    if (meMarkerRef.current) {
      meMarkerRef.current.setPosition(pos);
    } else {
      meMarkerRef.current = new maps.Marker({
        position: pos,
        map,
        icon: { url: driverSvg(), scaledSize: new maps.Size(26, 26), anchor: new maps.Point(13, 13) },
        zIndex: 9999,
        optimized: false,
      });
    }
  }, [me]);

  return (
    <div className="map" style={{ height, width: '100%', position: 'relative' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: '#0a0a0c' }}></div>
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div className="text-sm" style={{ color: '#ff453a', background: 'rgba(0,0,0,0.6)', padding: '8px 14px', borderRadius: 999 }}>
            Maps error: {error}
          </div>
        </div>
      )}
      {!error && !stops.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div className="text-sm text-muted" style={{ background: 'rgba(0,0,0,0.4)', padding: '8px 14px', borderRadius: 999, backdropFilter: 'blur(8px)' }}>
            Map will populate after optimisation
          </div>
        </div>
      )}
      {withLabels && stops.length > 0 && (
        <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 8, zIndex: 400, pointerEvents: 'none' }}>
          <span className="chip chip-walk"><I.Walk size={11} /> Walk</span>
          <span className="chip chip-drive"><I.Car size={11} /> Drive</span>
        </div>
      )}
    </div>
  );
}

window.RFUI = { ToastProvider, useToast, Sidebar, MobileHeader, RouteMap };
