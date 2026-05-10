// Create trip flow — wizard with 3 steps + postcode input methods.
function CreateTripPage({ navigate, params }) {
  const toast = RFUI.useToast();
  const [step, setStep] = React.useState(1);
  const [name, setName] = React.useState('');
  const [startTime, setStartTime] = React.useState('09:00');
  const [endTime, setEndTime] = React.useState('17:00');
  const [mode, setMode] = React.useState('hybrid');
  const [tab, setTab] = React.useState(params?.tab === 'csv' ? 'csv' : 'paste');
  const [bulk, setBulk] = React.useState('');
  const [single, setSingle] = React.useState('');
  const [stops, setStops] = React.useState([]);
  const [weights, setWeights] = React.useState({}); // { 'CT1 1AB': 12, ... }
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef(null);

  React.useEffect(() => { setStops(RF.parsePostcodes(bulk)); }, [bulk]);

  function addSingle() {
    const parsed = RF.parsePostcodes(single);
    if (!parsed.length) { toast('Not a valid postcode', 'error'); return; }
    setStops((s) => Array.from(new Set([...s, ...parsed])));
    setSingle('');
  }
  function removeStop(pc) {
    setStops((s) => s.filter((x) => x !== pc));
    setWeights((w) => { const n = { ...w }; delete n[pc]; return n; });
  }
  function setWeight(pc, kg) {
    const n = Math.max(0, Math.min(50, Number(kg) || 0));
    setWeights((w) => ({ ...w, [pc]: n }));
  }
  const totalWeightKg = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const parsed = RF.parsePostcodes(String(r.result));
      setStops(parsed);
      setTab('paste');
      setBulk(String(r.result));
      toast(`Imported ${parsed.length} postcodes`, 'success');
    };
    r.readAsText(f);
  }

  async function startOptimise() {
    if (saving) return;
    if (stops.length < 2) { toast('Add at least 2 stops', 'error'); return; }
    if (!RF.getCurrentUser()) { toast('Sign in expired - please sign in again', 'error'); navigate('auth'); return; }
    const trip = {
      id: RF.uid(),
      name,
      date: new Date().toISOString(),
      startTime, endTime, mode,
      stops: stops.length,
      stopList: stops,
      totalDistance: 0,
      timeSaved: 0,
      status: 'optimising',
    };
    setSaving(true);
    try {
      await RF.saveTrip(trip);
      // Hold per-stop weights so the optimiser flow can splice them onto the
      // freshly-inserted stop rows after the edge fn returns.
      RF.setTripWeights(trip.id, weights);
      RF.pushActivity({ type: 'submit', title: 'Trip created', meta: `${stops.length} stops · ${name}` }).catch(() => {});
      navigate('optimise', { tripId: trip.id });
    } catch (e) {
      console.error('[create-trip] saveTrip failed', e);
      const msg = (e && e.message) ? e.message : 'Could not save trip';
      toast(msg, 'error');
      setSaving(false);
    }
  }

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('dashboard')} style={{ marginBottom: 12 }}>
        <I.ArrowLeft size={14} /> Dashboard
      </button>
      <div className="page-head">
        <div>
          <div className="page-title">Create trip</div>
          <div className="page-sub">Three quick steps. Saves automatically.</div>
        </div>
      </div>

      <div className="steps">
        {[
          { n: 1, t: 'Trip details' },
          { n: 2, t: 'Add stops' },
          { n: 3, t: 'Confirm' },
        ].map((s, i, arr) => (
          <React.Fragment key={s.n}>
            <div className={`step ${step === s.n ? 'active' : step > s.n ? 'done' : ''}`}>
              <div className="step-dot">{step > s.n ? <I.Check size={12} stroke="#052013" /> : s.n}</div>
              <span>{s.t}</span>
            </div>
            {i < arr.length - 1 && <div className="step-bar"></div>}
          </React.Fragment>
        ))}
      </div>

      {step === 1 && (
        <div className="card slide-up" style={{ maxWidth: 720 }}>
          <div className="flex-col gap-4">
            <div className="field">
              <label className="field-label">Trip name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this trip (e.g. Friday afternoon round)" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label className="field-label">Start time</label>
                <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">End time</label>
                <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Travel mode</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { k: 'hybrid', l: 'Hybrid', s: 'Walk + drive', i: I.Layers },
                  { k: 'walking', l: 'Walking', s: 'Foot only', i: I.Walk },
                  { k: 'driving', l: 'Driving', s: 'Car only', i: I.Car },
                ].map((o) => {
                  const Ic = o.i;
                  const active = mode === o.k;
                  return (
                    <button key={o.k} type="button" onClick={() => setMode(o.k)}
                      style={{
                        padding: 14, borderRadius: 'var(--r-md)', textAlign: 'left',
                        background: active ? 'rgba(10,132,255,0.1)' : 'var(--color-surface-2)',
                        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        transition: 'var(--t-fast)',
                      }}>
                      <Ic size={18} stroke={active ? 'var(--color-accent)' : 'currentColor'} />
                      <div style={{ fontWeight: 600, marginTop: 8, fontSize: 14 }}>{o.l}</div>
                      <div className="text-xs text-muted">{o.s}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!name}>Continue <I.ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card slide-up">
          <div className="tabs" style={{ marginBottom: 16 }}>
            <button className={`tab ${tab === 'paste' ? 'active' : ''}`} onClick={() => setTab('paste')}>Bulk paste</button>
            <button className={`tab ${tab === 'csv' ? 'active' : ''}`} onClick={() => setTab('csv')}>CSV upload</button>
            <button className={`tab ${tab === 'single' ? 'active' : ''}`} onClick={() => setTab('single')}>Single entry</button>
          </div>

          {tab === 'paste' && (
            <div className="field">
              <label className="field-label">Paste postcodes (one per line, comma, or space)</label>
              <textarea className="textarea" placeholder="CT1 1AB&#10;CT1 2HU, CT2 7NF&#10;ME14 1XX" value={bulk} onChange={(e) => setBulk(e.target.value)} style={{ minHeight: 160 }} />
              <div className="field-hint">Detected: <span className="mono" style={{ color: 'var(--color-text-primary)' }}>{stops.length}</span> postcodes</div>
            </div>
          )}

          {tab === 'csv' && (
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={onFile} />
              <div onClick={() => fileRef.current?.click()}
                   style={{ padding: '40px 20px', border: '2px dashed var(--color-border)', borderRadius: 'var(--r-lg)', textAlign: 'center', cursor: 'pointer', background: 'var(--color-surface-2)', transition: 'var(--t-fast)' }}>
                <div className="empty-icon" style={{ background: 'var(--color-surface)' }}><I.Upload size={20} /></div>
                <div style={{ fontWeight: 600 }}>Drop CSV or click to upload</div>
                <div className="text-sm text-muted mt-2">We'll extract any column containing postcodes</div>
              </div>
            </div>
          )}

          {tab === 'single' && (
            <div className="field">
              <label className="field-label">Add one stop at a time</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="CT1 1AB" value={single} onChange={(e) => setSingle(e.target.value)}
                       onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSingle())} />
                <button className="btn btn-primary" onClick={addSingle}>Add</button>
              </div>
            </div>
          )}

          {stops.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Stops ({stops.length})
                </div>
                <div className="text-xs text-muted">
                  Total load: <span className="mono fw-600" style={{ color: 'var(--color-text-primary)' }}>{totalWeightKg.toFixed(1)} kg</span>
                  <span style={{ opacity: 0.7 }}> · weights are optional and used to nudge the walk-vs-drive decision per stop</span>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {stops.map((pc, i) => {
                  const kg = Number(weights[pc] || 0);
                  const heavy = kg >= 15;
                  return (
                    <div key={pc}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '28px 1fr auto auto',
                        alignItems: 'center', gap: 10,
                        padding: '6px 10px',
                        background: 'var(--color-surface-2)',
                        borderRadius: 'var(--r-md)',
                        border: heavy ? '1px solid rgba(255, 159, 10, 0.45)' : '1px solid var(--color-border)',
                      }}>
                      <span className="text-xs mono" style={{ color: 'var(--color-text-muted)', textAlign: 'right' }}>{i + 1}.</span>
                      <span className="mono" style={{ fontSize: 13 }}>{pc}</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: heavy ? '#FF9F0A' : 'var(--color-text-secondary)' }}>
                        <input
                          type="number" min="0" max="50" step="0.5"
                          value={kg || ''}
                          onChange={(e) => setWeight(pc, e.target.value)}
                          placeholder="0"
                          style={{
                            width: 56, height: 26,
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--r-sm)',
                            color: 'var(--color-text-primary)',
                            textAlign: 'right', padding: '0 6px',
                            fontFamily: 'var(--font-mono)', fontSize: 12,
                          }}
                        />
                        <span style={{ minWidth: 16 }}>kg</span>
                      </label>
                      <button onClick={() => removeStop(pc)} title="Remove"
                        style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 6, opacity: 0.6 }}>
                        <I.X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}><I.ArrowLeft size={14} /> Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)} disabled={stops.length < 2}>
              Continue <I.ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card slide-up" style={{ maxWidth: 720 }}>
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 16 }}>Confirm trip</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Detail label="Name" value={name} />
            <Detail label="Mode" value={mode} />
            <Detail label="Time window" value={`${startTime} – ${endTime}`} mono />
            <Detail label="Stops" value={stops.length} mono />
            {totalWeightKg > 0 && (
              <Detail label="Total load" value={`${totalWeightKg.toFixed(1)} kg`} mono />
            )}
            {totalWeightKg > 0 && (
              <Detail
                label="Heaviest drop"
                value={`${Math.max(0, ...Object.values(weights).map((x) => Number(x) || 0)).toFixed(1)} kg`}
                mono
              />
            )}
          </div>
          <div className="divider"></div>
          <div className="text-sm text-secondary">
            Optimisation runs nearest-neighbour clustering, geocodes postcodes, and decides walk-vs-drive per segment.
            Trip is saved to your dashboard automatically.
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}><I.ArrowLeft size={14} /> Back</button>
            <button className="btn btn-primary btn-lg" onClick={startOptimise} disabled={saving}>
              {saving ? (<><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }}></span> Saving...</>) : (<><I.Zap size={16} /> Start optimising</>)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className={mono ? 'mono fw-600' : 'fw-600'} style={{ fontSize: 15, marginTop: 4, textTransform: mono ? 'none' : 'capitalize' }}>{value}</div>
    </div>
  );
}

window.CreateTripPage = CreateTripPage;
