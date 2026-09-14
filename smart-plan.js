/* Arc Adapt - Smart Plan. BUILT BY tests/patch-p205.py FROM tests/smart-plan/engine-v1.6.2.js
   (sha256 81cc74b56aa4361cd2f8c574053a9c7a075c281ff6e4e532e6cadc5a5dd0f3f4) plus the Pass 205 integration edits listed in that script,
   then tests/patch-p206.py (the guided-flow UI, Pass 206), then tests/patch-p208.py (zoom + pan on the previews), then tests/patch-p209.py (local-mean ink, interior gate, bare-number reader, no-rebuild ticks, handles), then tests/patch-p210.py (handles at once, Accept all, Issues header, read diagnostics), then tests/patch-p211.py (the box snaps to the symbol; sticky step nav), then tests/patch-p212.py (light mode), then tests/patch-p213.py (closed-rectangle snap; the type sticks). The engine functions are byte-identical to V0.184.
   Do not hand-edit this file: change the engine or the patcher and rebuild. */
/*
 * Arc Adapt Smart Plan — native integration shell
 * Copyright (c) 2026 Reece Francis. All rights reserved.
 *
 * This file deliberately stages Smart Plan results OUTSIDE Arc's `objects`,
 * `levels`, `fsSite.plan`, IndexedDB autosave and the Asset Register until the
 * reviewer presses Commit. It contains no client data. Native v1.6.2 keeps the
 * proven end-to-end staging/perception boundary and repairs the OCR-fill slice:
 * centred reads first, unresolved rows retry up/down/right/left, then only rows
 * still unresolved get four 230x130 source-pixel quadrant crops at the existing
 * 2x OCR raster, raw pixels, PSM 6. Every recovered label still goes through the
 * same global one-to-one 60 px assignment, consistency guards, reconciliation and
 * review gate.
 */
(function () {
  'use strict';

  const VERSION = 'native-v1.6.2';
  const MODAL_ID = 'fsSmartPlanModal';
  const BTN_ID = 'fsSmartPlanBtn';
  const FILE_ID = 'fsSmartPlanCandidateFile';
  const SCHEDULE_FILE_ID = 'fsSmartPlanScheduleFile';
  const ZONE_SOURCE_FILE_ID = 'fsSmartPlanZoneSourceFile';
  const STYLE_ID = 'fsSmartPlanStyle';
  const MAX_FIELD = 5;
  const MAX_CANVAS_FALLBACK = 16000000;
  const EXPECTED_COORD_SPACE = 'current-workspace-px';
  const OCR_ASSIGN_MAX_PX = 60;
  const OCR_RETRY_SETTLED_EDGE_PX = 34;
  const OCR_SCRIPT = './ocr/tesseract.min.js';
  const OCR_WORKER = './ocr/worker.min.js';
  const OCR_CORE = './ocr/tesseract-core-simd-lstm.wasm.js';
  const OCR_LANG = './ocr';
  const OCR_CROP_MAX_PX = 1500000;
  const OCR_RETRY_DIRECTIONS = Object.freeze([{name:'up',dx:0,dy:-1},{name:'down',dx:0,dy:1},{name:'right',dx:1,dy:0},{name:'left',dx:-1,dy:0}]);
  /* PASS 209 [209-G3] - BARE-NUMBER SHEETS. Some drawings print only the device
     number beside the symbol (58, not L01.D58), 7 px tall at the sheet's own
     resolution. Four tight strips around the symbol, Lanczos 6x, one line,
     digits only; a read must agree across two scales. */
  const OCR_STRIP_UPSCALES = [5, 7], OCR_STRIP_UPSCALE = 6, OCR_STRIP_SINGLE_MIN_CONF = 85, OCR_STRIP_NARROW_CUT = 0.2, OCR_STRIP_ADOPT_RATIO = 0.15, OCR_STYLE_PROBE_N = 6;
  const OCR_STRIPS = Object.freeze([
    {name:'left', x:-1.45, y:-0.5, w:1.0, h:1.0},
    {name:'up',   x:-0.65, y:-1.35, w:1.3, h:0.9},
    {name:'right',x: 0.45, y:-0.5, w:1.0, h:1.0},
    {name:'down', x:-0.65, y: 0.45, w:1.3, h:0.9}
  ]);
  const OCR_QUADRANT_W = 230;
  const OCR_QUADRANT_H = 130;
  const OCR_QUADRANT_OFFSET_X = 55;
  const OCR_QUADRANT_OFFSET_Y = 35;
  const OCR_QUADRANTS = Object.freeze([
    {name:'above-left',dx:-OCR_QUADRANT_OFFSET_X,dy:-OCR_QUADRANT_OFFSET_Y},
    {name:'above-right',dx:OCR_QUADRANT_OFFSET_X,dy:-OCR_QUADRANT_OFFSET_Y},
    {name:'below-left',dx:-OCR_QUADRANT_OFFSET_X,dy:OCR_QUADRANT_OFFSET_Y},
    {name:'below-right',dx:OCR_QUADRANT_OFFSET_X,dy:OCR_QUADRANT_OFFSET_Y}
  ]);
  const DETECT_WORK_MAX_PX = 6000000;   /* [213-E] a 2835x2004 sheet is matched at 1:1 */
  /* PASS 209 [209-G1/G2] - see patch-p209.py. Local-mean ink; interior look-alike gate. */
  const INK_LOCAL_RADIUS = 24, INK_LOCAL_DROP = 45, INK_ABS_MAX = 200;
  const DETECT_INTERIOR_TRIM = 0.22, DETECT_INTERIOR_NCC_MIN = 0.62, DETECT_INTERIOR_NCC_SURE = 0.8, DETECT_INTERIOR_INK_MIN = 0.35, DETECT_INTERIOR_INK_LIKE = 1.3, DETECT_INTERIOR_INK_MAX = 2.0;
  const DETECT_DEFAULT_THRESHOLD = 0.50;
  const DETECT_SCALES = [0.95, 1.0, 1.05, 1.15];
  const DETECT_ROTATIONS = [0, 90, 180, 270];
  const DETECT_NMS_IOU = 0.15;
  const DETECT_NMS_CENTRE_FACTOR = 1.30;
  const DETECT_MAX_RESULTS = 400;
  const ZONE_SOURCE_MAX_PX = 2500000;
  const ZONE_DENSITY_THRESHOLD = 0.015;
  const ZONE_DENSITY_AUTO_DIVISOR = 4;
  const ZONE_DENSITY_AUTO_MIN = 0.008;
  const ZONE_DENSITY_AUTO_MAX = 0.080;
  const ZONE_OVERLAP_WARN_FRACTION = 0.03;
  const ZONE_MOSTLY_OUTSIDE_FRACTION = 0.50;
  const ZONE_BASE_WINDOW_ORIGINAL_PX = 61;
  const ZONE_ALIGN_MIN_POINTS = 3;
  const ZONE_ALIGN_DEFAULT_SYMBOL_PX = 44;

  let session = null;
  let ocrWorkerPromise = null;


  function clone(v) {
    if (v == null) return v;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(v); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(v));
  }

  function hostReady() {
    return typeof objects !== 'undefined' && Array.isArray(objects) &&
           typeof levels !== 'undefined' && Array.isArray(levels) &&
           typeof curLevel !== 'undefined';
  }

  function hostSnapshot() {
    if (!hostReady()) return null;
    return {
      level: Number(curLevel || 0),
      levelCount: levels.length,
      levelName: field(levels[curLevel] && levels[curLevel].name),
      levelImage: levels[curLevel] && levels[curLevel].image,
      objectJson: JSON.stringify(objects)
    };
  }

  function hostUnchanged(snap) {
    if (!snap || !hostReady()) return false;
    if (Number(curLevel || 0) !== snap.level) return false;
    if (levels.length !== snap.levelCount) return false;
    if (field(levels[curLevel] && levels[curLevel].name) !== snap.levelName) return false;
    if ((levels[curLevel] && levels[curLevel].image) !== snap.levelImage) return false;
    return JSON.stringify(objects) === snap.objectJson;
  }

  function field(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

  function arcTypeKnown(type) {
    if (!type) return false;
    try { return !!(typeof TYPE_MAP !== 'undefined' && TYPE_MAP && TYPE_MAP[type]); }
    catch (_) { return true; }
  }

  function arcTypeLabel(type) {
    try {
      const t = (typeof TYPE_MAP !== 'undefined' && TYPE_MAP) ? TYPE_MAP[type] : null;
      return (t && (t.name || t.label)) || type || 'Unknown';
    } catch (_) { return type || 'Unknown'; }
  }

  function candidateId(i, o) {
    return field(o && (o.spId || o.id || o.detection_id || o.qid)) || `sp-${i + 1}`;
  }

  function getResolved(d, key) {
    if (!d) return '';
    if (d.resolved && d.resolved[key] != null) {
      const r = d.resolved[key];
      if (r && typeof r === 'object' && 'value' in r) return r.value;
      return r;
    }
    if (d.identity && d.identity[key] != null) return d.identity[key];
    if (d.edited && d.edited[key] != null) return d.edited[key];
    return d[key];
  }

  function getSource(d, key) {
    if (!d) return '';
    const r = d.resolved && d.resolved[key];
    if (r && typeof r === 'object' && r.source) return field(r.source);
    if (d.provenance && d.provenance[key]) return field(d.provenance[key]);
    return '';
  }

  function centreOf(d) {
    const c = d && (d.centre || d.center);
    if (Array.isArray(c) && c.length >= 2) return { x:num(c[0]), y:num(c[1]) };
    if (c && typeof c === 'object') return { x:num(c.x), y:num(c.y) };
    const x = num(d && (d.x != null ? d.x : d.x_px != null ? d.x_px : d.cx));
    const y = num(d && (d.y != null ? d.y : d.y_px != null ? d.y_px : d.cy));
    return { x, y };
  }

  function mmFor(type) {
    /* Arc stores catalogue metadata in FS_SYM_MM, but hand-placed symbols carry
       the numeric mm value returned by fsSymMm(type). Never copy the spec object. */
    try {
      if (typeof fsSymMm === 'function') {
        const v = Number(fsSymMm(type));
        if (Number.isFinite(v)) return v;
      }
    } catch (_) {}
    try {
      if (typeof FS_SYM_MM !== 'undefined' && FS_SYM_MM && FS_SYM_MM[type] != null) {
        const spec = FS_SYM_MM[type];
        const v = Number(spec && typeof spec === 'object' ? spec.mm : spec);
        if (Number.isFinite(v)) return v;
      }
    } catch (_) {}
    if (type === 'smoke' || type === 'thermal' || type === 'csmoke' || type === 'cthermal') return 100;
    if (type === 'mcp') return 87;
    return null;
  }

  function sizeFor(type) {
    try {
      if (typeof symSizeFor === 'function') {
        const s = Number(symSizeFor(type));
        if (Number.isFinite(s) && s > 0) return s;
      }
    } catch (_) {}
    return 32;
  }

  /* Every candidate, including the programmatic {obj:{...}} path, is reborn in
     Arc's native point-symbol shape. Recognition may observe identity/rotation;
     it does not get to smuggle a partial object across the commit boundary. */
  function birthSymbol(raw) {
    raw = raw || {};
    const p = centreOf(raw);
    const type = field(getResolved(raw, 'type') || raw.type);
    const rot = num(raw.rot);
    const o = {
      kind:'sym', type:type, x:p.x, y:p.y, size:sizeFor(type),
      mm:mmFor(type), rot:rot == null ? 0 : rot,
      fx:raw.fx === true, fy:raw.fy === true,
      zone:field(getResolved(raw, 'zone')),
      loop:field(getResolved(raw, 'loop')),
      dev:field(getResolved(raw, 'dev') || getResolved(raw, 'device') || getResolved(raw, 'address')),
      info:field(getResolved(raw, 'info') || raw.info)
    };
    if (type === 'thermal' || type === 'cthermal') {
      o.thm=field(raw.thm) || 'ror';
      o.thv=field(raw.thv) || '60';
    }
    /* qid and zoneMan are intentionally not copied. Arc owns QR identity and
       commit() alone decides whether a supplied zone is manual. */
    return o;
  }

  function normaliseZone(z, i) {
    if (!z) return null;
    if (z.kind === 'zone') {
      const out = clone(z); out.zn = field(out.zn != null ? out.zn : out.zone); return out;
    }
    const pts0 = z.pts || z.points || z.polygon || [];
    const pts = (pts0 || []).map(p => Array.isArray(p) ? {x:num(p[0]), y:num(p[1])} : {x:num(p.x), y:num(p.y)})
      .filter(p => p.x != null && p.y != null);
    if (pts.length < 3) return null;
    return { kind:'zone', zn:field(z.zn != null ? z.zn : z.zone != null ? z.zone : z.id || (i+1)), pts:pts };
  }

  function normaliseZoneCandidate(z, i) {
    z = z || {};
    const raw = (z.obj && z.obj.kind === 'zone') ? z.obj : z;
    const obj = normaliseZone(raw, i);
    if (!obj) return null;
    const decision0 = field(z.decision).toLowerCase();
    /* Transferred/detected zones are geometry with a large blast radius: an Arc
       zone edit can re-zone existing automatic devices. Therefore zones start
       in Review unless a trusted caller explicitly marks one accepted. */
    const decision = decision0 === 'accepted' ? 'accepted' : decision0 === 'rejected' ? 'rejected' : 'review';
    return {
      id: field(z.id || z.spId || raw.id) || `zone-${i + 1}`,
      obj,
      decision,
      source:field(z.source || (z.meta && z.meta.source)),
      confidence:Number.isFinite(Number(z.confidence)) ? Number(z.confidence) : null
    };
  }

  function issuesFor(obj, meta) {
    const out = [];
    if (!obj || obj.kind !== 'sym') out.push({code:'not_symbol', level:'error', text:'Not a device symbol'});
    if (!field(obj && obj.type)) out.push({code:'missing_type', level:'error', text:'Device type missing'});
    else if (!arcTypeKnown(obj.type)) out.push({code:'unknown_type', level:'error', text:`Unknown Arc type: ${obj.type}`});
    if (num(obj && obj.x) == null || num(obj && obj.y) == null) out.push({code:'missing_position', level:'error', text:'Position missing'});
    ['zone','loop','dev'].forEach(k => {
      const v = field(obj && obj[k]);
      if (v.length > MAX_FIELD) out.push({code:`${k}_too_long`, level:'error', text:`${k} exceeds Arc's ${MAX_FIELD}-character field`});
    });
    if (meta && meta.requiresDeviceNumber && !field(obj.dev)) out.push({code:'missing_dev', level:'review', text:'Device number/address unread'});
    if (meta && meta.confidence != null && Number(meta.confidence) < 0.75) out.push({code:'low_confidence', level:'review', text:'Low recognition confidence'});
    if (meta && meta.source === 'template' && meta.suspectStub) {
      const score=Number.isFinite(Number(meta.closedContourScore)) ? ` (closed-contour ${Number(meta.closedContourScore).toFixed(2)})` : '';
      out.push({code:'stub_candidate', level:'review', text:`Possible leader-line stub false positive${score}`});
    }
    if (meta && meta.ocrIssue) out.push({code:'ocr_review', level:'review', text:meta.ocrIssue});
    if (meta && meta.scheduleIssue) out.push({code:'schedule_mismatch', level:'review', text:meta.scheduleIssue});
    return out;
  }

  function normaliseDetection(d, i) {
    d = d || {};
    const raw = (d.obj && typeof d.obj === 'object') ? d.obj : d;
    const obj = birthSymbol(raw);
    const m0 = (d.meta && typeof d.meta === 'object') ? d.meta : {};
    const conf = Number(m0.confidence != null ? m0.confidence : (d.confidence != null ? d.confidence : d.conf));
    const meta = {
      confidence:Number.isFinite(conf) ? conf : null,
      source:field(m0.source || d.source || d.method || d.detector),
      requiresDeviceNumber:truthy(m0.requiresDeviceNumber != null ? m0.requiresDeviceNumber : (d.requiresDeviceNumber || d.requires_dev)),
      zoneSource:field(m0.zoneSource || getSource(d, 'zone') || getSource(raw, 'zone')),
      loopSource:field(m0.loopSource || getSource(d, 'loop') || getSource(raw, 'loop')),
      devSource:field(m0.devSource || getSource(d, 'dev') || getSource(raw, 'dev')),
      suspectStub:truthy(m0.suspectStub != null ? m0.suspectStub : (d.suspectStub || d.suspect_stub)),
      ocrIssue:field(m0.ocrIssue),
      scheduleIssue:field(m0.scheduleIssue),
      scheduleId:field(m0.scheduleId),
      ocrDistance:m0.ocrDistance == null ? null : Number(m0.ocrDistance),
      ocrConfidence:m0.ocrConfidence == null ? null : Number(m0.ocrConfidence),
      detectorRun:field(m0.detectorRun),
      detectorSignal:field(m0.detectorSignal),
      bbox:Array.isArray(m0.bbox) ? m0.bbox.map(Number) : null,
      rotation:m0.rotation == null ? null : Number(m0.rotation),
      interiorNcc:m0.interiorNcc == null ? null : Number(m0.interiorNcc),
      interiorInk:m0.interiorInk == null ? null : Number(m0.interiorInk),
      mirrored:m0.mirrored === true,
      scale:m0.scale == null ? null : Number(m0.scale),
      closedContourScore:m0.closedContourScore == null ? null : Number(m0.closedContourScore),
      closedContourSides:m0.closedContourSides == null ? null : Number(m0.closedContourSides)
    };
    const decision0 = field(d.decision).toLowerCase();
    const issues = issuesFor(obj, meta);
    const fatal = issues.some(x => x.level === 'error');
    const review = issues.some(x => x.level === 'review');
    let decision = decision0 === 'rejected' ? 'rejected' : decision0 === 'accepted' ? 'accepted' : (fatal || review ? 'review' : 'accepted');
    return { id:candidateId(i,d), obj, meta, issues, decision };
  }

  function currentDims() {
    try { if (typeof img !== 'undefined' && img) return {w:img.naturalWidth || img.width || 0, h:img.naturalHeight || img.height || 0}; } catch (_) {}
    return {w:0,h:0};
  }

  function nativeKey(o, levelName) {
    try { if (typeof fsAssetKey === 'function') return fsAssetKey(o, levelName); } catch (_) {}
    const t = arcTypeLabel(o.type);
    return `dev:${levelName || ''}:${t}:${field(o.zone)}:${field(o.loop)}:${field(o.dev)}`;
  }

  function candidateLevelName() {
    try { return field(levels[curLevel] && levels[curLevel].name) || `Level ${Number(curLevel||0)+1}`; }
    catch (_) { return 'Level 1'; }
  }

  function hiddenSet(value) {
    if (Array.isArray(value)) return new Set(value.map(field).filter(Boolean));
    if (value && typeof value === 'object') return new Set(Object.keys(value).filter(k => value[k] === true).map(field).filter(Boolean));
    return new Set();
  }

  function hiddenTypesNow() {
    try {
      if (typeof fsHiddenTypes === 'function') return hiddenSet(fsHiddenTypes());
    } catch (_) {}
    try {
      const lv=levels[curLevel]; return hiddenSet(lv && lv.hiddenTypes);
    } catch (_) { return new Set(); }
  }

  function loopDevKey(o){const loop=field(o&&o.loop),dev=field(o&&o.dev);return loop&&dev?`${loop}|${dev}`:'';}
  function loopDevText(o){const loop=field(o&&o.loop),dev=field(o&&o.dev);return loop&&dev?`L${loop}.D${dev}`:(dev?`D${dev}`:'identity');}

  function refreshIssues() {
    if (!session) return;
    const dims = currentDims();
    const existing = new Map();
    try {
      (objects || []).filter(o => o && o.kind === 'sym').forEach(o => {
        const k=loopDevKey(o);if(k)existing.set(k,(existing.get(k)||0)+1);
      });
    } catch (_) {}
    const seen = new Map();
    session.candidates.forEach(c => {
      c.issues = issuesFor(c.obj, c.meta);
      const hidden=hiddenTypesNow();
      if (hidden.has(field(c.obj && c.obj.type))) {
        c.issues.push({code:'hidden_type', level:'review', text:`${arcTypeLabel(c.obj.type)} is hidden on this level; unhide this type before commit`});
      }
      if (dims.w && dims.h && Number.isFinite(c.obj.x) && Number.isFinite(c.obj.y) &&
          (c.obj.x < 0 || c.obj.y < 0 || c.obj.x > dims.w || c.obj.y > dims.h)) {
        c.issues.push({code:'outside_plan', level:'error', text:'Position is outside the current plan'});
      }
      const k=loopDevKey(c.obj);
      if(k){
        if(existing.has(k))c.issues.push({code:'existing_identity',level:'error',text:`${loopDevText(c.obj)} already exists in this workspace`});
        if(!seen.has(k))seen.set(k,[]);seen.get(k).push(c);
      }
    });
    seen.forEach(list => {
      if(list.length>1)list.forEach(c=>c.issues.push({code:'duplicate_identity',level:'error',text:`${loopDevText(c.obj)} is already matched to another Smart Plan candidate`}));
    });
  }

  function normalisePayload(data, filename) {
    let det = [];
    let zones = [];
    let schedule = [];
    let source = {name:filename || 'Smart Plan candidate file', kind:'candidate-json'};

    if (data && data.schema === 'arc-smart-plan-candidates-v1') {
      if (data.coordinateSpace !== EXPECTED_COORD_SPACE) {
        throw new Error(`Candidate JSON must declare coordinateSpace: ${EXPECTED_COORD_SPACE}. Smart Plan will not guess coordinate transforms at commit time.`);
      }
      det = data.candidates || data.detections || [];
      zones = data.zones || [];
      schedule = data.schedule || [];
      source = Object.assign(source, clone(data.source || {}));
      source.coordinateSpace = data.coordinateSpace;
    } else if (data && data.app === 'block-plan-marker' && Array.isArray(data.levels)) {
      const lv = data.levels[0] || {};
      let curImage = ''; try { curImage = (typeof imgDataUrl !== 'undefined' && imgDataUrl) || ''; } catch (_) {}
      if (!curImage || !lv.image || lv.image !== curImage) {
        throw new Error('This Arc project does not use the exact background currently open in Workspace. Refusing to guess the coordinate transform.');
      }
      det = (lv.objects || []).filter(o => o && o.kind === 'sym');
      zones = (lv.objects || []).filter(o => o && o.kind === 'zone');
      source.kind = 'arc-project-review-bridge';
      source.levelName = lv.name || 'Level 1';
      source.coordinateSpace = EXPECTED_COORD_SPACE;
    } else if (data && Array.isArray(data.detections)) {
      throw new Error('Raw V2.x neutral detections are not imported directly because their coordinate space may be PDF points. Export/convert them to arc-smart-plan-candidates-v1 with current-workspace-px first.');
    } else {
      throw new Error('Unsupported Smart Plan candidate file. Expected candidates, detections, or an Arc project level.');
    }

    const candidates = det.map(normaliseDetection).filter(c => c.obj && c.obj.kind === 'sym');
    const zoneObjects = zones.map(normaliseZoneCandidate).filter(Boolean);
    return { source, candidates, zones:zoneObjects, schedule:clone(schedule || []), coordinateSpace:EXPECTED_COORD_SPACE };
  }

  function stage(payload) {
    if (!hostReady()) throw new Error('Open a Workspace before starting Smart Plan.');
    let p;
    if (payload && Array.isArray(payload.candidates)) {
      const declared = field(payload.coordinateSpace || (payload.source && payload.source.coordinateSpace));
      if (declared !== EXPECTED_COORD_SPACE) {
        throw new Error(`Programmatic Smart Plan candidates must declare coordinateSpace: ${EXPECTED_COORD_SPACE}.`);
      }
      p = payload;
    } else {
      p = normalisePayload(payload || {}, 'programmatic');
    }
    const source = clone(p.source || {}); source.coordinateSpace = EXPECTED_COORD_SPACE;
    session = {
      version:VERSION,
      createdAt:Date.now(),
      committed:false,
      source,
      candidates:clone(p.candidates || []).map(normaliseDetection),
      zones:clone(p.zones || []).map(normaliseZoneCandidate).filter(Boolean),
      schedule:clone(p.schedule || []).map(normaliseScheduleRow).filter(Boolean),
      scheduleSource:null,
      scheduleReport:null,
      zoneSource:null,
      zoneSamples:[],
      zoneRegions:[],
      zoneAlign:{pairs:[],fit:null,pending:null},
      zoneTool:null,
      zoneStatus:'',
      hostSnapshot:hostSnapshot(),
      ocrReport:null,
      ocrBusy:false,
      ocrStatus:'',
      detectReport:null,
      detectBusy:false,
      detectStatus:'',
      /* PASS 205 [205-A] - set by Cancel, read at every pass / crop boundary. */
      cancelRequested:false,
      progress:null,
      templatePick:null,
      featureCache:Object.create(null)
    };
    refreshIssues();
    render();
    return summary();
  }

  function summary() {
    if (!session) return {active:false};
    refreshIssues();
    let accepted=0, review=0, rejected=0, errors=0, warnings=0, numbered=0;
    session.candidates.forEach(c => {
      if (c.decision === 'accepted') accepted++; else if (c.decision === 'rejected') rejected++; else review++;
      errors += c.issues.filter(x=>x.level==='error').length;
      warnings += c.issues.filter(x=>x.level==='review').length;
      if (field(c.obj.dev)) numbered++;
    });
    const zoneAccepted=session.zones.filter(z=>z.decision==='accepted').length;
    const zoneReview=session.zones.filter(z=>z.decision==='review').length;
    const zoneRejected=session.zones.filter(z=>z.decision==='rejected').length;
    return {active:true,total:session.candidates.length,accepted,review,rejected,errors,warnings,numbered,
      zones:session.zones.length,zoneAccepted,zoneReview,zoneRejected,schedule:session.schedule.length,
      reconciliation:session.scheduleReport ? clone(session.scheduleReport.summary || {}) : null,
      zoneSource:session.zoneSource ? {name:session.zoneSource.name,width:session.zoneSource.width,height:session.zoneSource.height,samples:session.zoneSamples.length,regions:session.zoneRegions.length,pairs:session.zoneAlign.pairs.length,rmse:session.zoneAlign.fit?session.zoneAlign.fit.rmse:null} : null,
      ocr:session.ocrReport ? clone(session.ocrReport.summary || {}) : null,
      detection:session.detectReport ? clone(session.detectReport.summary || {}) : null};
  }

  const SCHEDULE_ALIASES = {
    loop:['loop','loop no','loop number','loop#','slc','slc loop'],
    dev:['dev','device','device addr','device address','address','addr','detector','point','point no','point number'],
    type:['type','device type','type code','type code label','device type code','detector type'],
    zone:['zone','zone no','zone number','cbe','panel zone'],
    label:['label','device label','description','location','device description','point label'],
    level:['level','floor','storey','story']
  };

  function headerKey(v){return field(v).toLowerCase().replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim();}
  function aliasIndex(headers, names){const h=headers.map(headerKey);for(const n of names){const i=h.indexOf(n);if(i>=0)return i;}return -1;}
  function arcScheduleHeaderMap(headers){
    /* Reuse Arc's annual-import vocabulary when it is exposed by the host. The
       normaliser below remains the safety fallback so Smart Plan does not depend
       on one private return shape. */
    try {
      if(typeof annHeaderMap==='function'){
        const m=annHeaderMap(headers);
        if(m && typeof m==='object') return m;
      }
    } catch(_) {}
    return null;
  }
  function mappedIndex(map, key){
    if(!map)return -1;
    const variants=key==='dev'?['dev','pt','detector','point','address']:
      key==='label'?['label','location']:
      key==='zone'?['zone','cbe']:[key];
    for(const k of variants){const v=map[k];if(Number.isInteger(v))return v;if(v&&Number.isInteger(v.index))return v.index;}
    return -1;
  }
  function normaliseScheduleType(v){
    const raw=field(v),k=raw.toLowerCase();if(!raw)return {raw:'',arc:''};
    if(/heat|thermal|fixed temp|ror|rate.of.rise/.test(k))return {raw,arc:'thermal'};
    if(/smoke|photo|ion|optical/.test(k))return {raw,arc:'smoke'};
    if(/manual|mcp|call point/.test(k))return {raw,arc:'mcp'};
    if(/wip|warden.*phone|intercom/.test(k))return {raw,arc:'wip'};
    if(/door.*hold|mag.*hold/.test(k))return {raw,arc:'mdh'};
    return {raw,arc:''};
  }
  function splitSchedulePoint(v){
    const s=field(v);if(!s)return null;let m;
    /* Arc annuals emits annOneDec as "1.45". Also accept the two common
       fire-panel print forms without guessing delimiter-free bare numbers. */
    m=s.match(/^0*([0-9]{1,2})\s*\.\s*0*([0-9]{1,3})$/);
    if(m)return {loop:String(Number(m[1])),dev:String(Number(m[2]))};
    m=s.match(/^L\s*0*([0-9]{1,2})\s*[.\-:]?\s*D\s*0*([0-9]{1,3})$/i);
    if(m)return {loop:String(Number(m[1])),dev:String(Number(m[2]))};
    return null;
  }
  function normaliseScheduleZone(v){
    const s=field(v);if(!s)return '';const m=s.match(/^(?:ZONE\s*|Z\s*)?0*([0-9]{1,5})$/i);
    return m?String(Number(m[1])):s;
  }
  function normaliseScheduleRow(r,i){
    if(!r||typeof r!=='object')return null;
    const pick=(...ks)=>{for(const k of ks){if(r[k]!=null&&field(r[k]))return field(r[k]);}const low={};Object.keys(r).forEach(k=>low[headerKey(k)]=r[k]);for(const k of ks){const v=low[headerKey(k)];if(v!=null&&field(v))return field(v);}return '';};
    let loop=pick('loop','Loop','SLC');
    let dev=pick('dev','device','Device ADDR','addr');
    const point=pick('pt','detector','point','address');
    const combined=splitSchedulePoint(dev)||splitSchedulePoint(point);
    if(combined){if(!loop)loop=combined.loop;dev=combined.dev;}
    else if(!dev&&point)dev=point;
    loop=field(loop).replace(/^L\s*0*/i,'');
    if(/^0*[0-9]+$/.test(loop))loop=String(Number(loop));
    if(/^0*[0-9]+$/.test(dev))dev=String(Number(dev));
    const zone=normaliseScheduleZone(pick('zone','Zone','CBE','panel zone')),label=pick('label','Device Label','description','location'),level=pick('level','floor','storey');
    const t=normaliseScheduleType(pick('type','Type','Type Code Label','device type'));
    if(!loop&&!dev&&!t.raw&&!zone&&!label)return null;
    return {id:field(r.id)||`schedule-${i+1}`,loop,dev,type:t.arc,typeRaw:t.raw,zone,label,level,raw:clone(r)};
  }
  function rowsFromMatrix(matrix){
    if(!Array.isArray(matrix)||!matrix.length)return [];
    const headers=(matrix[0]||[]).map(field);const arcMap=arcScheduleHeaderMap(headers);
    const idx={};Object.keys(SCHEDULE_ALIASES).forEach(k=>{const ai=mappedIndex(arcMap,k);idx[k]=ai>=0?ai:aliasIndex(headers,SCHEDULE_ALIASES[k]);});
    const out=[];for(let r=1;r<matrix.length;r++){
      const row=matrix[r]||[],obj={};Object.keys(idx).forEach(k=>{if(idx[k]>=0)obj[k]=row[idx[k]]});const n=normaliseScheduleRow(obj,out.length);if(n)out.push(n);
    }return out;
  }
  function parseDelimitedFallback(text){
    const src=String(text||'').replace(/^\ufeff/,'');const lines=src.split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return [];
    const delim=lines[0].includes('\t')?'\t':(lines[0].split(';').length>lines[0].split(',').length?';':',');
    const parseLine=line=>{const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===delim&&!q){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;};
    return lines.map(parseLine);
  }
  async function parseScheduleFile(file){
    if(!file)throw new Error('Choose a schedule file first.');const name=field(file.name),ext=(name.split('.').pop()||'').toLowerCase();let rows=[];
    if(ext==='json'){
      const data=JSON.parse(await file.text());const raw=Array.isArray(data)?data:(data.rows||data.devices||data.schedule||[]);rows=raw.map(normaliseScheduleRow).filter(Boolean);
    } else if(ext==='csv'||ext==='tsv'||ext==='txt'){
      const text=await file.text();let parsed=null;
      try { if(typeof annParseDelim==='function') parsed=annParseDelim(text); } catch(_) {}
      if(parsed&&typeof parsed.then==='function')parsed=await parsed;
      if(Array.isArray(parsed)&&parsed.length&&Array.isArray(parsed[0]))rows=rowsFromMatrix(parsed);
      else if(Array.isArray(parsed)&&parsed.length&&typeof parsed[0]==='object')rows=parsed.map(normaliseScheduleRow).filter(Boolean);
      if(!rows.length)rows=rowsFromMatrix(parseDelimitedFallback(text));
    } else if(ext==='xlsx'){
      if(typeof annParseXlsxInput!=='function')throw new Error('This Arc build does not expose its XLSX annuals parser. Export the panel schedule as CSV/TSV for this Smart Plan slice.');
      const buf=await file.arrayBuffer();let parsed=annParseXlsxInput(buf);if(parsed&&typeof parsed.then==='function')parsed=await parsed;
      if(Array.isArray(parsed)&&parsed.length&&Array.isArray(parsed[0]))rows=rowsFromMatrix(parsed);
      else if(Array.isArray(parsed))rows=parsed.map(normaliseScheduleRow).filter(Boolean);
    } else throw new Error('Schedule import supports CSV, TSV, TXT, JSON and Arc-compatible XLSX.');
    if(!rows.length)throw new Error('No schedule devices were recognised. Check the header row or export the panel list as CSV.');
    return {name,rows};
  }

  function scheduleKey(r){return `${field(r.loop)}|${field(r.dev)}`;}
  function candidateIdentity(c){return {loop:field(c.obj.loop),dev:field(c.obj.dev),type:field(c.obj.type),zone:normaliseScheduleZone(c.obj.zone)};}
  function candidateGeometryZone(c){
    const own=(c.meta&&c.meta.zoneSource==='schedule')?'':normaliseScheduleZone(c.obj&&c.obj.zone);
    if(own)return own;
    try {
      if(typeof zoneAt==='function'){
        const z=zoneAt(Number(c.obj.x),Number(c.obj.y));
        if(z&&field(z.zn))return normaliseScheduleZone(z.zn);
      }
    } catch(_) {}
    try {
      const z=zoneFromStaged(Number(c.obj.x),Number(c.obj.y));
      if(z&&field(z.zn))return normaliseScheduleZone(z.zn);
    } catch(_) {}
    return '';
  }
  function unwrapRegisterSymbol(entry){
    if(!entry||typeof entry!=='object')return null;
    const o=entry.o||entry.obj||entry.object||entry.sym||entry.item||entry;
    return o&&o.kind==='sym'?o:null;
  }
  function registeredSymbols(){
    const out=[];
    try {
      if(hostReady()&&typeof allLevelObjects==='function'){
        const rows=allLevelObjects();
        if(Array.isArray(rows))rows.forEach(x=>{const o=unwrapRegisterSymbol(x);if(o)out.push(o);});
        return out;
      }
    } catch(_) {}
    try {
      if(hostReady()){
        (levels||[]).forEach((lv,li)=>{
          const src=(li===Number(curLevel||0))?(objects||[]):((lv&&lv.objects)||[]);
          (src||[]).forEach(o=>{const s=unwrapRegisterSymbol(o);if(s)out.push(s);});
        });
        if(out.length)return out;
      }
    } catch(_) {}
    try {
      const p=(typeof fsSite!=='undefined'&&fsSite&&fsSite.plan)?fsSite.plan:null;
      (p&&p.levels||[]).forEach(lv=>(lv&&lv.objects||[]).forEach(o=>{const s=unwrapRegisterSymbol(o);if(s)out.push(s);}));
    } catch(_) {}
    return out;
  }
  function reconcileSchedule(apply){
    if(!session||!session.schedule.length){session.scheduleReport=null;return null;}
    const rows=session.schedule.map((r,i)=>Object.assign({i},normaliseScheduleRow(r,i))).filter(Boolean);
    const candidates=session.candidates.filter(c=>c.decision!=='rejected');
    if(apply){
      /* Schedule values are derived evidence, never a second hidden asset store.
         Reconciliation can therefore be repeated/replaced without leaving stale
         schedule fields behind. User/OCR values are left intact. */
      candidates.forEach(c=>{
        if(c.meta.loopSource==='schedule'){c.obj.loop='';c.meta.loopSource='';}
        if(c.meta.devSource==='schedule'){c.obj.dev='';c.meta.devSource='';}
        if(c.meta.zoneSource==='schedule'){c.obj.zone='';c.meta.zoneSource='';}
        c.meta.scheduleIssue='';c.meta.scheduleId='';c.meta.scheduleZone='';
      });
    }
    const rowByKey=new Map(),devRows=new Map();rows.forEach(r=>{if(r.loop&&r.dev){const k=scheduleKey(r);if(!rowByKey.has(k))rowByKey.set(k,[]);rowByKey.get(k).push(r);}if(r.dev){if(!devRows.has(r.dev))devRows.set(r.dev,[]);devRows.get(r.dev).push(r);}});
    const usedRows=new Set(),usedCandidates=new Set(),rowOwners=new Map(),matches=[],mismatches=[];
    candidates.forEach((c,ci)=>{
      const id=candidateIdentity(c);if(!id.dev)return;
      let options=[];if(id.loop)options=rowByKey.get(`${id.loop}|${id.dev}`)||[];else{const dr=devRows.get(id.dev)||[];if(dr.length===1)options=dr;}
      if(options.length!==1)return;const r=options[0];if(usedRows.has(r.i))return;
      usedRows.add(r.i);usedCandidates.add(ci);rowOwners.set(r.i,ci);
      const reasons=[];const geomZone=candidateGeometryZone(c);
      if(r.type&&id.type&&r.type!==id.type)reasons.push(`type ${arcTypeLabel(id.type)} ≠ schedule ${arcTypeLabel(r.type)}`);
      if(r.zone&&geomZone&&r.zone!==geomZone)reasons.push(`zone ${geomZone} ≠ schedule ${r.zone}`);
      const item={row:r,candidate:c,candidateIndex:ci,reasons,geometryZone:geomZone};
      if(reasons.length)mismatches.push(item);else matches.push(item);
      if(apply){
        if(!id.loop&&r.loop){c.obj.loop=r.loop;c.meta.loopSource='schedule';}
        if(!field(c.obj.dev)&&r.dev){c.obj.dev=r.dev;c.meta.devSource='schedule';}
        /* Schedule zone is normalized evidence and may fill a blank candidate,
           but it never creates zoneMan. Reconciliation compares it against
           independent geometry first, and commit/zoneAssign keeps geometry authoritative. */
        c.meta.scheduleZone=r.zone||'';
        if(!field(c.obj.zone)&&r.zone){c.obj.zone=r.zone;c.meta.zoneSource='schedule';}
        if(r.type&&!field(c.obj.type)){c.obj.type=r.type;}
        if(reasons.length){c.meta.scheduleIssue=`Schedule ${r.loop?`L${r.loop}.D`:''}${r.dev}: ${reasons.join(' · ')}`;c.decision='review';}
        else c.meta.scheduleIssue='';
        c.meta.scheduleId=r.id;
      }
    });
    const registered=registeredSymbols();
    const registeredKeys=new Set(),registeredDevs=new Set();
    registered.forEach(o=>{const loop=field(o.loop),dev=field(o.dev);if(!dev)return;registeredDevs.add(dev);if(loop)registeredKeys.add(`${loop}|${dev}`);});
    const alreadyInRegister=rows.filter(r=>{
      if(usedRows.has(r.i)||!r.dev)return false;
      if(r.loop&&registeredKeys.has(`${r.loop}|${r.dev}`))return true;
      const dr=devRows.get(r.dev)||[];
      return !r.loop&&dr.length===1&&registeredDevs.has(r.dev);
    });
    const registeredRows=new Set(alreadyInRegister.map(r=>r.i));
    const missingOnPlan=rows.filter(r=>!usedRows.has(r.i)&&!registeredRows.has(r.i));
    const planOnly=candidates.filter((c,ci)=>!usedCandidates.has(ci));
    if(apply){
      planOnly.forEach(c=>{
        const id=candidateIdentity(c);
        let consumed=null;
        if(id.loop&&id.dev){const exact=rowByKey.get(`${id.loop}|${id.dev}`)||[];if(exact.length===1&&usedRows.has(exact[0].i))consumed=exact[0];}
        else if(id.dev){const exact=devRows.get(id.dev)||[];if(exact.length===1&&usedRows.has(exact[0].i))consumed=exact[0];}
        if(consumed){
          const ownerIndex=rowOwners.get(consumed.i),owner=ownerIndex!=null?candidates[ownerIndex]:null;
          const ident=consumed.loop?`L${consumed.loop}.D${consumed.dev}`:`D${consumed.dev}`;
          c.meta.scheduleIssue=`${ident} is already matched to another candidate${owner&&field(owner.id)?` (${field(owner.id)})`:''}.`;
        } else c.meta.scheduleIssue=`PLAN_ONLY: ${id.loop?`L${id.loop}.D`:id.dev?'D':''}${id.dev||'unread'} has no exact schedule row.`;
        c.decision='review';
      });
    }
    const report={summary:{MATCH:matches.length,MISMATCH:mismatches.length,MISSING_ON_PLAN:missingOnPlan.length,ALREADY_IN_REGISTER:alreadyInRegister.length,PLAN_ONLY:planOnly.length,totalSchedule:rows.length,totalPlan:candidates.length},match:matches,mismatch:mismatches,missingOnPlan,alreadyInRegister,planOnly};
    session.scheduleReport=clone(report);if(apply)refreshIssues();return report;
  }
  function reconciliation(){return reconcileSchedule(false);}
  function importScheduleRows(rows,source){
    if(!session||session.committed)throw new Error('Start a Smart Plan candidate session before importing a schedule.');
    if(!hostUnchanged(session.hostSnapshot))throw new Error('The Workspace changed while Smart Plan was open. Analyse again before importing a schedule.');
    const norm=(rows||[]).map(normaliseScheduleRow).filter(Boolean);if(!norm.length)throw new Error('The schedule did not contain any usable device rows.');
    session.schedule=norm;session.scheduleSource=source||'programmatic';const rep=reconcileSchedule(true);render();return clone(rep);
  }
  async function importScheduleFile(file){const parsed=await parseScheduleFile(file);return importScheduleRows(parsed.rows,parsed.name);}

  function pointInPoly(x,y,pts) {
    let inside=false;
    for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
      const a=pts[i], b=pts[j];
      if (((a.y>y)!==(b.y>y)) && (x < (b.x-a.x)*(y-a.y)/((b.y-a.y)||1e-9)+a.x)) inside=!inside;
    }
    return inside;
  }

  function zoneFromStaged(x,y) {
    let best=null,bestA=Infinity;
    session.zones.filter(z=>z.decision==='accepted').forEach(zc => {
      const z=zc.obj; const pts=z.pts||[]; if (pts.length<3 || !pointInPoly(x,y,pts)) return;
      let a=0; for(let i=0,j=pts.length-1;i<pts.length;j=i++) a += pts[j].x*pts[i].y-pts[i].x*pts[j].y;
      a=Math.abs(a/2); if(a<bestA){bestA=a;best=z;}
    });
    return best;
  }


  function circularHueDelta(a,b){
    let d=Math.abs(Number(a)-Number(b))%360;return d>180?360-d:d;
  }
  function rgbToHsv(r,g,b){
    r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;
    if(d){if(mx===r)h=60*(((g-b)/d)%6);else if(mx===g)h=60*(((b-r)/d)+2);else h=60*(((r-g)/d)+4);if(h<0)h+=360;}
    return {h,s:mx?d/mx:0,v:mx};
  }
  function odd(v){v=Math.max(3,Math.round(v));return v%2?v:v+1;}
  function imageDimsFromBytes(buf,type){
    try{
      const u=new Uint8Array(buf),dv=new DataView(buf);type=String(type||'').toLowerCase();
      if((type.includes('png')||(u[0]===137&&u[1]===80&&u[2]===78&&u[3]===71))&&u.length>=24)return {w:dv.getUint32(16),h:dv.getUint32(20)};
      if((type.includes('jpeg')||type.includes('jpg')||(u[0]===255&&u[1]===216))&&u.length>4){
        let i=2;while(i+9<u.length){if(u[i]!==255){i++;continue;}const marker=u[i+1];i+=2;if(marker===216||marker===217)continue;if(i+2>u.length)break;const len=dv.getUint16(i);if(len<2||i+len>u.length)break;
          if((marker>=192&&marker<=195)||(marker>=197&&marker<=199)||(marker>=201&&marker<=203)||(marker>=205&&marker<=207)){return {h:dv.getUint16(i+3),w:dv.getUint16(i+5)};}i+=len;}
      }
    }catch(_){}
    return null;
  }
  async function zoneCanvasFromFile(file){
    const name=field(file&&file.name)||'Zone plan';const ext=(name.split('.').pop()||'').toLowerCase();const buf=await file.arrayBuffer();
    if(ext==='pdf'||(file.type||'').includes('pdf')){
      const pdfjs=(window.pdfjsLib||window.pdfjsLibGlobal);if(!pdfjs||!pdfjs.getDocument)throw new Error('This Arc build does not expose pdf.js to Smart Plan. Export the zone plan page as JPG/PNG for this review slice.');
      const doc=await pdfjs.getDocument({data:buf}).promise;const page=await doc.getPage(1);const v1=page.getViewport({scale:1});const sc=Math.min(1,Math.sqrt(ZONE_SOURCE_MAX_PX/(v1.width*v1.height)));const vp=page.getViewport({scale:sc});
      const cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(vp.width));cv.height=Math.max(1,Math.round(vp.height));await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
      return {name,width:cv.width,height:cv.height,originalWidth:v1.width,originalHeight:v1.height,scale:sc,canvas:cv,kind:'pdf'};
    }
    let dims=imageDimsFromBytes(buf,file.type||ext),rw=null,rh=null;
    if(dims&&dims.w&&dims.h){const sc=Math.min(1,Math.sqrt(ZONE_SOURCE_MAX_PX/(dims.w*dims.h)));rw=Math.max(1,Math.round(dims.w*sc));rh=Math.max(1,Math.round(dims.h*sc));}
    let bm=null;
    if(typeof createImageBitmap==='function'){
      try{bm=rw&&rh?await createImageBitmap(file,{resizeWidth:rw,resizeHeight:rh,resizeQuality:'high'}):await createImageBitmap(file);}catch(_){}
    }
    if(!bm){
      const url=URL.createObjectURL(file);try{const im=await new Promise((res,rej)=>{const x=new Image();x.onload=()=>res(x);x.onerror=()=>rej(new Error('Could not decode zone-plan image'));x.src=url;});dims=dims||{w:im.naturalWidth,h:im.naturalHeight};const sc=Math.min(1,Math.sqrt(ZONE_SOURCE_MAX_PX/(dims.w*dims.h)));rw=Math.max(1,Math.round(dims.w*sc));rh=Math.max(1,Math.round(dims.h*sc));const cv=document.createElement('canvas');cv.width=rw;cv.height=rh;cv.getContext('2d').drawImage(im,0,0,rw,rh);return {name,width:rw,height:rh,originalWidth:dims.w,originalHeight:dims.h,scale:sc,canvas:cv,kind:'image'};}finally{URL.revokeObjectURL(url);}
    }
    dims=dims||{w:bm.width,h:bm.height};rw=rw||bm.width;rh=rh||bm.height;const cv=document.createElement('canvas');cv.width=rw;cv.height=rh;cv.getContext('2d').drawImage(bm,0,0,rw,rh);try{bm.close&&bm.close()}catch(_){}const sc=dims.w?rw/dims.w:1;
    return {name,width:rw,height:rh,originalWidth:dims.w,originalHeight:dims.h,scale:sc,canvas:cv,kind:'image'};
  }
  async function importZoneSourceFile(file){
    if(!session||session.committed)throw new Error('Start a Smart Plan session before adding a zone plan.');if(!hostUnchanged(session.hostSnapshot))throw new Error('The Workspace changed while Smart Plan was open. Analyse again before adding a zone plan.');
    const z=await zoneCanvasFromFile(file);session.zoneSource=z;session.zoneSamples=[];session.zoneRegions=[];session.zoneAlign={pairs:[],fit:null,pending:null};session.zoneTool=null;session.zoneStatus=`Zone source loaded: ${z.name} (${z.width}×${z.height} working px)`;
    session.zones=session.zones.filter(x=>x.source!=='zone-plan-transfer');if(session.schedule.length)reconcileSchedule(true);render();return {name:z.name,width:z.width,height:z.height,originalWidth:z.originalWidth,originalHeight:z.originalHeight,scale:z.scale};
  }
  function teachZoneHatch(zone,bbox,options){
    if(!session||!session.zoneSource)throw new Error('Load a separate zone plan first.');zone=normaliseScheduleZone(zone);if(!zone)throw new Error('Enter the zone number before teaching hatch.');options=options||{};
    const cv=session.zoneSource.canvas,w=cv.width,h=cv.height;let [x,y,bw,bh]=(bbox||[]).map(Number);x=Math.max(0,Math.floor(x));y=Math.max(0,Math.floor(y));bw=Math.min(w-x,Math.ceil(bw));bh=Math.min(h-y,Math.ceil(bh));if(!(bw>=4&&bh>=4))throw new Error('Draw a larger hatch sample box.');
    const d=cv.getContext('2d',{willReadFrequently:true}).getImageData(x,y,bw,bh).data;let sx=0,sy=0,ss=0,sv=0,n=0;const hues=[];
    for(let i=0;i<d.length;i+=4){const q=rgbToHsv(d[i],d[i+1],d[i+2]);if(q.s<0.08||q.v<0.12||q.v>0.98)continue;const wt=Math.max(.1,q.s);sx+=Math.cos(q.h*Math.PI/180)*wt;sy+=Math.sin(q.h*Math.PI/180)*wt;ss+=q.s;sv+=q.v;n++;hues.push(q.h);}
    if(n<20)throw new Error('Not enough coloured hatch ink in that sample. Draw a box across several hatch strokes.');let hue=Math.atan2(sy,sx)*180/Math.PI;if(hue<0)hue+=360;const dev=hues.map(v=>circularHueDelta(v,hue)).sort((a,b)=>a-b),spread=dev[Math.min(dev.length-1,Math.floor(dev.length*.85))]||0;
    const scale=session.zoneSource.scale||1;const win=odd(options.window||Math.max(9,ZONE_BASE_WINDOW_ORIGINAL_PX*scale));const thr=Number(options.threshold),ink=n/(bw*bh),autoThr=clamp(ink/ZONE_DENSITY_AUTO_DIVISOR,ZONE_DENSITY_AUTO_MIN,ZONE_DENSITY_AUTO_MAX),manualThr=Number.isFinite(thr)&&thr>0;
    const sample={id:`zone-sample-${zone}`,zone,hue,sat:ss/n,val:sv/n,spread,window:win,threshold:manualThr?thr:autoThr,thresholdAuto:!manualThr,bbox:[x,y,bw,bh],ink};
    session.zoneSamples=session.zoneSamples.filter(s=>s.zone!==zone);session.zoneSamples.push(sample);session.zoneRegions=[];session.zoneStatus=`Taught Zone ${zone} hatch: hue ${hue.toFixed(1)}°, window ${win}px, density ${sample.threshold.toFixed(3)}${sample.thresholdAuto?' auto':''}.`;render();return clone(sample);
  }
  function rdp(points,eps){
    if(points.length<3)return points.slice();let max=0,idx=0;const a=points[0],b=points[points.length-1],dx=b.x-a.x,dy=b.y-a.y,den=Math.hypot(dx,dy)||1;
    for(let i=1;i<points.length-1;i++){const p=points[i],d=Math.abs(dy*p.x-dx*p.y+b.x*a.y-b.y*a.x)/den;if(d>max){max=d;idx=i;}}
    if(max>eps){const l=rdp(points.slice(0,idx+1),eps),r=rdp(points.slice(idx),eps);return l.slice(0,-1).concat(r);}return [a,b];
  }
  function polyArea(pts){let a=0;for(let i=0,j=pts.length-1;i<pts.length;j=i++)a+=pts[j].x*pts[i].y-pts[i].x*pts[j].y;return Math.abs(a/2);}
  function simplifyClosed(pts,eps){
    if(pts.length<5)return pts.slice();let far=1,fd=-1;for(let i=1;i<pts.length;i++){const dx=pts[i].x-pts[0].x,dy=pts[i].y-pts[0].y,d=dx*dx+dy*dy;if(d>fd){fd=d;far=i;}}
    const a=rdp(pts.slice(0,far+1),eps),b=rdp(pts.slice(far).concat([pts[0]]),eps),out=a.slice(0,-1).concat(b.slice(0,-1));return out.length>=3?out:pts.slice();
  }
  function morphologyOpen(mask,w,h){
    const er=new Uint8Array(mask.length),out=new Uint8Array(mask.length);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let ok=1;for(let yy=-1;yy<=1&&ok;yy++)for(let xx=-1;xx<=1;xx++)if(!mask[(y+yy)*w+x+xx]){ok=0;break;}if(ok)er[y*w+x]=1;}
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let on=0;for(let yy=-1;yy<=1&&!on;yy++)for(let xx=-1;xx<=1;xx++)if(er[(y+yy)*w+x+xx]){on=1;break;}if(on)out[y*w+x]=1;}return out;
  }
  function componentLoops(mask,w,h,stride,minCells){
    const seen=new Uint8Array(mask.length),regions=[];const qx=[],qy=[];const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    for(let sy=0;sy<h;sy++)for(let sx=0;sx<w;sx++){const si=sy*w+sx;if(!mask[si]||seen[si])continue;let head=0;qx.length=0;qy.length=0;qx.push(sx);qy.push(sy);seen[si]=1;const cells=[];
      while(head<qx.length){const x=qx[head],y=qy[head++];cells.push([x,y]);for(const [dx,dy] of dirs){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(mask[ni]&&!seen[ni]){seen[ni]=1;qx.push(nx);qy.push(ny);}}}
      if(cells.length<minCells)continue;const set=new Set(cells.map(([x,y])=>`${x},${y}`)),edges=[];const add=(ax,ay,bx,by)=>edges.push([[ax,ay],[bx,by]]);
      for(const [x,y] of cells){if(!set.has(`${x},${y-1}`))add(x,y,x+1,y);if(!set.has(`${x+1},${y}`))add(x+1,y,x+1,y+1);if(!set.has(`${x},${y+1}`))add(x+1,y+1,x,y+1);if(!set.has(`${x-1},${y}`))add(x,y+1,x,y);}
      const byStart=new Map();edges.forEach((e,i)=>{const k=e[0].join(',');if(!byStart.has(k))byStart.set(k,[]);byStart.get(k).push(i)});const used=new Uint8Array(edges.length),loops=[];
      for(let ei=0;ei<edges.length;ei++){if(used[ei])continue;const loop=[];let cur=ei,guard=0;while(cur!=null&&!used[cur]&&guard++<edges.length+5){used[cur]=1;const e=edges[cur];loop.push({x:e[0][0]*stride,y:e[0][1]*stride});const k=e[1].join(','),nexts=(byStart.get(k)||[]).filter(i=>!used[i]);cur=nexts.length?nexts[0]:null;if(k===edges[ei][0].join(','))break;}if(loop.length>=4)loops.push(loop);}
      if(!loops.length)continue;loops.sort((a,b)=>polyArea(b)-polyArea(a));let pts=simplifyClosed(loops[0],Math.max(2,stride*1.5));if(pts.length>=3)regions.push({pts,cells:cells.length,area:polyArea(pts)});
    }return regions;
  }
  function detectZoneSourceRegions(){
    if(!session||!session.zoneSource)throw new Error('Load a separate zone plan first.');
    if(!session.zoneSamples.length)throw new Error('Teach at least one coloured hatch sample first.');
    const cv=session.zoneSource.canvas,w=cv.width,h=cv.height,ctx=cv.getContext('2d',{willReadFrequently:true}),data=ctx.getImageData(0,0,w,h).data,n=w*h,assign=new Uint8Array(n),samples=session.zoneSamples;

    /* First stage: every coloured source pixel belongs to at most one taught
       hatch sample. This is the fine-grain colour competition from V1.5. */
    for(let i=0,p=0;i<data.length;i+=4,p++){
      const q=rgbToHsv(data[i],data[i+1],data[i+2]);
      if(q.s<0.055||q.v<0.10||q.v>0.985)continue;
      let best=-1,bestScore=Infinity;
      for(let si=0;si<samples.length;si++){
        const sm=samples[si],tol=Math.max(4,Math.min(18,4+sm.spread*2.2)),dh=circularHueDelta(q.h,sm.hue);
        if(dh>Math.max(7,tol*1.6))continue;
        const score=dh/tol+Math.abs(q.s-sm.sat)/0.55;
        if(score<bestScore){bestScore=score;best=si;}
      }
      if(best>=0&&bestScore<=1.7)assign[p]=best+1;
    }

    /* Second stage: local-density competition happens ONCE for the whole
       source sheet. V1.5 thresholded each sample independently, so the density
       windows re-created overlaps after pixel competition. Here each coarse
       cell is owned only by the sample with the strongest eligible density. */
    const integrals=samples.map((sm,si)=>{
      const integral=new Uint32Array((w+1)*(h+1));
      for(let y=0;y<h;y++){
        let row=0;const yo=y*w,io=(y+1)*(w+1),ip=y*(w+1);
        for(let x=0;x<w;x++){if(assign[yo+x]===si+1)row++;integral[io+x+1]=integral[ip+x+1]+row;}
      }
      return integral;
    });
    const stride=Math.max(2,Math.round(Math.min(w,h)/850)),gw=Math.ceil(w/stride),gh=Math.ceil(h/stride),cells=gw*gh;
    const owners=new Uint8Array(cells),densityMaps=samples.map(()=>new Float32Array(cells));
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
      const ci=gy*gw+gx,x=Math.min(w-1,gx*stride+Math.floor(stride/2)),y=Math.min(h-1,gy*stride+Math.floor(stride/2));
      let best=-1,bestDensity=-1;
      for(let si=0;si<samples.length;si++){
        const sm=samples[si],rad=Math.floor(odd(sm.window)/2),x0=Math.max(0,x-rad),x1=Math.min(w-1,x+rad),y0=Math.max(0,y-rad),y1=Math.min(h-1,y+rad),integral=integrals[si];
        const sum=integral[(y1+1)*(w+1)+x1+1]-integral[y0*(w+1)+x1+1]-integral[(y1+1)*(w+1)+x0]+integral[y0*(w+1)+x0],dens=sum/((x1-x0+1)*(y1-y0+1));
        densityMaps[si][ci]=dens;
        if(dens>=sm.threshold && dens>bestDensity){bestDensity=dens;best=si;}
      }
      if(best>=0)owners[ci]=best+1;
    }

    const openedMasks=samples.map((sm,si)=>{
      const raw=new Uint8Array(cells);for(let i=0;i<cells;i++)if(owners[i]===si+1)raw[i]=1;
      return morphologyOpen(raw,gw,gh);
    });

    /* Opening can expand a boundary by a cell. Re-resolve any such cell using
       the already-measured local densities so kept hatch regions remain
       mutually exclusive at source. */
    const finalOwners=new Uint8Array(cells);
    for(let ci=0;ci<cells;ci++){
      let best=-1,bestDensity=-1;
      for(let si=0;si<samples.length;si++)if(openedMasks[si][ci]){
        const d=densityMaps[si][ci];if(d>bestDensity){bestDensity=d;best=si;}
      }
      if(best>=0)finalOwners[ci]=best+1;
    }

    const out=[],minCells=Math.max(25,Math.floor(gw*gh*.0008));
    samples.forEach((sm,si)=>{
      const mask=new Uint8Array(cells);for(let i=0;i<cells;i++)if(finalOwners[i]===si+1)mask[i]=1;
      const regs=componentLoops(mask,gw,gh,stride,minCells);regs.sort((a,b)=>b.area-a.area);
      regs.slice(0,8).forEach((r,ri)=>out.push({id:`zone-src-${sm.zone}-${ri+1}`,zone:sm.zone,pts:r.pts,decision:'review',source:'hatch',area:r.area,sampleId:sm.id,densityThreshold:sm.threshold}));
    });
    session.zoneRegions=out;
    session.zoneStatus=`Found ${out.length} source zone region candidate(s) with region-level density competition. Keep only the true zone regions before transfer.`;
    render();return clone(out);
  }

  function polyBounds(pts){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    (pts||[]).forEach(p=>{if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y;});
    return {minX,minY,maxX,maxY,w:Math.max(0,maxX-minX),h:Math.max(0,maxY-minY)};
  }
  function estimatePolyOverlap(a,b){
    if(!a||!b||a.length<3||b.length<3)return {area:0,fraction:0};
    const A=polyBounds(a),B=polyBounds(b),minX=Math.max(A.minX,B.minX),minY=Math.max(A.minY,B.minY),maxX=Math.min(A.maxX,B.maxX),maxY=Math.min(A.maxY,B.maxY);
    if(!(maxX>minX&&maxY>minY))return {area:0,fraction:0};
    const boxArea=(maxX-minX)*(maxY-minY),target=6400,step=Math.max(1,Math.sqrt(boxArea/target));let both=0,total=0;
    for(let y=minY+step/2;y<maxY;y+=step)for(let x=minX+step/2;x<maxX;x+=step){total++;if(pointInPoly(x,y,a)&&pointInPoly(x,y,b))both++;}
    const area=total?boxArea*both/total:0,den=Math.max(1,Math.min(polyArea(a),polyArea(b)));
    return {area,fraction:area/den};
  }
  function sourceRegionOverlapWarnings(){
    const kept=(session&&session.zoneRegions||[]).filter(r=>r.decision==='accepted'),map=new Map();
    for(let i=0;i<kept.length;i++)for(let j=i+1;j<kept.length;j++){
      const ov=estimatePolyOverlap(kept[i].pts,kept[j].pts);
      if(ov.fraction<=ZONE_OVERLAP_WARN_FRACTION)continue;
      const pct=Math.round(ov.fraction*100),a=kept[i],b=kept[j];
      if(!map.has(a.id))map.set(a.id,[]);if(!map.has(b.id))map.set(b.id,[]);
      map.get(a.id).push(`overlaps kept Zone ${b.zone} ~${pct}%`);
      map.get(b.id).push(`overlaps kept Zone ${a.zone} ~${pct}%`);
    }
    return map;
  }

  function addManualZoneRegion(zone,pts){
    if(!session||!session.zoneSource)throw new Error('Load a separate zone plan first.');zone=normaliseScheduleZone(zone);const clean=(pts||[]).map(p=>({x:Number(p.x),y:Number(p.y)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(!zone||clean.length<3)throw new Error('A manual zone polygon needs a zone number and at least three points.');const r={id:`zone-manual-${zone}-${Date.now()}`,zone,pts:clean,decision:'review',source:'manual',area:polyArea(clean)};session.zoneRegions.push(r);render();return clone(r);
  }
  function fitZoneAlignment(pairs){
    pairs=pairs||[];if(pairs.length<ZONE_ALIGN_MIN_POINTS)return null;let sx=0,sy=0,tx=0,ty=0;pairs.forEach(p=>{sx+=p.source.x;sy+=p.source.y;tx+=p.target.x;ty+=p.target.y});sx/=pairs.length;sy/=pairs.length;tx/=pairs.length;ty/=pairs.length;let a=0,b=0,den=0;pairs.forEach(p=>{const x=p.source.x-sx,y=p.source.y-sy,u=p.target.x-tx,v=p.target.y-ty;a+=x*u+y*v;b+=x*v-y*u;den+=x*x+y*y});if(den<1e-9)return null;const A=a/den,B=b/den,scale=Math.hypot(A,B),rot=Math.atan2(B,A)*180/Math.PI,dx=tx-(A*sx-B*sy),dy=ty-(B*sx+A*sy);const transform=p=>({x:A*p.x-B*p.y+dx,y:B*p.x+A*p.y+dy});const residuals=pairs.map(p=>{const q=transform(p.source);return Math.hypot(q.x-p.target.x,q.y-p.target.y)}),rmse=Math.sqrt(residuals.reduce((z,v)=>z+v*v,0)/residuals.length);return {A,B,scale,rotationDeg:rot,dx,dy,rmse,residuals,transform};
  }
  function zoneAlignThreshold(){const widths=session.candidates.map(c=>c.meta&&Array.isArray(c.meta.bbox)?Number(c.meta.bbox[2]):NaN).filter(Number.isFinite).sort((a,b)=>a-b);const med=widths.length?widths[Math.floor(widths.length/2)]:ZONE_ALIGN_DEFAULT_SYMBOL_PX;return Math.max(30,med*1.25);}
  function updateZoneAlignment(){if(!session)return null;const f=fitZoneAlignment(session.zoneAlign.pairs);session.zoneAlign.fit=f?{A:f.A,B:f.B,scale:f.scale,rotationDeg:f.rotationDeg,dx:f.dx,dy:f.dy,rmse:f.rmse,residuals:f.residuals,threshold:zoneAlignThreshold()}:null;return session.zoneAlign.fit;}
  function addZoneAlignmentPair(source,target){if(!session||!session.zoneSource)throw new Error('Load a separate zone plan first.');const p={source:{x:Number(source.x),y:Number(source.y)},target:{x:Number(target.x),y:Number(target.y)}};if(!Number.isFinite(p.source.x)||!Number.isFinite(p.source.y)||!Number.isFinite(p.target.x)||!Number.isFinite(p.target.y))throw new Error('Alignment points must be numeric.');session.zoneAlign.pairs.push(p);updateZoneAlignment();render();return clone(session.zoneAlign.fit);}
  function clipPolygonRect(pts,minX,minY,maxX,maxY){
    let out=(pts||[]).map(p=>({x:Number(p.x),y:Number(p.y)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    const clip=(inside,intersect)=>{
      const input=out;out=[];if(!input.length)return;
      let S=input[input.length-1];
      for(const E of input){
        const Ein=inside(E),Sin=inside(S);
        if(Ein){if(!Sin)out.push(intersect(S,E));out.push(E);}
        else if(Sin)out.push(intersect(S,E));
        S=E;
      }
    };
    const ix=(x,S,E)=>{const dx=E.x-S.x,t=Math.abs(dx)<1e-9?0:(x-S.x)/dx;return {x,y:S.y+(E.y-S.y)*t};};
    const iy=(y,S,E)=>{const dy=E.y-S.y,t=Math.abs(dy)<1e-9?0:(y-S.y)/dy;return {x:S.x+(E.x-S.x)*t,y};};
    clip(p=>p.x>=minX,(S,E)=>ix(minX,S,E));clip(p=>p.x<=maxX,(S,E)=>ix(maxX,S,E));
    clip(p=>p.y>=minY,(S,E)=>iy(minY,S,E));clip(p=>p.y<=maxY,(S,E)=>iy(maxY,S,E));
    return out;
  }

  function transferZoneRegions(){
    if(!session||!session.zoneSource)throw new Error('Load a separate zone plan first.');
    const kept=session.zoneRegions.filter(r=>r.decision==='accepted');if(!kept.length)throw new Error('Accept at least one source zone region before transfer.');
    const f=fitZoneAlignment(session.zoneAlign.pairs);if(!f)throw new Error('Pick at least three matched alignment points.');
    const threshold=zoneAlignThreshold();if(f.rmse>threshold)throw new Error(`Alignment RMSE ${f.rmse.toFixed(1)} px exceeds the ${threshold.toFixed(1)} px safety gate. Re-pick the worst point.`);
    const dims=currentDims(),zones=[],skipped=[];let clippedCount=0,mostlyOutside=0;
    kept.forEach((r,i)=>{
      const rawPts=r.pts.map(f.transform),rawArea=Math.max(1,polyArea(rawPts));
      const clipped=(dims.w&&dims.h)?clipPolygonRect(rawPts,0,0,dims.w,dims.h):rawPts;
      const clippedArea=clipped.length>=3?polyArea(clipped):0,outsideFraction=clamp(1-(clippedArea/rawArea),0,1);
      if(clipped.length<3||clippedArea<4){skipped.push({zone:r.zone,id:r.id,outsideFraction:1,reason:'no visible Workspace intersection'});return;}
      const clippedAny=outsideFraction>0.001;if(clippedAny)clippedCount++;if(outsideFraction>ZONE_MOSTLY_OUTSIDE_FRACTION)mostlyOutside++;
      const z=normaliseZoneCandidate({id:`zone-transfer-${r.zone}-${i+1}`,obj:{kind:'zone',zn:r.zone,pts:clipped},decision:'review',source:'zone-plan-transfer'},i);
      z.clipped=clippedAny;z.outsideFraction=outsideFraction;
      if(outsideFraction>ZONE_MOSTLY_OUTSIDE_FRACTION)z.transferWarning=`${Math.round(outsideFraction*100)}% of this source region lies outside the cropped Workspace; only the visible portion was transferred.`;
      else if(clippedAny)z.transferWarning=`Clipped ${Math.round(outsideFraction*100)}% outside the Workspace boundary.`;
      zones.push(z);
    });
    if(!zones.length)throw new Error('None of the kept zone regions intersects the Workspace. Check the alignment points or source-region selection.');
    session.zones=session.zones.filter(z=>z.source!=='zone-plan-transfer').concat(zones);
    session.zoneAlign.fit=Object.assign({},updateZoneAlignment()||{}, {threshold});
    const extra=[clippedCount?`${clippedCount} clipped to Workspace`:null,mostlyOutside?`${mostlyOutside} mostly outside (review flagged)`:null,skipped.length?`${skipped.length} not visible and skipped`:null].filter(Boolean).join(' · ');
    session.zoneStatus=`Transferred ${zones.length} zone region(s) into Smart Plan Review${extra?` • ${extra}`:''}. Accept/reject them before Commit.`;
    if(session.schedule.length)reconcileSchedule(true);else refreshIssues();render();
    return {zones:zones.length,skipped:skipped.length,clipped:clippedCount,mostlyOutside,rmse:f.rmse,threshold,skippedRegions:skipped};
  }

  function commit() {
    if (!session || session.committed) throw new Error('There is no uncommitted Smart Plan session.');
    if (!hostUnchanged(session.hostSnapshot)) {
      const switched = hostReady() && Number(curLevel || 0) !== session.hostSnapshot.level;
      throw new Error(switched ? 'The Workspace level changed while Smart Plan was open. Close Smart Plan and analyse again before committing.' : 'The Workspace changed while Smart Plan was open. Close Smart Plan and analyse again before committing.');
    }
    refreshIssues();
    const accepted=session.candidates.filter(c=>c.decision==='accepted');
    const blockers=accepted.filter(c=>c.issues.some(x=>x.level==='error'));
    if(blockers.length) throw new Error(`${blockers.length} accepted candidate(s) still have blocking errors. Resolve them or reject them first.`);
    if(!accepted.length) throw new Error('No accepted devices to commit.');
    const pendingZones=session.zones.filter(z=>z.decision==='review');
    if(pendingZones.length) throw new Error(`${pendingZones.length} zone region(s) still need Accept or Reject before commit.`);
    const hidden=hiddenTypesNow();
    const hiddenLabels=[...new Set(accepted.filter(c=>hidden.has(field(c.obj.type))).map(c=>arcTypeLabel(c.obj.type)))];
    if(hiddenLabels.length) throw new Error(`Cannot commit while these device types are hidden on this level: ${hiddenLabels.join(', ')}. Unhide them first so the result cannot disappear silently.`);

    if (typeof pushUndo === 'function') pushUndo();
    let mutated=false;
    const addedZones=[];
    const added=[];
    try {
      session.zones.filter(z=>z.decision==='accepted').forEach(zc=>{
        const z=clone(zc.obj); objects.push(z); addedZones.push(z); mutated=true;
      });

      accepted.forEach(c=>{
        /* Re-birth once more at the boundary. A caller cannot mutate a staged
           object into a partial Arc symbol after stage() and before commit(). */
        const o=birthSymbol(c.obj);
        const zs=c.meta && c.meta.zoneSource;
        let geomZone='';
        try { if (typeof zoneAt === 'function') { const gz=zoneAt(o.x,o.y); if(gz) geomZone=field(gz.zn); } } catch (_) {}
        if (!geomZone) { const stagedZ=zoneFromStaged(o.x,o.y); geomZone=stagedZ ? field(stagedZ.zn) : ''; }
        if (zs==='user' && field(o.zone) && geomZone && normaliseScheduleZone(o.zone)!==normaliseScheduleZone(geomZone)) o.zoneMan=true;
        else delete o.zoneMan;
        objects.push(o); added.push(o); mutated=true;
      });

      if (typeof zoneAssign === 'function') zoneAssign(added);
      if (typeof syncLevel === 'function') syncLevel();
      if (typeof draw === 'function') draw();
      if (typeof scheduleAutosave === 'function') scheduleAutosave();
    } catch (err) {
      if (mutated && typeof undo === 'function') {
        try {
          undo();
          /* The failed partial mutation must not remain reachable through Redo. */
          try { if (typeof redoStack !== 'undefined' && Array.isArray(redoStack)) redoStack = []; } catch (_) {}
          if (typeof syncLevel === 'function') syncLevel();
          if (typeof draw === 'function') draw();
        } catch (rollbackErr) { console.error('[Smart Plan] rollback failed', rollbackErr); }
      }
      throw err;
    }

    session.committed=true;
    const result={devices:added.length,zones:addedZones.length};
    if (typeof autosaveNow === 'function') {
      Promise.resolve(autosaveNow(true)).catch(e=>console.error('[Smart Plan] autosave failed',e));
    }
    render();
    return result;
  }

  function discard() {
    session=null;
    const m=document.getElementById(MODAL_ID); if(m) m.style.display='none';
  }


  function start(options) {
    options=options||{};
    return stage({
      coordinateSpace:EXPECTED_COORD_SPACE,
      source:{kind:'native-workspace',coordinateSpace:EXPECTED_COORD_SPACE,name:field(options.name)||'Current Workspace'},
      candidates:[],zones:[],schedule:clone(options.schedule||[]).map(normaliseScheduleRow).filter(Boolean),scheduleSource:null,scheduleReport:null
    });
  }

  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  function rgbaIsRed(r,g,b) {
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
    if(mx<35 || (mx ? d/mx : 0) < (45/255)) return false;
    let h=0;
    if(d){
      if(mx===r) h=60*(((g-b)/d)%6);
      else if(mx===g) h=60*(((b-r)/d)+2);
      else h=60*(((r-g)/d)+4);
      if(h<0)h+=360;
    }
    return h<=30 || h>=330;
  }

  function rgbaIsInk(r,g,b) {
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    const lum=0.2126*r+0.7152*g+0.0722*b;
    /* A deliberately broad raster fallback: dark/grey CAD ink or strongly
       chromatic coloured ink. Auto mode prefers the cleaner red signal when a
       taught sample contains it. */
    return lum<185 || (mx-mn)>70;
  }

  function makeFeature(signal) {
    if(!session)throw new Error('Start Smart Plan before building a detector feature.');
    const live=livePlanImage();if(!live)throw new Error('No decoded Workspace plan is available for detection.');
    const iw=live.naturalWidth||live.width,ih=live.naturalHeight||live.height;
    if(!iw||!ih)throw new Error('The Workspace plan has no usable pixel dimensions.');
    const key=`${signal}:${iw}x${ih}`;
    if(session.featureCache[key])return session.featureCache[key];
    const workScale=Math.min(1,Math.sqrt(DETECT_WORK_MAX_PX/(iw*ih)));
    const w=Math.max(1,Math.round(iw*workScale)),h=Math.max(1,Math.round(ih*workScale));
    if(w*h>Math.min(maxCanvasPx(),DETECT_WORK_MAX_PX)+w+h)throw new Error('Smart Plan detection working canvas exceeds Arc/iPad canvas safety limit.');
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;
    try{ctx.imageSmoothingQuality='high'}catch(_){}
    ctx.drawImage(live,0,0,iw,ih,0,0,w,h);
    const data=ctx.getImageData(0,0,w,h).data;
    const mask=new Uint8Array(w*h);
    const lum=new Uint8Array(w*h);
    for(let i=0,j=0;i<data.length;i+=4,j++)lum[j]=(0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2])|0;
    if(signal==='red'){for(let i=0,j=0;i<data.length;i+=4,j++)mask[j]=rgbaIsRed(data[i],data[i+1],data[i+2])?1:0;}
    else{
      /* [209-G1] INK IS DARK AGAINST ITS OWN SURROUNDINGS. A zone fill (yellow,
         blue, green hatch) is light, but a fixed cut-off called it ink and the
         mask became a solid block. Local mean over a window ~3 symbol widths. */
      const st=w+1,I=new Float64Array((w+1)*(h+1));
      for(let y=0;y<h;y++){let row=0;const o=(y+1)*st,pv=y*st,b=y*w;for(let x=0;x<w;x++){row+=lum[b+x];I[o+x+1]=I[pv+x+1]+row;}}
      const R=INK_LOCAL_RADIUS;
      for(let y=0;y<h;y++){const y0=Math.max(0,y-R),y1=Math.min(h,y+R+1);
        for(let x=0;x<w;x++){const x0=Math.max(0,x-R),x1=Math.min(w,x+R+1);
          const mean=(I[y1*st+x1]-I[y0*st+x1]-I[y1*st+x0]+I[y0*st+x0])/((y1-y0)*(x1-x0));
          const l=lum[y*w+x];mask[y*w+x]=(l<INK_ABS_MAX&&l<mean-INK_LOCAL_DROP)?1:0;}}
    }
    /* One inexpensive speck clean. It is intentionally weaker than Python's
       OpenCV opening so thin legitimate detector strokes survive on photos. */
    if(signal==='red'&&w>2&&h>2){
      const clean=new Uint8Array(mask.length);
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const k=y*w+x;if(!mask[k])continue;let n=0;
        for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)if(mask[(y+yy)*w+x+xx])n++;
        if(n>=2)clean[k]=1;
      }
      mask.set(clean);
    }
    const stride=w+1,integral=new Uint32Array((w+1)*(h+1));
    for(let y=0;y<h;y++){
      let row=0;const out=(y+1)*stride,prev=y*stride,base=y*w;
      for(let x=0;x<w;x++){row+=mask[base+x];integral[out+x+1]=integral[prev+x+1]+row;}
    }
    /* Drop the RGBA canvas immediately; detection retains only 1 byte/pixel +
       summed-area table, not a second full-resolution plan bitmap. */
    cv.width=1;cv.height=1;
    const out={signal,w,h,iw,ih,scaleX:w/iw,scaleY:h/ih,mask,lum,integral,stride,workPixels:w*h};
    session.featureCache[key]=out;return out;
  }

  function rectSum(f,x,y,w,h){
    x=clamp(Math.floor(x),0,f.w);y=clamp(Math.floor(y),0,f.h);const x1=clamp(Math.ceil(x+w),0,f.w),y1=clamp(Math.ceil(y+h),0,f.h),s=f.stride,I=f.integral;
    return I[y1*s+x1]-I[y*s+x1]-I[y1*s+x]+I[y*s+x];
  }

  function workBBox(f,bbox){
    if(!Array.isArray(bbox)||bbox.length<4)throw new Error('Template bbox must be [x, y, width, height] in current Workspace pixels.');
    let [x,y,w,h]=bbox.map(Number);if(![x,y,w,h].every(Number.isFinite)||w<6||h<6)throw new Error('Draw a tighter template rectangle around one complete symbol.');
    x=clamp(x,0,f.iw-1);y=clamp(y,0,f.ih-1);w=clamp(w,1,f.iw-x);h=clamp(h,1,f.ih-y);
    const x0=Math.floor(x*f.scaleX),y0=Math.floor(y*f.scaleY),x1=Math.ceil((x+w)*f.scaleX),y1=Math.ceil((y+h)*f.scaleY);
    return {x:x0,y:y0,w:Math.max(3,x1-x0),h:Math.max(3,y1-y0),original:[x,y,w,h]};
  }

  function cropMask(f,b){
    const out=new Uint8Array(b.w*b.h);let ink=0;
    for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++){const v=f.mask[(b.y+y)*f.w+b.x+x];out[y*b.w+x]=v;ink+=v;}
    return {mask:out,w:b.w,h:b.h,ink};
  }

  function scaleMask(src,scale){
    const w=Math.max(3,Math.round(src.w*scale)),h=Math.max(3,Math.round(src.h*scale)),out=new Uint8Array(w*h);let ink=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(src.w-1,Math.floor((x+.5)*src.w/w)),sy=Math.min(src.h-1,Math.floor((y+.5)*src.h/h)),v=src.mask[sy*src.w+sx];out[y*w+x]=v;ink+=v;}
    return {mask:out,w,h,ink};
  }

  function transformMask(src,rotation,mirror){
    rotation=((Number(rotation)||0)%360+360)%360;
    const swap=rotation===90||rotation===270,w=swap?src.h:src.w,h=swap?src.w:src.h,out=new Uint8Array(w*h);let ink=0;
    for(let sy=0;sy<src.h;sy++)for(let sx=0;sx<src.w;sx++){
      if(!src.mask[sy*src.w+sx])continue;let x=mirror?(src.w-1-sx):sx,y=sy,dx,dy;
      if(rotation===90){dx=src.h-1-y;dy=x;}else if(rotation===180){dx=src.w-1-x;dy=src.h-1-y;}else if(rotation===270){dx=y;dy=src.w-1-x;}else{dx=x;dy=y;}
      out[dy*w+dx]=1;ink++;
    }
    const fg=[];for(let i=0;i<out.length;i++)if(out[i])fg.push([i%w,Math.floor(i/w)]);
    return {mask:out,w,h,ink,fg,rotation,mirrored:!!mirror};
  }

  function binaryDiceAt(f,t,x,y){
    const winInk=rectSum(f,x,y,t.w,t.h);if(!winInk||!t.ink)return 0;
    const ratio=winInk/t.ink;if(ratio<0.42||ratio>2.25)return 0;
    let overlap=0;const M=f.mask,W=f.w;
    for(let i=0;i<t.fg.length;i++){const p=t.fg[i];if(M[(y+p[1])*W+x+p[0]])overlap++;}
    return (2*overlap)/(t.ink+winInk);
  }

  function contourStats(f,x,y,w,h){
    x=Math.round(x);y=Math.round(y);w=Math.max(3,Math.round(w));h=Math.max(3,Math.round(h));
    const band=Math.max(1,Math.round(Math.min(w,h)*0.18));
    const M=f.mask,W=f.w;const cov=[0,0,0,0];
    let hits=0;
    for(let xx=0;xx<w;xx++){
      let top=false,bot=false;
      for(let b=0;b<band;b++){if(y+b>=0&&y+b<f.h&&x+xx>=0&&x+xx<f.w&&M[(y+b)*W+x+xx])top=true;if(y+h-1-b>=0&&y+h-1-b<f.h&&x+xx>=0&&x+xx<f.w&&M[(y+h-1-b)*W+x+xx])bot=true;}
      if(top)cov[0]++;if(bot)cov[1]++;
    }
    for(let yy=0;yy<h;yy++){
      let left=false,right=false;
      for(let b=0;b<band;b++){if(x+b>=0&&x+b<f.w&&y+yy>=0&&y+yy<f.h&&M[(y+yy)*W+x+b])left=true;if(x+w-1-b>=0&&x+w-1-b<f.w&&y+yy>=0&&y+yy<f.h&&M[(y+yy)*W+x+w-1-b])right=true;}
      if(left)cov[2]++;if(right)cov[3]++;
    }
    cov[0]/=w;cov[1]/=w;cov[2]/=h;cov[3]/=h;
    const sides=cov.filter(v=>v>=0.24).length,score=(cov[0]+cov[1]+cov[2]+cov[3])/4;
    return {coverage:cov,sides,score};
  }


  function closedContourStats(f,x,y,w,h) {
    x=Math.round(x);y=Math.round(y);w=Math.max(3,Math.round(w));h=Math.max(3,Math.round(h));
    const local=new Uint8Array(w*h),M=f.mask,W=f.w;
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const gx=x+xx,gy=y+yy;if(gx>=0&&gx<f.w&&gy>=0&&gy<f.h&&M[gy*W+gx])local[yy*w+xx]=1;
    }
    /* Close JPEG pinholes conservatively by one-pixel dilation. A genuine
       detector square encloses background; an open leader stub does not. */
    const wall=new Uint8Array(local.length),rad=Math.max(1,Math.min(3,Math.round(Math.min(w,h)*0.055)));
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      let on=false;for(let dy=-rad;dy<=rad&&!on;dy++)for(let dx=-rad;dx<=rad;dx++){const nx=xx+dx,ny=yy+dy;if(nx>=0&&nx<w&&ny>=0&&ny<h&&local[ny*w+nx]){on=true;break;}}
      if(on)wall[yy*w+xx]=1;
    }
    const seen=new Uint8Array(local.length),q=new Int32Array(local.length);let head=0,tail=0;
    const push=(xx,yy)=>{const k=yy*w+xx;if(!wall[k]&&!seen[k]){seen[k]=1;q[tail++]=k;}};
    for(let xx=0;xx<w;xx++){push(xx,0);push(xx,h-1);}for(let yy=1;yy<h-1;yy++){push(0,yy);push(w-1,yy);}
    while(head<tail){const k=q[head++],xx=k%w,yy=Math.floor(k/w);if(xx>0)push(xx-1,yy);if(xx+1<w)push(xx+1,yy);if(yy>0)push(xx,yy-1);if(yy+1<h)push(xx,yy+1);}
    let enclosed=0;for(let k=0;k<wall.length;k++)if(!wall[k]&&!seen[k])enclosed++;
    return {enclosed,enclosedRatio:enclosed/Math.max(1,w*h)};
  }

  function iouBox(a,b){const x0=Math.max(a.x,b.x),y0=Math.max(a.y,b.y),x1=Math.min(a.x+a.w,b.x+b.w),y1=Math.min(a.y+a.h,b.y+b.h),inter=Math.max(0,x1-x0)*Math.max(0,y1-y0),u=a.w*a.h+b.w*b.h-inter;return u>0?inter/u:0;}

  /* [209-G2] INTERIOR LOOK-ALIKE GATE. At 15 px a square-with-squiggle (smoke)
     and a square-with-dot (thermal) share the same outline and the same ink
     count, so binary overlap cannot tell them apart. The grey interior can:
     normalised cross-correlation of the inner part of the box (the outline
     trimmed off) against the taught symbol, best of the 8 rotations/mirrors,
     plus the interior ink ratio (a solid flag is not a dot). */
  function lumPatch(f,x,y,w,h,ow,oh){
    const out=new Float32Array(ow*oh);
    for(let j=0;j<oh;j++){const sy=clamp(Math.round(y+(j+0.5)*h/oh-0.5),0,f.h-1);
      for(let i=0;i<ow;i++){const sx=clamp(Math.round(x+(i+0.5)*w/ow-0.5),0,f.w-1);out[j*ow+i]=f.lum[sy*f.w+sx];}}
    return out;
  }
  function nccOf(a,b){let ma=0,mb=0;const n=a.length;for(let i=0;i<n;i++){ma+=a[i];mb+=b[i];}ma/=n;mb/=n;let sab=0,saa=0,sbb=0;for(let i=0;i<n;i++){const da=a[i]-ma,db=b[i]-mb;sab+=da*db;saa+=da*da;sbb+=db*db;}const d=Math.sqrt(saa*sbb);return d>1e-6?sab/d:0;}
  function patchVariants(p,w,h){
    const out=[];const get=(i,j)=>p[j*w+i];
    for(const mirror of [false,true])for(const rot of [0,1,2,3]){
      const rw=(rot%2)?h:w,rh=(rot%2)?w:h,q=new Float32Array(w*h);
      for(let j=0;j<rh;j++)for(let i=0;i<rw;i++){let u=i,v=j;if(rot===1){u=j;v=rh-1-i;}else if(rot===2){u=rw-1-i;v=rh-1-j;}else if(rot===3){u=rw-1-j;v=i;}
        if(mirror)u=w-1-u;q[j*rw+i]=get(clamp(u,0,w-1),clamp(v,0,h-1));}
      out.push({p:q,w:rw,h:rh});
    }
    return out;
  }
  function interiorNcc(f,tplVariants,d){
    let best=-1;
    for(const t of tplVariants){
      const mx=Math.round(t.w*DETECT_INTERIOR_TRIM),my=Math.round(t.h*DETECT_INTERIOR_TRIM),iw=t.w-2*mx,ih=t.h-2*my;if(iw<3||ih<3)continue;
      const inner=new Float32Array(iw*ih);for(let j=0;j<ih;j++)for(let i=0;i<iw;i++)inner[j*iw+i]=t.p[(j+my)*t.w+i+mx];
      const cand=lumPatch(f,d.x+d.w*DETECT_INTERIOR_TRIM,d.y+d.h*DETECT_INTERIOR_TRIM,d.w*(1-2*DETECT_INTERIOR_TRIM),d.h*(1-2*DETECT_INTERIOR_TRIM),iw,ih);
      const v=nccOf(inner,cand);if(v>best)best=v;
    }
    return best;
  }
  function nmsDetections(list,templateRefW,templateRefH){
    const keep=[];const ref=Math.min(templateRefW,templateRefH)*DETECT_NMS_CENTRE_FACTOR;
    list.slice().sort((a,b)=>b.score-a.score).forEach(c=>{
      const cx=c.x+c.w/2,cy=c.y+c.h/2;
      if(keep.some(k=>iouBox(c,k)>=DETECT_NMS_IOU||Math.hypot(cx-(k.x+k.w/2),cy-(k.y+k.h/2))<ref))return;
      keep.push(c);
    });return keep;
  }

  /* PASS 211 [211-A] - THE BOX SNAPS TO THE SYMBOL. A drawn box that also
     encloses the printed number makes a template with the number baked in and
     puts every reading strip past the label (his Merriwa run: 74 found, 2
     reads). The longest ink run per column / per row finds the square's sides:
     digits are ~half a symbol tall, a wire crossing the box is 1-2 px the
     other way, and a wire ATTACHED to the symbol does not widen anything. */
  const TIGHTEN_MARGIN_PX = 1, TIGHTEN_MIN_SIDE = 6, TIGHTEN_RUN_FRACTION = 0.6, TIGHTEN_RUN_MAX = 2.2;
  const SNAP_MIN_SIDE = 6, SNAP_SIDE_FILL = 0.8, SNAP_BAND_MAX = 0.6, SNAP_INTERIOR_MAX = 0.45, SNAP_MIN_ASPECT = 0.5, SNAP_MAX_LINES = 120, SNAP_MAX_AREA = 90000, SNAP_UPSCALE_BELOW = 28;
  /* PASS 213 [213-A] - FIND THE SQUARE, NOT THE TALLEST INK. On Merriwa the
     bold printed number is nearly as tall as the symbol, so the Pass 211 run
     rule (tightenByRuns, now the last resort) took the digits for sides and
     kept the number in the box. A detector symbol is a CLOSED OUTLINE: a left
     and a right column that are ink along the same top and bottom rows, and
     those two rows ink across the two columns. Digits, letters and wires never
     close a rectangle of that size; the biggest closed rectangle in the box is
     the symbol. Each side has to be 80% ink (a JPEG-broken 1 px line still
     counts; a wire attached to a side just makes it longer), the band just
     INSIDE each side has to be mostly empty (an outline is hollow behind its
     line; a bold digit is solid behind its edge), and the interior is at most
     45% ink (an S or a dot, not a number).
     The pixels come from the PLAN ITSELF at full size (x2 for a small symbol),
     not the 0.84x detection frame the rest of the finder works on - at that
     scale a 1 px side goes grey and gappy and the square fell apart. */
  function findClosedRect(mask,W,H,inner,k){
    k=k||1;
    const n=(W+1)*(H+1),st=W+1,I=new Int32Array(n),IV=new Int32Array(n),IH=new Int32Array(n);
    /* three summed-area tables: the mask; the mask OR the pixel below (so a
       horizontal line counts once per column however thick it is); the mask
       OR the pixel to the right (a vertical line, once per row) */
    for(let y=0;y<H;y++){let row=0,rv=0,rh=0;const o=(y+1)*st,pv=y*st,b=y*W;
      for(let x=0;x<W;x++){const m=mask[b+x];row+=m;rv+=(m||(y+1<H&&mask[b+W+x]))?1:0;rh+=(m||(x+1<W&&mask[b+x+1]))?1:0;
        I[o+x+1]=I[pv+x+1]+row;IV[o+x+1]=IV[pv+x+1]+rv;IH[o+x+1]=IH[pv+x+1]+rh;}}
    const S=(T,x0,y0,x1,y1)=>T[y1*st+x1]-T[y0*st+x1]-T[y1*st+x0]+T[y0*st+x0];   /* half-open */
    const sum=(x0,y0,x1,y1)=>S(I,x0,y0,x1,y1);
    const colInk=new Int32Array(W),rowInk=new Int32Array(H);
    for(let x=0;x<W;x++)colInk[x]=sum(x,0,x+1,H);for(let y=0;y<H;y++)rowInk[y]=sum(0,y,W,y+1);
    const cx=[],ry=[];for(let x=0;x<W;x++)if(colInk[x]>=SNAP_MIN_SIDE)cx.push(x);for(let y=0;y<H;y++)if(rowInk[y]>=SNAP_MIN_SIDE)ry.push(y);
    if(cx.length>SNAP_MAX_LINES||ry.length>SNAP_MAX_LINES||cx.length<2||ry.length<2)return null;
    /* a side is a line at that row/column (2 px tolerance), ink on >= 80% of its length */
    const vside=(x,T,B)=>S(IH,x,T,x+1,B+1)/(B-T+1)>=SNAP_SIDE_FILL;
    const hside=(y,L,R)=>S(IV,L,y,R+1,y+1)/(R-L+1)>=SNAP_SIDE_FILL;
    /* the hollow band: the k px line 3k px inside each side must be mostly empty */
    const bandV=(x,T,B)=>{const a=Math.max(0,Math.min(W-1,x)),b=Math.max(0,Math.min(W,x+k));return b>a?sum(a,T,b,B+1)/((B-T+1)*(b-a))<=SNAP_BAND_MAX:true;};
    const bandH=(y,L,R)=>{const a=Math.max(0,Math.min(H-1,y)),b=Math.max(0,Math.min(H,y+k));return b>a?sum(L,a,R+1,b)/((R-L+1)*(b-a))<=SNAP_BAND_MAX:true;};
    const hollow=(L,R,T,B)=>{const i=3*k;if(R-L<3*i||B-T<3*i)return false;return bandH(T+i,L+i,R-i)&&bandH(B-i-k+1,L+i,R-i)&&bandV(L+i,T+i,B-i)&&bandV(R-i-k+1,T+i,B-i)&&sum(L+i,T+i,R-i+1,B-i+1)/((R-L+1-2*i)*(B-T+1-2*i))<=SNAP_INTERIOR_MAX;};
    let best=null,bestArea=0;
    for(let i=0;i<cx.length;i++)for(let j=cx.length-1;j>i;j--){
      const L=cx[i],R=cx[j],w=R-L+1;if(w<SNAP_MIN_SIDE)break;
      if(inner&&((L+R)/2<inner.x||(L+R)/2>inner.x+inner.w))continue;
      for(let a=0;a<ry.length;a++)for(let b=ry.length-1;b>a;b--){
        const T=ry[a],B=ry[b],h=B-T+1;if(h<SNAP_MIN_SIDE)break;
        const area=w*h;if(area<=bestArea)break;
        const ar=w/h;if(ar<SNAP_MIN_ASPECT||ar>1/SNAP_MIN_ASPECT)continue;
        if(inner&&((T+B)/2<inner.y||(T+B)/2>inner.y+inner.h))continue;
        if(!hside(T,L,R)||!hside(B,L,R))continue;
        if(!vside(L,T,B)||!vside(R,T,B))continue;
        if(!hollow(L,R,T,B))continue;
        best={L,R,T,B};bestArea=area;
      }
    }
    return best;
  }
  function liveCropMask(bbox,signal){
    const live=livePlanImage();if(!live)return null;
    const iw=live.naturalWidth||live.width,ih=live.naturalHeight||live.height;if(!iw||!ih)return null;
    const x=bbox[0],y=bbox[1],w=bbox[2],h=bbox[3];if(!(w>=4&&h>=4))return null;
    const pad=Math.max(3,Math.round(Math.min(w,h)*0.2));
    const x0=Math.max(0,Math.floor(x-pad)),y0=Math.max(0,Math.floor(y-pad)),x1=Math.min(iw,Math.ceil(x+w+pad)),y1=Math.min(ih,Math.ceil(y+h+pad));
    const cw=x1-x0,ch=y1-y0;if(cw<6||ch<6)return null;
    const k=Math.min(w,h)<SNAP_UPSCALE_BELOW?2:1,W=cw*k,H=ch*k;if(W*H>SNAP_MAX_AREA)return null;
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
    try{ctx.drawImage(live,x0,y0,cw,ch,0,0,W,H);}catch(_){return null;}
    let data;try{data=ctx.getImageData(0,0,W,H).data;}catch(_){return null;}
    const mask=new Uint8Array(W*H);
    if(signal==='red'){for(let i=0,j=0;i<data.length;i+=4,j++)mask[j]=rgbaIsRed(data[i],data[i+1],data[i+2])?1:0;}
    else{
      const lum=new Uint8Array(W*H);for(let i=0,j=0;i<data.length;i+=4,j++)lum[j]=(0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2])|0;
      const st=W+1,I=new Float64Array((W+1)*(H+1));
      for(let yy=0;yy<H;yy++){let row=0;const o=(yy+1)*st,pv=yy*st,b=yy*W;for(let xx=0;xx<W;xx++){row+=lum[b+xx];I[o+xx+1]=I[pv+xx+1]+row;}}
      const R=Math.max(4,Math.round(INK_LOCAL_RADIUS*k));
      for(let yy=0;yy<H;yy++){const ya=Math.max(0,yy-R),yb=Math.min(H,yy+R+1);
        for(let xx=0;xx<W;xx++){const xa=Math.max(0,xx-R),xb=Math.min(W,xx+R+1);
          const mean=(I[yb*st+xb]-I[ya*st+xb]-I[yb*st+xa]+I[ya*st+xa])/((yb-ya)*(xb-xa));
          const l=lum[yy*W+xx];mask[yy*W+xx]=(l<INK_ABS_MAX&&l<mean-INK_LOCAL_DROP)?1:0;}}
    }
    cv.width=1;cv.height=1;
    return {mask,w:W,h:H,x0,y0,k,inner:{x:(x-x0)*k,y:(y-y0)*k,w:w*k,h:h*k}};
  }
  function tightenWorkBox(f,wb){
    const W=wb.w,H=wb.h;if(W<4||H<4)return null;
    /* 1 - the plan's own pixels, full size */
    let lv=null;try{lv=wb.original?liveCropMask(wb.original,f.signal):null;}catch(_){lv=null;}
    if(lv){
      const r=findClosedRect(lv.mask,lv.w,lv.h,lv.inner,lv.k);
      if(r){
        const m=TIGHTEN_MARGIN_PX,ix=lv.x0+(r.L-m)/lv.k,iy=lv.y0+(r.T-m)/lv.k,iw=(r.R-r.L+1+2*m)/lv.k,ih=(r.B-r.T+1+2*m)/lv.k;
        const o=wb.original;
        if(!(iw>=o[2]-1&&ih>=o[3]-1)){   /* not already tight */
          const x0=Math.floor(ix*f.scaleX),y0=Math.floor(iy*f.scaleY),x1=Math.ceil((ix+iw)*f.scaleX),y1=Math.ceil((iy+ih)*f.scaleY);
          return {x:x0,y:y0,w:Math.max(3,x1-x0),h:Math.max(3,y1-y0),closed:true,img:[ix,iy,iw,ih]};
        }
        return null;
      }
    }
    /* 2 - the same search on the detection frame */
    if(W*H<=SNAP_MAX_AREA){
      const mask=new Uint8Array(W*H);
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)mask[y*W+x]=f.mask[(wb.y+y)*f.w+wb.x+x];
      const r=findClosedRect(mask,W,H,null,1);
      if(r){
        const x0=Math.max(0,r.L-TIGHTEN_MARGIN_PX),y0=Math.max(0,r.T-TIGHTEN_MARGIN_PX),x1=Math.min(W-1,r.R+TIGHTEN_MARGIN_PX),y1=Math.min(H-1,r.B+TIGHTEN_MARGIN_PX);
        const nw=x1-x0+1,nh=y1-y0+1;
        if(nw>=W-1&&nh>=H-1)return null;   /* already tight */
        return {x:wb.x+x0,y:wb.y+y0,w:nw,h:nh,closed:true};
      }
    }
    /* 3 - the Pass 211 run rule (circles, triangles) */
    return tightenByRuns(f,wb);
  }
  function tightenByRuns(f,wb){
    const W=wb.w,H=wb.h;if(W<4||H<4)return null;
    /* PASS 211 rule, kept as the fallback for symbols that are not closed
       rectangles (circles, triangles): longest ink RUN per column / per row */
    const colRun=new Int32Array(W),rowRun=new Int32Array(H);
    for(let x=0;x<W;x++){let run=0,best=0;for(let y=0;y<H;y++){if(f.mask[(wb.y+y)*f.w+wb.x+x]){run++;if(run>best)best=run;}else run=0;}colRun[x]=best;}
    for(let y=0;y<H;y++){let run=0,best=0;for(let x=0;x<W;x++){if(f.mask[(wb.y+y)*f.w+wb.x+x]){run++;if(run>best)best=run;}else run=0;}rowRun[y]=best;}
    let M=0,N=0;for(let x=0;x<W;x++)if(colRun[x]>M)M=colRun[x];for(let y=0;y<H;y++)if(rowRun[y]>N)N=rowRun[y];
    const S=Math.min(M,N);if(S<TIGHTEN_MIN_SIDE)return null;
    const lo=TIGHTEN_RUN_FRACTION*S,hi=TIGHTEN_RUN_MAX*S;
    let x0=-1,x1=-1,y0=-1,y1=-1;
    for(let x=0;x<W;x++)if(colRun[x]>=lo&&colRun[x]<=hi){if(x0<0)x0=x;x1=x;}
    for(let y=0;y<H;y++)if(rowRun[y]>=lo&&rowRun[y]<=hi){if(y0<0)y0=y;y1=y;}
    if(x0<0||y0<0)return null;
    x0=Math.max(0,x0-TIGHTEN_MARGIN_PX);y0=Math.max(0,y0-TIGHTEN_MARGIN_PX);x1=Math.min(W-1,x1+TIGHTEN_MARGIN_PX);y1=Math.min(H-1,y1+TIGHTEN_MARGIN_PX);
    const nw=x1-x0+1,nh=y1-y0+1;
    if(nw<TIGHTEN_MIN_SIDE||nh<TIGHTEN_MIN_SIDE)return null;
    if(nw>3*S||nh>3*S)return null;   /* not a symbol-shaped outline - leave his box alone */
    if(nw>=W-1&&nh>=H-1)return null;   /* already tight */
    return {x:wb.x+x0,y:wb.y+y0,w:nw,h:nh,closed:false};
  }
  function tightenTemplateBox(bbox,signal){
    if(!session)throw new Error('Start Smart Plan first.');
    signal=field(signal||'auto').toLowerCase();if(!['auto','red','ink'].includes(signal))signal='auto';
    if(signal==='auto')signal=autoSignalForBBox(bbox);
    const f=makeFeature(signal),wb=workBBox(f,bbox),t=tightenWorkBox(f,wb);
    if(!t)return {bbox:wb.original.slice(),tightened:false};
    const out=t.img?t.img.slice():[t.x/f.scaleX,t.y/f.scaleY,t.w/f.scaleX,t.h/f.scaleY];   /* [213-A] full-size coords when the snap saw the plan itself */
    return {bbox:out,tightened:true};
  }
  function autoSignalForBBox(bbox){
    const red=makeFeature('red'),b=workBBox(red,bbox),area=Math.max(1,b.w*b.h),ink=rectSum(red,b.x,b.y,b.w,b.h);
    /* A true coloured detector sample generally contains much more red than a
       random architecture crop. Keep this intentionally permissive. */
    return ink>=Math.max(8,area*0.025)?'red':'ink';
  }

  /* PASS 205 [205-A] - CANCEL. A long operation (OCR is ~2 min on a desktop,
     3-5 min on an iPad) must be stoppable without reloading Arc. The flag is
     read at the next pass / crop boundary; the operation throws a marked error
     that its own catch turns into "nothing happened". */
  function spCancelled(){const e=new Error('Smart Plan operation cancelled.');e.spCancelled=true;return e;}
  function spThrowIfCancelled(){if(session&&session.cancelRequested)throw spCancelled();}
  function cancelActiveOperation(){
    if(!session||!(session.detectBusy||session.ocrBusy))return false;
    session.cancelRequested=true;
    if(session.detectBusy)session.detectStatus='Cancelling\u2026';
    if(session.ocrBusy)session.ocrStatus='Cancelling\u2026';
    render();return true;
  }

  async function detectTemplate(options) {
    options=options||{};
    if(!session||session.committed)throw new Error('Start Smart Plan before teaching a template.');
    if(!hostUnchanged(session.hostSnapshot))throw new Error('The Workspace changed while Smart Plan was open. Analyse again before detection.');
    if(session.detectBusy)throw new Error('Smart Plan template detection is already running.');
    const type=field(options.type);if(!type||!arcTypeKnown(type))throw new Error('Choose a valid Arc device type before teaching a template.');
    const bbox=options.bbox;let signal=field(options.signal||'auto').toLowerCase();if(!['auto','red','ink'].includes(signal))signal='auto';
    if(signal==='auto')signal=autoSignalForBBox(bbox);
    const threshold=clamp(Number(options.threshold)||DETECT_DEFAULT_THRESHOLD,0.35,0.95),includeMirrors=options.includeMirrors===true;
    session.detectBusy=true;session.detectStatus='Preparing local template detector…';render();
    const started=performance.now?performance.now():Date.now();
    try{
      const f=makeFeature(signal);let wb=workBBox(f,bbox);{const tt=tightenWorkBox(f,wb);if(tt){const o=[tt.x/f.scaleX,tt.y/f.scaleY,tt.w/f.scaleX,tt.h/f.scaleY];wb={x:tt.x,y:tt.y,w:tt.w,h:tt.h,original:o,tightened:true};}}  /* [211-A] */
      const base=cropMask(f,wb);
      if(base.ink<8)throw new Error(`The taught rectangle contains too little ${signal==='red'?'red ':' '}symbol ink. Draw tightly around one complete symbol.`);
      const taught=contourStats(f,wb.x,wb.y,wb.w,wb.h),taughtHole=closedContourStats(f,wb.x,wb.y,wb.w,wb.h),taughtClosed=taught.sides>=3||taughtHole.enclosedRatio>=0.035;
      const raw=[];const mirrors=includeMirrors?[false,true]:[false];
      let pass=0,totalPass=DETECT_SCALES.length*DETECT_ROTATIONS.length*mirrors.length;
      for(const scale of DETECT_SCALES){
        const scaled=scaleMask(base,scale);
        for(const mirror of mirrors)for(const rotation of DETECT_ROTATIONS){
          pass++;spThrowIfCancelled();session.detectStatus=`Detecting symbols \u2014 pass ${pass} / ${totalPass}`;session.progress={done:pass-1,total:totalPass,phase:0,phases:1};spTick();
          const t=transformMask(scaled,rotation,mirror);if(t.ink<6||t.w>=f.w||t.h>=f.h)continue;
          const stride=Math.max(2,Math.round(Math.min(t.w,t.h)/10));
          const seeds=[];const coarseGate=Math.max(0.34,threshold-0.14);
          for(let y=0;y<=f.h-t.h;y+=stride){
            for(let x=0;x<=f.w-t.w;x+=stride){
              const win=rectSum(f,x,y,t.w,t.h),ratio=win/t.ink;if(ratio<0.45||ratio>2.15)continue;
              /* Fast sparse precheck before the complete overlap count. */
              let sample=0,match=0;const step=Math.max(1,Math.floor(t.fg.length/18));
              for(let q=0;q<t.fg.length;q+=step){const p=t.fg[q];sample++;if(f.mask[(y+p[1])*f.w+x+p[0]])match++;}
              if(sample&&match/sample<Math.max(0.28,coarseGate-0.18))continue;
              const sc=binaryDiceAt(f,t,x,y);if(sc>=coarseGate)seeds.push({x,y,score:sc});
            }
          }
          seeds.sort((a,b)=>b.score-a.score);const local=[];
          for(const seed of seeds.slice(0,Math.max(80,DETECT_MAX_RESULTS))){
            let best=seed;
            for(let yy=Math.max(0,seed.y-stride);yy<=Math.min(f.h-t.h,seed.y+stride);yy++)for(let xx=Math.max(0,seed.x-stride);xx<=Math.min(f.w-t.w,seed.x+stride);xx++){
              const sc=binaryDiceAt(f,t,xx,yy);if(sc>best.score)best={x:xx,y:yy,score:sc};
            }
            if(best.score<threshold)continue;
            if(local.some(k=>Math.hypot((k.x+k.w/2)-(best.x+t.w/2),(k.y+k.h/2)-(best.y+t.h/2))<Math.max(2,Math.min(t.w,t.h)*0.22)))continue;
            local.push({x:best.x,y:best.y,w:t.w,h:t.h,score:best.score,rotation,mirrored:mirror,scale});
          }
          raw.push(...local);
          await new Promise(r=>setTimeout(r,0));
        }
      }
      /* [209-G2] the inside of every survivor is checked against the taught inside */
      const tplVariants=patchVariants(lumPatch(f,wb.x,wb.y,wb.w,wb.h,wb.w,wb.h),wb.w,wb.h);
      const tplInnerInk=Math.max(1,rectSum(f,wb.x+wb.w*DETECT_INTERIOR_TRIM,wb.y+wb.h*DETECT_INTERIOR_TRIM,wb.w*(1-2*DETECT_INTERIOR_TRIM),wb.h*(1-2*DETECT_INTERIOR_TRIM)));
      const dedup=nmsDetections(raw,base.w,base.h).map(d=>{d.interior=interiorNcc(f,tplVariants,d);d.interiorInk=rectSum(f,d.x+d.w*DETECT_INTERIOR_TRIM,d.y+d.h*DETECT_INTERIOR_TRIM,d.w*(1-2*DETECT_INTERIOR_TRIM),d.h*(1-2*DETECT_INTERIOR_TRIM))/tplInnerInk;return d;})
        .filter(d=>d.interiorInk>=DETECT_INTERIOR_INK_MIN&&d.interiorInk<=DETECT_INTERIOR_INK_MAX&&(d.interior>=DETECT_INTERIOR_NCC_SURE||(d.interior>=DETECT_INTERIOR_NCC_MIN&&d.interiorInk<=DETECT_INTERIOR_INK_LIKE))).slice(0,DETECT_MAX_RESULTS);
      const runId=`template-${Date.now().toString(36)}`;const created=[];
      for(let i=0;i<dedup.length;i++){
        const d=dedup[i],cs=contourStats(f,d.x,d.y,d.w,d.h),hole=closedContourStats(f,d.x,d.y,d.w,d.h);
        const ratios=cs.coverage.map((v,j)=>v/Math.max(0.08,taught.coverage[j]||0.08));
        const comparableSides=ratios.filter(v=>v>=0.42).length;
        /* High-specificity flag only: the taught symbol has a real enclosed
           contour, while this match has effectively none. Do not penalise weak
           real symbols just because a photographed side is faint. */
        const suspect=taughtClosed&&d.score>=0.55&&comparableSides<=1&&hole.enclosedRatio<0.01;
        const sx=f.iw/f.w,sy=f.ih/f.h;
        const box=[d.x*sx,d.y*sy,d.w*sx,d.h*sy],cx=box[0]+box[2]/2,cy=box[1]+box[3]/2;
        const c=normaliseDetection({id:`${runId}-${i+1}`,obj:{kind:'sym',type,x:cx,y:cy,zone:'',loop:'',dev:'',info:''},meta:{source:'template',confidence:d.score,requiresDeviceNumber:true,suspectStub:suspect,detectorRun:runId,detectorSignal:signal,bbox:box,rotation:d.rotation,mirrored:d.mirrored,scale:d.scale,closedContourScore:cs.score,closedContourSides:comparableSides,interiorNcc:d.interior,interiorInk:d.interiorInk}},i);
        created.push(c);
      }
      if(options.replaceType!==false)session.candidates=session.candidates.filter(c=>!(c.meta&&c.meta.source==='template'&&field(c.obj.type)===type));
      session.candidates.push(...created);refreshIssues();
      const elapsed=Math.round((performance.now?performance.now():Date.now())-started);
      session.detectReport={summary:{type,signal,threshold,raw:raw.length,kept:created.length,stubFlags:created.filter(c=>c.meta.suspectStub).length,nmsCentreFactor:DETECT_NMS_CENTRE_FACTOR,workPixels:f.workPixels,workScale:Math.min(f.scaleX,f.scaleY),elapsedMs:elapsed,taughtClosed,taughtContourScore:taught.score,taughtHoleRatio:taughtHole.enclosedRatio},bbox:clone(wb.original),tightened:!!wb.tightened,detections:created.map(c=>({id:c.id,x:c.obj.x,y:c.obj.y,score:c.meta.confidence,stub:!!c.meta.suspectStub,closedContourScore:c.meta.closedContourScore,closedContourSides:c.meta.closedContourSides,box:clone(c.meta.bbox)})),finishedAt:Date.now()};
      session.detectStatus='';return clone(session.detectReport);
    } catch(e){
      /* [205-A] a cancelled detection adds NOTHING: candidates are only pushed after the last pass. */
      if(e&&e.spCancelled){session.detectStatus='';return null;}
      throw e;
    } finally {session.detectBusy=false;session.cancelRequested=false;session.progress=null;render();}
  }

  function loadSameOriginScript(src) {
    return new Promise((resolve,reject)=>{
      const prior=[...document.scripts].find(s=>s.src && new URL(s.src,location.href).href===new URL(src,location.href).href);
      if(prior){ if(window.Tesseract) return resolve(); prior.addEventListener('load',()=>resolve(),{once:true}); prior.addEventListener('error',()=>reject(new Error(`Could not load ${src}`)),{once:true}); return; }
      const s=document.createElement('script'); s.src=src; s.defer=true;
      s.onload=()=>resolve(); s.onerror=()=>reject(new Error(`Could not load ${src}`)); document.head.appendChild(s);
    });
  }

  async function ensureOcrWorker() {
    if (ocrWorkerPromise) return ocrWorkerPromise;
    ocrWorkerPromise=(async()=>{
      const onProg=m=>{
        if(session && session.ocrBusy && m && m.status) session.ocrStatus=`${m.status}${Number.isFinite(m.progress)?` ${Math.round(m.progress*100)}%`:''}`;
      };

      /* In Arc, reuse the app's memoised OCR worker. That preserves Arc's
         75-second startup deadline, gzip setting and single-WASM memory budget. */
      if (typeof fsOcrWorker === 'function') {
        const worker = await fsOcrWorker(onProg);
        if(!worker || typeof worker.recognize !== 'function') throw new Error('Arc OCR worker is unavailable.');
        return worker;
      }

      /* Standalone/test fallback only. Production Arc exposes fsOcrWorker(). */
      if(!window.Tesseract || typeof window.Tesseract.createWorker!=='function') await loadSameOriginScript(OCR_SCRIPT);
      if(!window.Tesseract || typeof window.Tesseract.createWorker!=='function') throw new Error('Arc OCR engine did not load.');
      const options={workerPath:OCR_WORKER,langPath:OCR_LANG,corePath:OCR_CORE,gzip:true,logger:onProg};
      let worker;
      try {
        worker=await window.Tesseract.createWorker('eng', 1, options);
      } catch (modernErr) {
        worker=await window.Tesseract.createWorker(options);
        if(worker.load) await worker.load();
        if(worker.loadLanguage) await worker.loadLanguage('eng');
        if(worker.initialize) await worker.initialize('eng');
      }
      return worker;
    })().catch(e=>{ocrWorkerPromise=null;throw e;});
    return ocrWorkerPromise;
  }

  function cropCanvas(cx,cy,radiusX,radiusY,upscale,variant) {
    const live=livePlanImage(); if(!live) throw new Error('No decoded Workspace plan is available.');
    const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height;
    const x0=Math.max(0,Math.floor(cx-radiusX)), y0=Math.max(0,Math.floor(cy-radiusY));
    const x1=Math.min(iw,Math.ceil(cx+radiusX)), y1=Math.min(ih,Math.ceil(cy+radiusY));
    const sw=Math.max(1,x1-x0), sh=Math.max(1,y1-y0);
    let scale=Math.max(1,Number(upscale)||2);
    const cap=Math.min(maxCanvasPx(),OCR_CROP_MAX_PX);
    if(sw*sh*scale*scale>cap) scale=Math.max(1,Math.sqrt(cap/(sw*sh)));
    const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(sw*scale)); cv.height=Math.max(1,Math.round(sh*scale));
    const ctx=cv.getContext('2d',{willReadFrequently:variant==='red'});
    ctx.imageSmoothingEnabled=true; try{ctx.imageSmoothingQuality='high'}catch(_){}
    ctx.drawImage(live,x0,y0,sw,sh,0,0,cv.width,cv.height);
    if(variant==='red'){
      const im=ctx.getImageData(0,0,cv.width,cv.height), d=im.data;
      for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];const red=r>75&&r>g*1.18&&r>b*1.18;const v=red?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;}
      ctx.putImageData(im,0,0);
    }
    return {canvas:cv,x0,y0,scale,sourceW:sw,sourceH:sh};
  }

  function parsePrintedIdentity(text, mode) {
    const t=String(text||'').toUpperCase().replace(/[|]/g,'I');
    if(mode==='dev-only'){
      const m=t.match(/(?:^|[^0-9])(\d{2,3})(?=$|[^0-9])/); if(!m)return null;
      return {loop:'',dev:String(parseInt(m[1],10)),raw:m[0].trim()};
    }
    /* Tight trailing boundary stops partial labels from being accepted. An OCR
       hallucination such as D85] -> D851 still reaches the range guard below. */
    const m=t.match(/(?:^|[^A-Z0-9])L\s*0*(\d{1,3})\s*[.\-:]?\s*D\s*0*(\d{2,3})(?=$|[\s,.;:)\]}])/i);
    if(!m)return null;
    return {loop:String(parseInt(m[1],10)),dev:String(parseInt(m[2],10)),raw:m[0].trim()};
  }

  function bboxFromAny(b) {
    if(!b)return null;
    const x0=num(b.x0!=null?b.x0:b.left), y0=num(b.y0!=null?b.y0:b.top);
    const x1=num(b.x1!=null?b.x1:(b.left!=null&&b.width!=null?Number(b.left)+Number(b.width):null));
    const y1=num(b.y1!=null?b.y1:(b.top!=null&&b.height!=null?Number(b.top)+Number(b.height):null));
    if([x0,y0,x1,y1].some(v=>v==null)) return null;
    return {x0,y0,x1,y1};
  }

  function tsvWords(tsv) {
    if(!tsv || typeof tsv!=='string')return [];
    const lines=tsv.split(/\r?\n/).filter(line=>line.length); if(!lines.length)return [];
    const standard=['level','page_num','block_num','par_num','line_num','word_num','left','top','width','height','conf','text'];
    const first=lines[0].split('\t');
    const hasHeader=first.includes('level') && first.includes('text');
    const head=hasHeader?first:standard;
    const rows=hasHeader?lines.slice(1):lines;
    const idx=k=>head.indexOf(k);
    const required=['level','block_num','par_num','line_num','word_num','left','top','width','height','conf','text'];
    if(required.some(k=>idx(k)<0))return [];
    const out=[];
    for(const line of rows){
      const a=line.split('\t'); if(a.length<head.length)continue;
      const level=Number(a[idx('level')]); if(level!==5)continue;
      const text=String(a[idx('text')]||'').trim(); if(!text)continue;
      const left=Number(a[idx('left')]),top=Number(a[idx('top')]),width=Number(a[idx('width')]),height=Number(a[idx('height')]);
      out.push({text,confidence:Number(a[idx('conf')]),bbox:{x0:left,y0:top,x1:left+width,y1:top+height},
        block_num:Number(a[idx('block_num')]),par_num:Number(a[idx('par_num')]),line_num:Number(a[idx('line_num')]),word_num:Number(a[idx('word_num')])});
    }
    return out;
  }

  function ocrLineItems(data, fallbackW, fallbackH) {
    const lines=[];
    if(data && Array.isArray(data.lines)){
      data.lines.forEach((l,i)=>{const text=field(l.text);const bbox=bboxFromAny(l.bbox);if(text&&bbox)lines.push({text,bbox,confidence:Number(l.confidence)||0,key:`l${i}`});});
      if(lines.length)return lines;
    }
    let words=[];
    if(data && Array.isArray(data.words)) words=data.words.map((w,i)=>({text:field(w.text),bbox:bboxFromAny(w.bbox),confidence:Number(w.confidence)||0,key:w.line_num!=null?`${w.block_num||0}:${w.par_num||0}:${w.line_num}`:`w${i}`,word_num:Number(w.word_num)||i})).filter(w=>w.text&&w.bbox);
    if(!words.length && data && data.tsv) words=tsvWords(data.tsv).map((w,i)=>Object.assign(w,{key:`${w.block_num||0}:${w.par_num||0}:${w.line_num||0}`,word_num:w.word_num||i}));
    if(words.length){
      const groups=new Map(); words.forEach(w=>{if(!groups.has(w.key))groups.set(w.key,[]);groups.get(w.key).push(w)});
      groups.forEach(ws=>{
        ws.sort((a,b)=>(a.word_num-b.word_num)||(a.bbox.x0-b.bbox.x0));
        for(let start=0;start<ws.length;start++)for(let span=1;span<=Math.min(3,ws.length-start);span++){
          const part=ws.slice(start,start+span), text=part.map(w=>w.text).join(' ');
          const bbox={x0:Math.min(...part.map(w=>w.bbox.x0)),y0:Math.min(...part.map(w=>w.bbox.y0)),x1:Math.max(...part.map(w=>w.bbox.x1)),y1:Math.max(...part.map(w=>w.bbox.y1))};
          lines.push({text,bbox,confidence:part.reduce((a,w)=>a+(w.confidence||0),0)/part.length,key:`${start}:${span}`});
        }
      });
      return lines;
    }
    const text=field(data&&data.text); if(text)lines.push({text,bbox:{x0:0,y0:0,x1:fallbackW,y1:fallbackH},confidence:Number(data.confidence)||0,key:'text'});
    return lines;
  }

  async function ocrCrop(worker,cx,cy,opts) {
    const variants=Array.isArray(opts.variants)&&opts.variants.length?opts.variants:(opts.redVariant===false?['normal']:['normal','red']);
    const modes=Array.isArray(opts.psmModes)&&opts.psmModes.length?opts.psmModes.map(String):(opts.fallbackPsm11?['7','11']:['7']);
    const labels=[];
    for(const psm of modes){
      if(worker.setParameters) await worker.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:'1'});
      for(const variant of variants){
        const c=cropCanvas(cx,cy,opts.radiusX,opts.radiusY,opts.upscale,variant);
        const result=await worker.recognize(c.canvas,{}, {text:true,tsv:true,blocks:true});
        const items=ocrLineItems(result&&result.data,c.canvas.width,c.canvas.height);
        for(const item of items){
          const parsed=parsePrintedIdentity(item.text,opts.mode); if(!parsed)continue;
          const b=item.bbox;
          labels.push({loop:parsed.loop,dev:parsed.dev,raw:parsed.raw,text:item.text,confidence:Number(item.confidence)||0,
            bbox:[c.x0+b.x0/c.scale,c.y0+b.y0/c.scale,(b.x1-b.x0)/c.scale,(b.y1-b.y0)/c.scale],votes:1,variant,psm});
        }
        c.canvas.width=1;c.canvas.height=1;
        if(labels.length) return labels; /* shortest successful path per crop */
      }
    }
    return labels;
  }

  function bboxDistance(b,x,y){const bx=b[0],by=b[1],bw=b[2],bh=b[3];const nx=Math.min(Math.max(x,bx),bx+bw),ny=Math.min(Math.max(y,by),by+bh);return Math.hypot(x-nx,y-ny);}
  function bboxIou(a,b){const x0=Math.max(a[0],b[0]),y0=Math.max(a[1],b[1]),x1=Math.min(a[0]+a[2],b[0]+b[2]),y1=Math.min(a[1]+a[3],b[1]+b[3]);const inter=Math.max(0,x1-x0)*Math.max(0,y1-y0),u=a[2]*a[3]+b[2]*b[3]-inter;return u>0?inter/u:0;}
  function bboxArea(b){return Math.max(0,Number(b&&b[2])||0)*Math.max(0,Number(b&&b[3])||0);}
  function bboxContainedFraction(inner,outer){
    const ia=bboxArea(inner);if(!ia)return 0;
    const x0=Math.max(inner[0],outer[0]),y0=Math.max(inner[1],outer[1]),x1=Math.min(inner[0]+inner[2],outer[0]+outer[2]),y1=Math.min(inner[1]+inner[3],outer[1]+outer[3]);
    const inter=Math.max(0,x1-x0)*Math.max(0,y1-y0);return inter/ia;
  }

  function dedupeLabels(labels){
    const kept=[];
    labels.slice().sort((a,b)=>(b.confidence-a.confidence)).forEach(c=>{
      c.cx=c.bbox[0]+c.bbox[2]/2;c.cy=c.bbox[1]+c.bbox[3]/2;
      const source={phase:field(c.phase)||'center',offsetX:Number(c.offsetX)||0,offsetY:Number(c.offsetY)||0,upscale:Number(c.upscale)||1,variant:field(c.variant),psm:field(c.psm)};
      let containment=null;
      const k=kept.find(x=>{
        if(x.dev!==c.dev)return false;
        const xa=bboxArea(x.bbox),ca=bboxArea(c.bbox),small=xa<=ca?x.bbox:c.bbox,large=xa<=ca?c.bbox:x.bbox;
        const frac=bboxContainedFraction(small,large);
        const loopCompatible=x.loop===c.loop||((!x.loop||!c.loop)&&frac>=0.60);
        const dup=loopCompatible&&(bboxIou(x.bbox,c.bbox)>=0.45||Math.hypot(x.cx-c.cx,x.cy-c.cy)<12||frac>=0.60);
        if(dup)containment={fraction:frac,larger:xa>=ca?x.bbox:c.bbox};
        return dup;
      });
      if(k){
        k.votes=(k.votes||1)+(c.votes||1);
        k.sources=Array.isArray(k.sources)?k.sources:[];
        const sig=JSON.stringify(source);if(!k.sources.some(x=>JSON.stringify(x)===sig))k.sources.push(source);
        const higherConfidence=c.confidence>k.confidence;
        if(higherConfidence){
          k.confidence=c.confidence;k.raw=c.raw;k.text=c.text;
          k.phase=source.phase;k.offsetX=source.offsetX;k.offsetY=source.offsetY;k.upscale=source.upscale;k.variant=source.variant;k.psm=source.psm;
          if(!k.loop&&c.loop)k.loop=c.loop;
        }
        /* AM3: crop-edge duplicates can be a high-confidence partial box fully
           inside the real full label. Keep the larger geometry when containment
           proves they are the same printed identity, so assignment uses the
           physical label centre rather than the cut crop edge. */
        if(containment&&containment.fraction>=0.60){k.bbox=containment.larger.slice();k.cx=k.bbox[0]+k.bbox[2]/2;k.cy=k.bbox[1]+k.bbox[3]/2;}
        else if(higherConfidence){k.bbox=c.bbox;k.cx=c.cx;k.cy=c.cy;}
      } else {c.sources=[source];kept.push(c);}
    });
    return kept;
  }

  function assignLabels(labels,candidates,maxPx){
    /* AG3: edge distance decides eligibility (the 60 px safety cap), but a wide
       OCR label must not prefer the neighbouring symbol merely because one end
       of its bbox is closer. Rank eligible pairs by label-centre distance. */
    const pairs=[];
    labels.forEach((lab,li)=>candidates.forEach((c,ci)=>{
      const x=Number(c.obj.x),y=Number(c.obj.y);
      const edge=bboxDistance(lab.bbox,x,y);
      if(edge>maxPx)return;
      const cx=lab.bbox[0]+lab.bbox[2]/2,cy=lab.bbox[1]+lab.bbox[3]/2;
      const centre=Math.hypot(x-cx,y-cy);
      pairs.push([centre,edge,li,ci]);
    }));
    pairs.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||((labels[b[2]].confidence||0)-(labels[a[2]].confidence||0)));
    const ul=new Set(),uc=new Set(),out=[];
    /* Pass 205 [205-G1] contested-label tie-break: a label eligible for two candidates
       within two symbol widths prefers the one the detector is surer of (by >= 0.15), so a
       0.5 phantom/duplicate cannot take a label off a 0.8 real symbol next to it.
       Measured on Site-2 GF: phantom D96 (0.58 box) lost the label to the real 0.85 symbol. */
    const widths=candidates.map(c=>c.meta&&Array.isArray(c.meta.bbox)?Number(c.meta.bbox[2]):NaN).filter(Number.isFinite).sort((a,b)=>a-b);
    const symW=widths.length?widths[Math.floor(widths.length/2)]:44;
    const conf=ci=>{const v=candidates[ci].meta&&candidates[ci].meta.confidence;return Number.isFinite(Number(v))?Number(v):1;};
    pairs.forEach(([centre,edge,li,ci])=>{if(ul.has(li)||uc.has(ci))return;
      const rival=pairs.find(q=>q[2]===li&&q[3]!==ci&&!uc.has(q[3])&&q[0]<=centre+2*symW&&conf(q[3])>=conf(ci)+0.15);
      if(rival)return;
      ul.add(li);uc.add(ci);out.push({distance:edge,centreDistance:centre,label:labels[li],candidate:candidates[ci],candidateIndex:ci});});
    return {assignments:out,usedLabels:ul,usedCandidates:uc};
  }

  function applyOcrConsistency(assignments){
    const active=assignments.filter(a=>a.label.loop);
    const loopCounts={};active.forEach(a=>loopCounts[a.label.loop]=(loopCounts[a.label.loop]||0)+1);
    let dominantLoop='',dominance=0,loopEnforced=false;
    if(active.length>=8){const e=Object.entries(loopCounts).sort((a,b)=>b[1]-a[1])[0];if(e){dominantLoop=e[0];dominance=e[1]/active.length;loopEnforced=dominance>=0.90;}}
    if(loopEnforced)assignments.forEach(a=>{if(a.label.loop&&a.label.loop!==dominantLoop)a.withheld=`Printed loop ${a.label.loop} is an outlier; ${dominantLoop} dominates this sheet.`;});

    const readable=assignments.filter(a=>!a.withheld&&/^\d+$/.test(a.label.dev));
    const reliable=readable.filter(a=>(a.label.votes||0)>=2).map(a=>Number(a.label.dev));
    let rangeEnforced=false,rangeLimit=null,observedMax=null;
    if(readable.length>=8&&reliable.length>=Math.max(3,Math.floor(8/3))){observedMax=Math.max(...reliable);rangeLimit=Math.max(observedMax*3,observedMax+200);rangeEnforced=true;
      assignments.forEach(a=>{if(!a.withheld&&/^\d+$/.test(a.label.dev)&&Number(a.label.dev)>rangeLimit)a.withheld=`Printed address ${a.label.dev} is far outside the sheet's reliable range (review above ${Math.round(rangeLimit)}).`;});}
    return {loopEnforced,dominantLoop,dominance,loopCounts,rangeEnforced,observedMax,rangeLimit};
  }

  function ocrAssignmentConflictsProtected(a){
    const c=a&&a.candidate,lab=a&&a.label;if(!c||!lab)return true;
    const protectedDev=(c.meta.devSource==='user'||c.meta.devSource==='schedule')&&field(c.obj.dev);
    const protectedLoop=(c.meta.loopSource==='user'||c.meta.loopSource==='schedule')&&field(c.obj.loop);
    return !!((protectedDev&&field(c.obj.dev)!==lab.dev)||(protectedLoop&&lab.loop&&field(c.obj.loop)!==lab.loop));
  }

  function ocrLabelKnownToSchedule(lab){
    if(!session||!session.schedule||!session.schedule.length)return true;
    const loop=field(lab&&lab.loop),dev=field(lab&&lab.dev);if(!dev)return false;
    if(loop)return session.schedule.some(r=>field(r.loop)===loop&&field(r.dev)===dev);
    return session.schedule.some(r=>field(r.dev)===dev);
  }

  function poolOcrAssignments(rawLabels,candidates,maxPx){
    const labels=dedupeLabels(rawLabels),assigned=assignLabels(labels,candidates,maxPx);
    const consistency=applyOcrConsistency(assigned.assignments);
    const settledCandidates=new Set();
    assigned.assignments.forEach(a=>{
      /* 60 px remains the final eligibility cap. For deciding whether to spend
         another OCR retry, be stricter: AA2 measured every correct Site-2
         assignment at <=34 px. A farther/withheld/schedule-unknown read is kept
         in the pool but does not stop us looking for a better local label. */
      if(!a.withheld&&!ocrAssignmentConflictsProtected(a)&&a.distance<=OCR_RETRY_SETTLED_EDGE_PX&&ocrLabelKnownToSchedule(a.label))settledCandidates.add(a.candidateIndex);
    });
    return {labels,assigned,consistency,settledCandidates};
  }

  function unreadCandidateIndexes(pool,candidates){
    const out=[];for(let i=0;i<candidates.length;i++)if(!pool.settledCandidates.has(i))out.push(i);return out;
  }

  function tagOcrLabels(labels,candidate,phase,dx,dy,upscale,rawLabels){
    labels.forEach(l=>{l.observedNear=candidate.id;l.phase=phase;l.offsetX=dx;l.offsetY=dy;l.upscale=upscale;rawLabels.push(l);});
  }

  /* [209-G3] Lanczos-3 resample of a grey tile. The canvas's own bilinear
     upscale reads 2/8 of these 7 px digits; Lanczos + a min/max stretch reads
     7/8 (measured on the sheet that first showed the problem). Tiles are tiny. */
  function lanczosGrey(src,sw,sh,dw,dh){
    const A=3,kern=x=>{if(x===0)return 1;if(x<=-A||x>=A)return 0;const px=Math.PI*x;return A*Math.sin(px)*Math.sin(px/A)/(px*px);};
    const tmp=new Float32Array(dw*sh),out=new Float32Array(dw*dh),rx=sw/dw,ry=sh/dh;
    for(let x=0;x<dw;x++){const cx=(x+0.5)*rx-0.5,x0=Math.max(0,Math.floor(cx-A+1)),x1=Math.min(sw-1,Math.floor(cx+A));const ws=[];let wsum=0;
      for(let i=x0;i<=x1;i++){const k=kern(i-cx);ws.push(k);wsum+=k;}
      for(let y=0;y<sh;y++){let v=0;for(let i=x0,j=0;i<=x1;i++,j++)v+=src[y*sw+i]*ws[j];tmp[y*dw+x]=wsum?v/wsum:0;}}
    for(let y=0;y<dh;y++){const cy=(y+0.5)*ry-0.5,y0=Math.max(0,Math.floor(cy-A+1)),y1=Math.min(sh-1,Math.floor(cy+A));const ws=[];let wsum=0;
      for(let i=y0;i<=y1;i++){const k=kern(i-cy);ws.push(k);wsum+=k;}
      for(let x=0;x<dw;x++){let v=0;for(let i=y0,j=0;i<=y1;i++,j++)v+=tmp[i*dw+x]*ws[j];out[y*dw+x]=wsum?v/wsum:0;}}
    return out;
  }
  function cropStripCanvas(x0,y0,w,h,upscale){
    const live=livePlanImage(); if(!live) throw new Error('No decoded Workspace plan is available.');
    const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height;
    const sx=clamp(Math.floor(x0),0,iw-1),sy=clamp(Math.floor(y0),0,ih-1),sw=Math.max(1,Math.min(iw-sx,Math.ceil(w))),sh=Math.max(1,Math.min(ih-sy,Math.ceil(h)));
    const pad=20,cw=Math.round(sw*upscale),ch=Math.round(sh*upscale);
    const src=document.createElement('canvas');src.width=sw;src.height=sh;
    const sctx=src.getContext('2d',{willReadFrequently:true});sctx.drawImage(live,sx,sy,sw,sh,0,0,sw,sh);
    const d=sctx.getImageData(0,0,sw,sh).data,grey=new Float32Array(sw*sh);
    for(let i=0,j=0;i<d.length;i+=4,j++)grey[j]=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    const big=lanczosGrey(grey,sw,sh,cw,ch);let lo=255,hi=0;
    for(let i=0;i<big.length;i++){const v=big[i];if(v<lo)lo=v;if(v>hi)hi=v;}
    const span=Math.max(1,hi-lo);
    const cv=document.createElement('canvas');cv.width=cw+2*pad;cv.height=ch+2*pad;
    const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
    const im=ctx.createImageData(cw,ch),o=im.data;
    for(let i=0,j=0;i<big.length;i++,j+=4){const v=clamp(Math.round((big[i]-lo)*255/span),0,255);o[j]=o[j+1]=o[j+2]=v;o[j+3]=255;}
    ctx.putImageData(im,pad,pad);
    return cv;
  }
  async function runOcrStripPass(worker,candidates,indexes,rawLabels){
    if(worker.setParameters) await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1',tessedit_char_whitelist:'0123456789'});
    let crops=0,reads=0,readCandidates=0;
    try{
      for(let n=0;n<indexes.length;n++){
        const i=indexes[n],c=candidates[i];spThrowIfCancelled();
        session.ocrStatus=`Reading numbers — ${n+1} / ${indexes.length}`;session.progress={done:n,total:indexes.length,phase:0,phases:1};spTick();
        const b=(c.meta&&Array.isArray(c.meta.bbox)&&c.meta.bbox.length===4)?c.meta.bbox:[Number(c.obj.x)-9,Number(c.obj.y)-9,18,18];
        const cx=b[0]+b[2]/2,cy=b[1]+b[3]/2,w=Math.max(6,b[2]),h=Math.max(6,b[3]);
        const seen=[];
        for(const st of OCR_STRIPS){
          spThrowIfCancelled();
          const rx=cx+st.x*w,ry=cy+st.y*h,rw=st.w*w,rh=st.h*h;
          /* TWO SCALES MUST AGREE. tesseract's own confidence is 0 on many correct
             reads of these tiles and 90 on some wrong ones; a read that survives a
             change of scale is the honest signal (measured: 0 wrong agreed reads). */
          let text=null,conf=0;
          const looks=OCR_STRIP_UPSCALES.map(up=>[rx,ry,rw,rh,up]);
          const cut=OCR_STRIP_NARROW_CUT;
          /* the wire enters the label from the SYMBOL side, so the third look trims
             the near edge; a 3-digit read that starts with 1 and changes is a wire */
          if(st.name==='left')looks.push([rx,ry,rw*(1-cut),rh,OCR_STRIP_UPSCALE,'near']);
          else if(st.name==='right')looks.push([rx+rw*cut,ry,rw*(1-cut),rh,OCR_STRIP_UPSCALE,'near']);
          else if(st.name==='up')looks.push([rx,ry,rw,rh*(1-cut),OCR_STRIP_UPSCALE,'near']);
          else looks.push([rx,ry+rh*cut,rw,rh*(1-cut),OCR_STRIP_UPSCALE,'near']);
          for(const [lx,ly,lw,lh,up,kind] of looks){
            const cv=cropStripCanvas(lx,ly,lw,lh,up);crops++;
            const result=await worker.recognize(cv,{},{text:true});
            const t=String(result&&result.data&&result.data.text||'').replace(/\s+/g,'');
            const cf=Number(result&&result.data&&result.data.confidence)||0;
            if(kind==='near'){
              if(text!==null&&text[0]==='1'&&text.length===3&&t!==text)text=null;  /* 139 -> 39: the 1 was the wire */
              break;
            }
            if(!/^\d{1,3}$/.test(t)){text=null;break;}
            if(text===null){text=t;conf=cf;}else if(t!==text){text=null;break;}else conf=Math.min(conf,cf);
          }
          if(text===null)continue;
          if(text[0]==='0')continue;  /* a leading 0 is a clipped longer number */
          /* a lone "1" is a wall line or a wire far more often than device 1 */
          if(text.length<2&&(conf<OCR_STRIP_SINGLE_MIN_CONF||text==='1'))continue;
          const dev=String(parseInt(text,10));
          seen.push({dir:st.name,dev,confidence:conf});
          rawLabels.push({loop:'',dev,raw:text,text,confidence:conf,bbox:[rx,ry,rw,rh],votes:1,variant:'strip',psm:'7',phase:'strip',observedNear:c.id,offsetX:0,offsetY:0,upscale:OCR_STRIP_UPSCALE});
          reads++;
        }
        c.meta.stripReads=seen;
        const distinct=[...new Set(seen.map(k=>k.dev))];
        if(distinct.length>1){
          /* two different numbers printed within reach: never guess, never let a
             neighbour inherit one of them - the row goes to Review with both shown */
          for(let k=rawLabels.length-1;k>=0;k--)if(rawLabels[k].observedNear===c.id&&rawLabels[k].phase==='strip')rawLabels.splice(k,1);
          c.meta.stripConflict=distinct;
        } else delete c.meta.stripConflict;
        if(seen.length)readCandidates++;
      }
    }finally{
      if(worker.setParameters) await worker.setParameters({tessedit_char_whitelist:''});
    }
    return {candidates:indexes.length,crops,reads,readCandidates,upscale:OCR_STRIP_UPSCALE};
  }

  async function runOcrCandidatePass(worker,candidates,indexes,opts,rawLabels,phase,offsets,upscale){
    let cropReads=0,labelReads=0;
    for(let n=0;n<indexes.length;n++){
      const i=indexes[n],c=candidates[i],x=Number(c.obj.x),y=Number(c.obj.y);
      spThrowIfCancelled();
      session.ocrStatus=`Reading labels \u2014 ${n+1} / ${indexes.length} \u00b7 ${phase==='center'?'first pass':phase==='offset'?'second pass':phase==='quadrant'?'wide pass':phase}`;session.progress={done:n,total:indexes.length,phase:phase==='center'?0:phase==='offset'?1:2,phases:3};spTick();
      for(const [dx,dy] of offsets){
        spThrowIfCancelled();
        const passOpts=Object.assign({},opts,{upscale});
        const got=await ocrCrop(worker,x+dx,y+dy,passOpts);cropReads++;labelReads+=got.length;
        tagOcrLabels(got,c,phase,dx,dy,upscale,rawLabels);
      }
    }
    return {candidates:indexes.length,crops:cropReads,reads:labelReads,upscale};
  }

  async function recognisePrintedIdentities(options) {
    if(!session||session.committed)throw new Error('Stage Smart Plan candidates before running printed-identity OCR.');
    if(!hostUnchanged(session.hostSnapshot))throw new Error('The Workspace changed while Smart Plan was open. Analyse again before OCR.');
    const live=livePlanImage();if(!live)throw new Error('No decoded Workspace plan is available for OCR.');
    if(session.ocrBusy)throw new Error('Smart Plan OCR is already running.');
    const opts=Object.assign({mode:'auto',radiusX:145,radiusY:85,retryOffset:30,upscale:2,maxAssignmentPx:OCR_ASSIGN_MAX_PX,redVariant:true,fallbackPsm11:true,quadrantRetry:true},options||{});
    opts.maxAssignmentPx=Math.min(60,Math.max(1,Number(opts.maxAssignmentPx)||OCR_ASSIGN_MAX_PX)); /* AA2 hard ceiling */
    opts.retryOffset=Math.max(0,Number(opts.retryOffset)||0);
    const baseUpscale=Math.max(1,Number(opts.upscale)||2);
    const candidates=session.candidates.filter(c=>c.decision!=='rejected');
    if(!candidates.length)throw new Error('No non-rejected candidates are available for OCR.');
    session.ocrBusy=true;session.ocrStatus='Starting Arc OCR…';render();
    const rawLabels=[];const worker=await ensureOcrWorker();const started=Date.now();
    try{
      /* AL4 fill discipline: every candidate gets one centred read. Only rows
         still unsafe/unassigned after global one-to-one assignment get retries.
         V1.6 proved the left-only D76 recovery matters, so all four 30 px cardinal
         retries are restored. Rows still unresolved then get four larger quadrant
         crops at the SAME 2x raster, raw pixels and PSM 6; no 4x upscaling. */
      const all=candidates.map((_,i)=>i);
      const phases={};
      let numbersOnly=false,centerAssigned0=0,afterOffset0=0;
      if(opts.mode==='auto'){
        /* WHICH KIND OF SHEET? A few wide L01.D40-style reads first: a strip
           would read "43" out of "L01.D43" and the loop would be lost. */
        const step=Math.max(1,Math.floor(all.length/OCR_STYLE_PROBE_N)),probe=all.filter((_,i)=>i%step===0).slice(0,OCR_STYLE_PROBE_N);
        session.ocrStatus='Checking how this sheet labels its detectors…';session.progress=null;spTick();
        phases.probe=await runOcrCandidatePass(worker,candidates,probe,opts,rawLabels,'center',[[0,0]],baseUpscale);
        if(rawLabels.some(l=>l.loop)){opts.mode='loop-device';phases.strip={candidates:0,crops:0,reads:0,readCandidates:0,adopted:false,skipped:'loop-device labels found'};}
        else{rawLabels.length=0;opts.mode='dev-only-try';}
      }
      if(opts.mode==='dev-only'||opts.mode==='dev-only-try'){
        const forced=opts.mode==='dev-only';
        phases.strip=await runOcrStripPass(worker,candidates,all,rawLabels);
        numbersOnly=forced||phases.strip.readCandidates>=Math.max(1,Math.ceil(candidates.length*OCR_STRIP_ADOPT_RATIO));
        if(!numbersOnly){rawLabels.length=0;candidates.forEach(c=>{delete c.meta.stripReads;delete c.meta.stripConflict;});}
        opts.mode=numbersOnly?'dev-only':'loop-device';
        phases.strip.adopted=numbersOnly;
      }
      if(numbersOnly){
        /* the strips are the whole read on a bare-number sheet: every symbol got
           four tight looks already; the wide loop-device passes would only add noise */
        const zero={candidates:0,crops:0,reads:0,upscale:baseUpscale};
        phases.center=zero;phases.offset=Object.assign({},zero);
        phases.quadrant=Object.assign({},zero,{width:OCR_QUADRANT_W,height:OCR_QUADRANT_H,psm:'6',raw:true});
      } else {
      phases.center=await runOcrCandidatePass(worker,candidates,all,opts,rawLabels,'center',[[0,0]],baseUpscale);
      let pool0=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      centerAssigned0=pool0.assigned.usedCandidates.size;

      let unread=unreadCandidateIndexes(pool0,candidates);
      if(unread.length&&opts.retryOffset>0){
        const o=opts.retryOffset,offsets=OCR_RETRY_DIRECTIONS.map(d=>[d.dx*o,d.dy*o]);
        phases.offset=await runOcrCandidatePass(worker,candidates,unread,opts,rawLabels,'offset',offsets,baseUpscale);
        pool0=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      } else phases.offset={candidates:0,crops:0,reads:0,upscale:baseUpscale};
      afterOffset0=pool0.assigned.usedCandidates.size;

      unread=unreadCandidateIndexes(pool0,candidates);
      if(unread.length&&opts.quadrantRetry!==false){
        const quadrantOpts=Object.assign({},opts,{
          radiusX:OCR_QUADRANT_W/2,
          radiusY:OCR_QUADRANT_H/2,
          redVariant:false,
          fallbackPsm11:false,
          variants:['normal'],
          psmModes:['6']
        });
        const offsets=OCR_QUADRANTS.map(q=>[q.dx,q.dy]);
        phases.quadrant=await runOcrCandidatePass(worker,candidates,unread,quadrantOpts,rawLabels,'quadrant',offsets,baseUpscale);
        phases.quadrant.width=OCR_QUADRANT_W;phases.quadrant.height=OCR_QUADRANT_H;phases.quadrant.psm='6';phases.quadrant.raw=true;
      } else phases.quadrant={candidates:0,crops:0,reads:0,upscale:baseUpscale,width:OCR_QUADRANT_W,height:OCR_QUADRANT_H,psm:'6',raw:true};
      }
      let pool=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      const centerAssigned=numbersOnly?pool.assigned.usedCandidates.size:centerAssigned0;const afterOffset=numbersOnly?centerAssigned:afterOffset0;

      const labels=pool.labels,assigned=pool.assigned,consistency=pool.consistency;
      let applied=0,withheld=0,mismatch=0;
      candidates.forEach(c=>{if(c.meta.devSource==='ocr'){c.obj.dev='';c.meta.devSource='';}if(c.meta.loopSource==='ocr'){c.obj.loop='';c.meta.loopSource='';}c.meta.ocrIssue='';c.meta.ocrDistance=null;c.meta.ocrConfidence=null;});
      candidates.forEach(c=>{if(numbersOnly&&Array.isArray(c.meta.stripConflict)&&c.meta.stripConflict.length>1){c.meta.ocrIssue=`Two numbers are printed next to it: ${c.meta.stripConflict.join(' and ')}. Pick one.`;c.decision='review';withheld++;}});
      assigned.assignments.forEach(a=>{
        const c=a.candidate,lab=a.label;c.meta.ocrDistance=Math.round(a.distance*10)/10;c.meta.ocrConfidence=lab.confidence;
        if(a.withheld){withheld++;c.meta.ocrIssue=a.withheld;c.decision='review';return;}
        const protectedDev=(c.meta.devSource==='user'||c.meta.devSource==='schedule')&&field(c.obj.dev);
        const protectedLoop=(c.meta.loopSource==='user'||c.meta.loopSource==='schedule')&&field(c.obj.loop);
        if((protectedDev&&field(c.obj.dev)!==lab.dev)||(protectedLoop&&lab.loop&&field(c.obj.loop)!==lab.loop)){
          mismatch++;c.meta.ocrIssue=`Printed identity ${lab.loop?`L${lab.loop}.D`:''}${lab.dev} disagrees with the ${protectedDev||protectedLoop?'user/schedule':'existing'} identity.`;c.decision='review';return;
        }
        if(!protectedDev){c.obj.dev=lab.dev;c.meta.devSource='ocr';}
        if(lab.loop&&!protectedLoop){c.obj.loop=lab.loop;c.meta.loopSource='ocr';}
        applied++;
      });
      if(session.schedule.length) reconcileSchedule(true);
      else refreshIssues();
      const finalAssigned=pool.assigned.usedCandidates.size;
      const report={summary:{labels:labels.length,assigned:assigned.assignments.length,applied,withheld,mismatch,unread:Math.max(0,candidates.length-finalAssigned),capPx:opts.maxAssignmentPx,
        centerAssigned,offsetRecovered:Math.max(0,afterOffset-centerAssigned),quadrantRecovered:Math.max(0,finalAssigned-afterOffset),baseUpscale,
        retryDirections:OCR_RETRY_DIRECTIONS.map(d=>d.name),quadrantDirections:OCR_QUADRANTS.map(d=>d.name),quadrantWidth:OCR_QUADRANT_W,quadrantHeight:OCR_QUADRANT_H,quadrantOffsetX:OCR_QUADRANT_OFFSET_X,quadrantOffsetY:OCR_QUADRANT_OFFSET_Y,elapsedMs:Date.now()-started},
        phases:clone(phases),labels:clone(labels),consistency:clone(consistency),finishedAt:Date.now()};
      session.ocrReport=report;session.ocrStatus='';return clone(report);
    }catch(e){
      /* [205-A] a cancelled OCR writes NOTHING: identities are applied only after the last
         phase (the pool -> assign -> apply block above), so stopping at a crop boundary
         leaves every candidate exactly as it was. mutate-p205 M5 proves the suite sees
         a build that applies the partial pool on cancel. */
      if(e&&e.spCancelled){session.ocrStatus='';return null;}
      throw e;
    }finally{
      try { if(worker && worker.setParameters) await worker.setParameters({tessedit_pageseg_mode:'6'}); } catch (_) {}
      session.ocrBusy=false;session.cancelRequested=false;session.progress=null;render();
    }
  }

  function ensureStyle() {
    if(document.getElementById(STYLE_ID)) return;
    const s=document.createElement('style'); s.id=STYLE_ID;
    s.textContent=`
#${MODAL_ID}{position:fixed;inset:0;z-index:160;display:none;background:rgba(7,10,13,.76);backdrop-filter:blur(2px);padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));}
#${MODAL_ID} .spShell{height:100%;max-width:1220px;margin:auto;background:var(--fs-card,#20242a);color:var(--fs-text,#e8e8e8);border:1px solid var(--fs-border,#3a4047);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.48)}
#${MODAL_ID} .spHead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--fs-border,#3a4047);background:var(--fs-bg,#15181c)}
#${MODAL_ID} .spHead b{font-size:16px} #${MODAL_ID} .spGrow{flex:1}
#${MODAL_ID} .spBody{min-height:0;flex:1;display:grid;grid-template-columns:minmax(340px,1.1fr) minmax(330px,.9fr);gap:0}
#${MODAL_ID} .spPane{min-height:0;overflow:auto;padding:12px} #${MODAL_ID} .spPane+ .spPane{border-left:1px solid var(--fs-border,#3a4047)}
#${MODAL_ID} .spStats{display:grid;grid-template-columns:repeat(5,minmax(72px,1fr));gap:8px;margin-bottom:10px}
#${MODAL_ID} .spStat{padding:9px;border-radius:10px;background:var(--fs-tile,#292e34);border:1px solid var(--fs-border,#3a4047)}  /* [212-D] --fs-bg2 never existed */
#${MODAL_ID} .spStat strong{display:block;font-size:18px} #${MODAL_ID} .spStat span{font-size:10px;color:var(--fs-sub,#9aa2aa)}
#${MODAL_ID} .spRow{display:grid;grid-template-columns:44px minmax(88px,1.1fr) 68px 68px 68px 92px;gap:6px;align-items:center;padding:7px 4px;border-bottom:1px solid rgba(128,128,128,.18)}
#${MODAL_ID} .spRow input,#${MODAL_ID} .spRow select{min-width:0;width:100%;min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-field,#15181c);color:var(--fs-fieldText,inherit);padding:6px}
#${MODAL_ID} .spRow .spIssue{grid-column:2/-1;font-size:10px;color:var(--fs-danger,#ffb3a7);line-height:1.35}
#${MODAL_ID} .spRow.spRowFocus{outline:2px solid #e040fb;outline-offset:-2px;border-radius:6px}
#${MODAL_ID} .spRow{cursor:pointer}
#${MODAL_ID} .spZoneBox{margin:8px 0 12px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-tile,#292e34)}
#${MODAL_ID} .spZoneRow{display:grid;grid-template-columns:minmax(90px,1fr) 92px;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.14)}
#${MODAL_ID} .spZoneRow:last-child{border-bottom:0}
#${MODAL_ID} .spBadge{font-size:10px;border:1px solid var(--fs-border,#59626c);border-radius:999px;padding:3px 7px;white-space:nowrap;color:var(--fs-sub,#9aa2aa)}.spBadge.ok{border-color:#2d8b57;color:#71d69c} html:not(.fsdark) #${MODAL_ID} .spBadge.ok{color:#1f7a45}.spBadge.rev{border-color:#b88926;color:#ffd36e} html:not(.fsdark) #${MODAL_ID} .spBadge.rev{color:#8a5a00}.spBadge.bad{border-color:#a94141;color:#ff9999} html:not(.fsdark) #${MODAL_ID} .spBadge.bad{color:#b3261e}
#${MODAL_ID} canvas{width:100%;height:auto;display:block;background:#fff;border-radius:10px;border:1px solid var(--fs-border,#3a4047)}
#${MODAL_ID} .spActions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0} #${MODAL_ID} .spHint{font-size:11px;line-height:1.45;color:var(--fs-sub,#9aa2aa)}
#${MODAL_ID} .spFoot{padding:10px 14px;border-top:1px solid var(--fs-border,#3a4047);display:flex;align-items:center;gap:8px;background:var(--fs-bg,#15181c)}
#${MODAL_ID} button{min-height:44px}.spPrimary{background:#ff5a3c!important;border-color:#ff5a3c!important;color:white!important;font-weight:700}.spDanger{border-color:#a94141!important;color:#ff9999!important}
#${MODAL_ID} .spDetect{margin:8px 0 10px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-tile,#292e34)}
#${MODAL_ID} .spDetectGrid{display:grid;grid-template-columns:minmax(120px,1.2fr) minmax(120px,1fr) 76px 82px auto;gap:6px;align-items:center}
#${MODAL_ID} .spRecon{margin:8px 0 10px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-tile,#292e34)}
#${MODAL_ID} .spReconGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:6px;margin-top:7px}
#${MODAL_ID} .spReconCell{padding:7px;border:1px solid rgba(128,128,128,.2);border-radius:8px}.spReconCell strong{display:block;font-size:16px}
#${MODAL_ID} .spZoneWork{margin:8px 0 10px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-tile,#292e34)}
#${MODAL_ID} .spZoneGrid{display:grid;grid-template-columns:70px 78px 78px auto;gap:6px;align-items:center;margin-top:7px}
#${MODAL_ID} .spZoneGrid input{min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-bg,#15181c);color:inherit;padding:6px;min-width:0;width:100%}
#${MODAL_ID} .spSourceRegion{display:grid;grid-template-columns:1fr 92px;gap:7px;align-items:center;padding:4px 0;border-top:1px solid rgba(128,128,128,.14)}
#${MODAL_ID} .spSourceRegion select{min-height:36px;border-radius:7px;background:var(--fs-bg,#15181c);color:inherit;border:1px solid var(--fs-border,#4b525c)}
#${MODAL_ID} .spDetectGrid select,#${MODAL_ID} .spDetectGrid input{min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-bg,#15181c);color:inherit;padding:6px;min-width:0}
#${MODAL_ID} .spCheck{font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap}
#${MODAL_ID} .spSourceCanvas{margin-top:10px}
#${MODAL_ID} .spStep{font-size:11px;color:var(--fs-sub,#9aa2aa);border:1px solid var(--fs-border,#3a4047);border-radius:999px;padding:4px 9px;white-space:nowrap}
#${MODAL_ID} .spScreen h3{font-size:18px;line-height:1.25;margin:2px 0 8px}
#${MODAL_ID} .spScreen p{font-size:13.5px;line-height:1.5;margin:0 0 10px;color:var(--fs-text,#e8e8e8)}
#${MODAL_ID} .spBig{display:block;width:100%;min-height:52px;font-size:15px;margin:8px 0}
#${MODAL_ID} .spQuiet{display:block;width:100%;min-height:44px;margin:6px 0}
#${MODAL_ID} .spPic{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 12px}
#${MODAL_ID} .spPic figure{margin:0;background:#fff;border-radius:10px;border:1px solid var(--fs-border,#3a4047);padding:6px}
#${MODAL_ID} .spPic svg{width:100%;height:auto;display:block}
#${MODAL_ID} .spPic figcaption{font-size:11px;color:#333;text-align:center;padding-top:4px}
#${MODAL_ID} details{margin:8px 0;border:1px solid var(--fs-border,#3a4047);border-radius:10px;padding:6px 10px}
#${MODAL_ID} details summary{cursor:pointer;font-size:12.5px;color:var(--fs-sub,#9aa2aa);min-height:36px;display:flex;align-items:center}
#${MODAL_ID} .spField{display:grid;grid-template-columns:minmax(90px,1fr) minmax(120px,1.3fr);gap:8px;align-items:center;margin:6px 0;font-size:12.5px}
#${MODAL_ID} .spField.spTypeRow{grid-template-columns:max-content minmax(120px,1fr);gap:10px}  /* [213-C] the label sits beside the select */
#${MODAL_ID} .spField select,#${MODAL_ID} .spField input{min-height:40px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-field,#15181c);color:var(--fs-fieldText,inherit);padding:6px;min-width:0;width:100%}
#${MODAL_ID} .spDone{padding:9px 11px;border-radius:10px;background:rgba(0,166,90,.14);border:1px solid #2d8b57;font-size:13px;margin:8px 0}
#${MODAL_ID} .spWarn{padding:9px 11px;border-radius:10px;background:rgba(255,179,0,.12);border:1px solid #b88926;font-size:13px;margin:8px 0}
#${MODAL_ID} .spNav{display:flex;gap:8px;margin-top:12px;position:sticky;bottom:-12px;padding:10px 0 12px;background:var(--fs-card,#20242a);border-top:1px solid var(--fs-border,#3a4047)}  /* [211-C] never scroll to the bottom for Back */
#${MODAL_ID} .spNav button{flex:1 1 auto}
#${MODAL_ID} .spCaption{font-size:12px;line-height:1.4;color:var(--fs-sub,#9aa2aa);margin:6px 0 0}
#${MODAL_ID} .spCaption.on{color:#ffd36e}
html:not(.fsdark) #${MODAL_ID} .spCaption.on{color:#8a5a00}
html:not(.fsdark) #${MODAL_ID} .spDone{border-color:#1f7a45}
html:not(.fsdark) #${MODAL_ID} .spWarn{border-color:#8a5a00}
#${MODAL_ID} .spPvHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
#${MODAL_ID} .spPvBar{display:flex;align-items:center;gap:4px}
#${MODAL_ID} .spPvBar button{min-height:40px;min-width:44px;padding:0 10px;font-size:16px}
#${MODAL_ID} .spPvPct{font-size:11px;color:var(--fs-sub,#9aa2aa);min-width:38px;text-align:right;font-variant-numeric:tabular-nums}
#${MODAL_ID} canvas{touch-action:none;cursor:grab}
#${MODAL_ID} .spHead b{white-space:nowrap}
#${MODAL_ID} details summary::before{content:'\\25B8  ';color:var(--fs-sub,#9aa2aa)}
#${MODAL_ID} details[open] summary::before{content:'\\25BE  '}
#${MODAL_ID} .spColHead{display:grid;grid-template-columns:44px minmax(88px,1.1fr) 68px 68px 68px 92px;gap:6px;font-size:10px;color:var(--fs-sub,#9aa2aa);padding:4px 4px 2px;text-transform:uppercase;letter-spacing:.04em}
@media(max-width:820px){#${MODAL_ID} .spHead{flex-wrap:wrap}#${MODAL_ID} .spStep{flex:1 1 100%;order:9;text-align:left;border:0;padding:2px 0 0}#${MODAL_ID} .spColHead{grid-template-columns:40px 1fr 58px 58px 58px}#${MODAL_ID} .spColHead span:last-child{display:none}}
@media(max-width:820px){#${MODAL_ID} .spBody{display:block;overflow:auto}#${MODAL_ID} .spPane{overflow:visible}#${MODAL_ID} .spPane+ .spPane{border-left:0;border-top:1px solid var(--fs-border,#3a4047)}#${MODAL_ID} .spFoot{flex-wrap:wrap;row-gap:6px}#${MODAL_ID} .spFoot [data-sp="foot"]{flex:1 1 100%}#${MODAL_ID} .spFoot [data-sp="bar"]{flex:1 1 100%;width:auto!important}#${MODAL_ID} .spFoot .spGrow{display:none}#${MODAL_ID} .spFoot button{flex:1 1 auto}#${MODAL_ID} .spStats{grid-template-columns:repeat(3,1fr)}#${MODAL_ID} .spRow{grid-template-columns:40px 1fr 58px 58px 58px}.spRow .spDecision{grid-column:2/-1}#${MODAL_ID} .spDetectGrid{grid-template-columns:1fr 1fr}#${MODAL_ID} .spDetectGrid button{grid-column:1/-1}#${MODAL_ID} .spZoneGrid{grid-template-columns:1fr 1fr}#${MODAL_ID} .spZoneGrid button{grid-column:1/-1}}
`;
    document.head.appendChild(s);
  }

  function ensureModal() {
    ensureStyle();
    let m=document.getElementById(MODAL_ID); if(m) return m;
    m=document.createElement('div'); m.id=MODAL_ID;
    m.innerHTML=`<div class="spShell">
      <div class="spHead"><b>Smart Plan</b><span class="spBadge" title="Smart Plan engine ${VERSION}">beta</span><span class="spStep" data-sp="stepno"></span><span class="spGrow"></span><button class="btn" data-sp="close">Close</button></div>
      <div class="spBody"><div class="spPane" data-sp="left"></div><div class="spPane" data-sp="right"></div></div>
      <div class="spFoot"><span class="spHint" data-sp="foot">Candidates stay temporary until Commit.</span><progress data-sp="bar" max="100" value="0" style="display:none;width:120px;height:10px"></progress><span class="spGrow"></span><button class="btn spDanger" data-sp="cancel" style="display:none">Cancel</button><button class="btn spDanger" data-sp="discard">Discard</button><button class="btn spPrimary" data-sp="commit">Commit to Workspace</button></div>
      <input type="file" id="${SCHEDULE_FILE_ID}" accept=".csv,.tsv,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none"><input type="file" id="${ZONE_SOURCE_FILE_ID}" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,application/pdf" style="display:none">
    </div>`;
    document.body.appendChild(m);
    m.querySelector('[data-sp="close"]').onclick=()=>{ m.style.display='none'; };
    m.querySelector('[data-sp="cancel"]').onclick=()=>{ cancelActiveOperation(); };
    m.querySelector('[data-sp="discard"]').onclick=()=>{ if(!session||confirm('Discard this uncommitted Smart Plan review?')) {discard();uiStep=1;} };
    m.querySelector('[data-sp="commit"]').onclick=()=>{
      try { const r=commit(); alert(`Smart Plan committed ${r.devices} device(s)${r.zones?` and ${r.zones} zone region(s)`:''}.`); }
      catch(e){ alert(e.message||String(e)); }
    };
    m.querySelector(`#${SCHEDULE_FILE_ID}`).onchange=async e=>{
      const f=e.target.files&&e.target.files[0];if(!f)return;
      try{await importScheduleFile(f);}catch(err){alert(err.message||String(err));}
      e.target.value='';
    };
    m.querySelector(`#${ZONE_SOURCE_FILE_ID}`).onchange=async e=>{
      const f=e.target.files&&e.target.files[0];if(!f)return;
      try{await importZoneSourceFile(f);}catch(err){alert(err.message||String(err));}
      e.target.value='';
    };
    return m;
  }


  /* PASS 206 [206-B] - THE GUIDED FLOW. Reece, V0.184 walk: "I do not think this
     tool is easy to use... we need to make it easy, user friendly." Each step is
     one screen, one main action, one line of plain words. The engine API
     underneath (start, detectTemplate, recognisePrintedIdentities,
     importScheduleFile, the zone workbench, commit) is untouched; these
     screens only call it. `uiStep` lives outside the session because step 1
     has no session yet. */
  let uiStep=1;
  let ocrOk=null;
  const SP_STEPS=['Start','Show one detector','Find and read','Panel schedule','Zone plan','Review','Commit'];
  const SP_PICTURE=`<div class="spPic"><figure><svg viewBox="0 0 150 90" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="142" height="78" fill="none" stroke="#bbb" stroke-width="1"/><path d="M4 46 H60 M60 6 V84 M100 46 H146" stroke="#ccc" stroke-width="1" fill="none"/><rect x="22" y="26" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M24 28 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><rect x="70" y="24" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M72 26 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><rect x="118" y="30" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M120 32 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><rect x="46" y="66" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M48 68 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><rect x="96" y="68" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M98 70 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><rect x="19" y="23" width="15" height="15" fill="none" stroke="#1e88e5" stroke-width="1.6" stroke-dasharray="3 2"/></svg><figcaption>1 &middot; you draw a box around ONE</figcaption></figure><figure><svg viewBox="0 0 150 90" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="142" height="78" fill="none" stroke="#bbb" stroke-width="1"/><path d="M4 46 H60 M60 6 V84 M100 46 H146" stroke="#ccc" stroke-width="1" fill="none"/><rect x="22" y="26" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M24 28 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><circle cx="26.5" cy="30.5" r="8" fill="none" stroke="#00a65a" stroke-width="1.6"/><rect x="70" y="24" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M72 26 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><circle cx="74.5" cy="28.5" r="8" fill="none" stroke="#00a65a" stroke-width="1.6"/><rect x="118" y="30" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M120 32 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><circle cx="122.5" cy="34.5" r="8" fill="none" stroke="#00a65a" stroke-width="1.6"/><rect x="46" y="66" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M48 68 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><circle cx="50.5" cy="70.5" r="8" fill="none" stroke="#00a65a" stroke-width="1.6"/><rect x="96" y="68" width="9" height="9" fill="none" stroke="#c62828" stroke-width="1.6"/><path d="M98 70 l5 2 l-5 2" fill="none" stroke="#c62828" stroke-width="1.2"/><circle cx="100.5" cy="72.5" r="8" fill="none" stroke="#00a65a" stroke-width="1.6"/></svg><figcaption>2 &middot; Smart Plan finds the rest</figcaption></figure></div>`;
  /* [206-C] the app BRAND, not the OCR probe: EverDue is the register app and
     does not expose the Workspace as a product feature. */
  function appIsEverDue(){
    try{if(typeof FS_MS_DIR!=='undefined')return String(FS_MS_DIR).trim().toLowerCase()==='everdue';}catch(_){}
    try{const m=document.querySelector('meta[name="apple-mobile-web-app-title"]');if(m&&/everdue/i.test(m.content||''))return true;}catch(_){}
    return /everdue/i.test(document.title||'');
  }
  function probeOcr(){
    if(ocrOk!==null)return;
    if(typeof fsOcrProbe!=='function'){ocrOk=false;return;}
    try{fsOcrProbe().then(ok=>{ocrOk=!!ok;render();}).catch(()=>{ocrOk=false;render();});}catch(_){ocrOk=false;}
  }
  /* PASS 210 [210-D] - what the reader did, in words he can copy */
  function spReadDiag(){
    const r=session&&session.ocrReport;if(!r||!r.phases)return null;
    const p=r.phases,s=r.summary||{};const st=p.strip||{};
    const style=st.adopted?'bare numbers (strips)':(st.skipped?'L01.D40 labels (wide passes)':(p.probe?'no style adopted - fell back to the wide passes':'wide passes'));
    const looks=(st.crops||0)+((p.probe&&p.probe.crops)||0)+((p.center&&p.center.crops)||0)+((p.offset&&p.offset.crops)||0)+((p.quadrant&&p.quadrant.crops)||0);
    return {style,looks,agreed:st.reads||0,readCandidates:st.readCandidates||0,applied:s.applied||0,withheld:s.withheld||0,unread:s.unread||0,ms:s.elapsedMs||0,
      text:JSON.stringify({version:VERSION,ua:(typeof navigator!=='undefined'&&navigator.userAgent)||'',plan:currentDims(),candidates:session.candidates.length,summary:s,phases:p},null,1)};
  }
  function spGo(step){uiStep=Math.max(1,Math.min(SP_STEPS.length,step));render();}
  /* PASS 209 [209-A] - a progress tick touches the status line, the bar and the
     footer. It never rebuilds the panes: the full render() tore the plan canvas
     down on every tick, and a finger on the just-rebuilt canvas measured 0x0. */
  function spBarValue(p){if(!p||!p.total)return 0;const f=p.phases>1?(Number(p.phase)||0)/p.phases+(p.done/p.total)/p.phases:p.done/p.total;return Math.round(100*Math.max(0,Math.min(1,f)));}
  function spTick(){
    const m=document.getElementById(MODAL_ID);if(!m||!session)return;
    const text=session.detectBusy?(session.detectStatus||'Detecting symbols…'):(session.ocrBusy?(session.ocrStatus||'Reading printed identities…'):'');
    const st=m.querySelector('[data-sp="status"]');if(st)st.textContent=text;
    const foot=m.querySelector('[data-sp="foot"]');if(foot&&text)foot.textContent=text;
    const bar=m.querySelector('[data-sp="bar"]');if(bar){const on=!!(session.progress&&session.progress.total);bar.style.display=on?'inline-block':'none';if(on)bar.value=spBarValue(session.progress);}
  }
  function spDiscardGuarded(){
    if(!session)return true;
    if(session.candidates.length&&!session.committed&&!confirm('Discard this uncommitted Smart Plan review?'))return false;
    discard();uiStep=1;return true;
  }
  function spClose(){const m=document.getElementById(MODAL_ID);if(m)m.style.display='none';}
  function spSheetName(){
    let site='';try{site=field(typeof fsSite!=='undefined'&&fsSite&&(fsSite.name||fsSite.siteName));}catch(_){}
    return (site?site+' — ':'')+candidateLevelName();
  }
  /* Step 1's "Import a different plan..." fires Arc's own Import-sheet door
     (the importsheet tile -> #btnOpenProj -> #projInput -> openAnyFile), which
     already takes a PDF or a photo. The modal steps aside while Arc's picker
     and crop screens run (they sit below it in z-order), and comes back to
     step 1 when the sheet has changed - or when the picker was dismissed. */
  function importPlanThenReturn(){
    const btn=document.getElementById('btnOpenProj'),inp=document.getElementById('projInput');
    if(!btn||typeof btn.onclick!=='function'){alert('The Import sheet tool is not available here.');return;}
    const live=livePlanImage(),before=live?live.src:'';const t0=Date.now();let changed=false,focused=false,idleSince=0;
    spClose();
    const onChange=()=>{changed=true;};if(inp)inp.addEventListener('change',onChange);
    const onFocus=()=>{focused=true;};window.addEventListener('focus',onFocus);
    const shown=el=>{try{return !!(el&&(el.classList.contains('show')||(el.style.display&&el.style.display!=='none'))&&el.getBoundingClientRect().width>0);}catch(_){return false;}};
    const busy=()=>shown(document.getElementById('fsRgnModal'))||shown(document.getElementById('photoModal'));
    let iv=0;
    const back=()=>{clearInterval(iv);if(inp)inp.removeEventListener('change',onChange);window.removeEventListener('focus',onFocus);uiStep=1;if(hostReady()&&workspaceOnScreen()){ensureModal().style.display='block';render();}};
    iv=setInterval(()=>{
      const now=livePlanImage(),src=now?now.src:'',t=Date.now();
      if(src!==before){back();return;}                                   /* the sheet changed: back to step 1, naming it */
      if(!changed&&focused&&t-t0>1500){back();return;}                   /* the file picker was dismissed */
      if(changed&&t-t0>1500){if(busy())idleSince=0;else{if(!idleSince)idleSince=t;else if(t-idleSince>1500)back();}}   /* Arc's crop / photo screens closed without a new sheet */
      if(t-t0>600000)back();
    },300);
    try{btn.onclick();}catch(e){back();alert(e.message||String(e));}
  }
  function spCaptionHtml(){
    const picking=!!(session&&session.templatePick&&session.templatePick.active);
    const pairing=!!(session&&session.zoneAlign&&session.zoneAlign.pending&&session.zoneAlign.pending.source);
    const txt=picking?'Drag a tight box around ONE detector here. Pinch or scroll to zoom first; two fingers pan.':(pairing?'Now tap the matching point on THIS plan.':(session&&session.candidates.length?'Green = found. Amber = needs a look. Blue box = the one you showed.':'The plan on screen. Pinch or scroll to zoom, drag to pan.'));
    return '<div class="spCaption'+((picking||pairing)?' on':'')+'" data-sp="caption">'+escapeHtml(txt)+'</div>';
  }
  function spStepHead(){
    const m=ensureModal(),el=m.querySelector('[data-sp="stepno"]');
    if(el)el.textContent=`Step ${uiStep} of ${SP_STEPS.length} · ${SP_STEPS[uiStep-1]}`;
  }
  function spNav(left,opts){
    opts=opts||{};
    const nav=document.createElement('div');nav.className='spNav';
    const back=document.createElement('button');back.className='btn';back.setAttribute('data-sp','back');back.textContent=uiStep===1?'Close':'Back';
    back.onclick=()=>{
      if(uiStep===1){if(spDiscardGuarded())spClose();return;}
      if(uiStep===2){if(spDiscardGuarded()){ensureModal().style.display='block';render();}return;}
      spGo(uiStep-1);
    };
    nav.appendChild(back);
    if(opts.next){const nx=document.createElement('button');nx.className='btn'+(opts.nextPrimary?' spPrimary':'');nx.setAttribute('data-sp','next');nx.textContent=opts.next;nx.disabled=!!opts.nextDisabled;nx.onclick=()=>spGo(uiStep+1);nav.appendChild(nx);}
    left.appendChild(nav);
  }
  function previewNoSession(){
    const right=ensureModal().querySelector('[data-sp="right"]');
    const live=livePlanImage();
    if(!live){right.innerHTML='<div class="spHint">No plan is on screen yet. Use <b>Import a different plan…</b> to bring one in.</div>';return;}
    right.innerHTML='<div style="font-weight:700;margin-bottom:8px">This is the plan Smart Plan will read</div><canvas data-sp="canvas" width="900" height="620"></canvas>';
    const cv=right.querySelector('canvas'),ctx=cv.getContext('2d'),dims=currentDims();
    const sw=dims.w||cv.width,sh=dims.h||cv.height,scale=Math.min(cv.width/sw,cv.height/sh),ox=(cv.width-sw*scale)/2,oy=(cv.height-sh*scale)/2;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);try{ctx.drawImage(live,ox,oy,sw*scale,sh*scale);}catch(_){}
  }


  /* PASS 208 [208-A] W208-A - ZOOM AND PAN. Reece, V0.185 walk b2: "I need to be
     able to zoom and pan on the plan to the right I'm too far zoomed out to drag
     a box accurately." One view per preview canvas, composed onto the fit
     geometry so every draw / hit line below keeps its (g.ox + x * g.scale) shape.
     k = 1 is fit-all; pinch or wheel zooms about the pointer; one finger pans -
     unless the step is a DRAW step (the detector box, a hatch patch), where one
     finger draws and two fingers still pinch. Taps stay taps. */
  const PV_MIN_K=1, PV_MAX_K=12;
  const pvMain={k:1,tx:0,ty:0}, pvZone={k:1,tx:0,ty:0};
  let spCenterMain=null;  /* [209-F] set by preview(); centres the plan on a candidate */
  function pvReset(v){v.k=1;v.tx=0;v.ty=0;}
  function pvGeometry(cv,view,sw,sh){
    const s0=Math.min(cv.width/sw,cv.height/sh),ox0=(cv.width-sw*s0)/2,oy0=(cv.height-sh*s0)/2;
    return {sw,sh,scale:s0*view.k,ox:ox0*view.k+view.tx,oy:oy0*view.k+view.ty,fit:s0};
  }
  function pvClamp(cv,view,sw,sh){
    if(!(Number.isFinite(view.k)&&Number.isFinite(view.tx)&&Number.isFinite(view.ty))){pvReset(view);return;}  /* [209-B] NaN never sticks */
    view.k=Math.max(PV_MIN_K,Math.min(PV_MAX_K,view.k));
    if(view.k===1){view.tx=0;view.ty=0;return;}
    const g=pvGeometry(cv,view,sw,sh),w=g.sw*g.scale,h=g.sh*g.scale;
    /* keep at least a quarter of the plan on the canvas in each axis */
    const minX=cv.width*0.25-w,maxX=cv.width*0.75,minY=cv.height*0.25-h,maxY=cv.height*0.75;
    const ox=Math.max(minX,Math.min(maxX,g.ox)),oy=Math.max(minY,Math.min(maxY,g.oy));
    view.tx+=ox-g.ox;view.ty+=oy-g.oy;
  }
  function pvZoomAt(cv,view,sw,sh,cx,cy,factor){
    const k0=view.k,k1=Math.max(PV_MIN_K,Math.min(PV_MAX_K,k0*factor));if(k1===k0)return;
    /* keep the plan point under (cx,cy) fixed */
    const g=pvGeometry(cv,view,sw,sh),px=(cx-g.ox)/g.scale,py=(cy-g.oy)/g.scale;
    view.k=k1;const g1=pvGeometry(cv,view,sw,sh);
    view.tx+=cx-(g1.ox+px*g1.scale);view.ty+=cy-(g1.oy+py*g1.scale);
    pvClamp(cv,view,sw,sh);
  }
  function pvToolbarHtml(key){
    return '<div class="spPvBar" data-pv="'+key+'"><button type="button" class="btn" data-pv-act="out" title="Zoom out">−</button><button type="button" class="btn" data-pv-act="fit" title="Fit the whole plan">Fit</button><button type="button" class="btn" data-pv-act="in" title="Zoom in">+</button><span class="spPvPct" data-pv-pct></span></div>';
  }
  /* pointer plumbing for one canvas. opts: {view,sw,sh,drawMode():bool,
     onDrawStart(c),onDrawMove(c),onDrawEnd(c),onTap(c),redraw()} - c is canvas px. */
  function pvAttach(cv,bar,opts){
    const view=opts.view,pointers=new Map();let pinch=null,pan=null,drawing=false,tapStart=null;
    /* [209-B] a canvas mid-relayout measures 0x0: that event is ignored, never divided by */
    const cpos=e=>{const r=cv.getBoundingClientRect();if(!(r.width>0&&r.height>0))return null;const p={x:(e.clientX-r.left)*cv.width/r.width,y:(e.clientY-r.top)*cv.height/r.height};return (Number.isFinite(p.x)&&Number.isFinite(p.y))?p:null;};
    const pct=()=>{const el=bar&&bar.querySelector('[data-pv-pct]');if(el)el.textContent=Math.round(view.k*100)+'%';};
    const redraw=()=>{pvClamp(cv,view,opts.sw,opts.sh);pct();opts.redraw();};
    if(bar){bar.querySelector('[data-pv-act="in"]').onclick=()=>{pvZoomAt(cv,view,opts.sw,opts.sh,cv.width/2,cv.height/2,1.5);redraw();};
      bar.querySelector('[data-pv-act="out"]').onclick=()=>{pvZoomAt(cv,view,opts.sw,opts.sh,cv.width/2,cv.height/2,1/1.5);redraw();};
      bar.querySelector('[data-pv-act="fit"]').onclick=()=>{pvReset(view);redraw();};pct();}
    cv.style.touchAction='none';
    cv.onwheel=e=>{e.preventDefault();const c=cpos(e);if(!c)return;pvZoomAt(cv,view,opts.sw,opts.sh,c.x,c.y,e.deltaY<0?1.2:1/1.2);redraw();};
    cv.onpointerdown=e=>{
      const c=cpos(e);if(!c)return;pointers.set(e.pointerId,c);try{cv.setPointerCapture&&cv.setPointerCapture(e.pointerId);}catch(_){}
      if(pointers.size===2){
        /* second finger: whatever one finger was doing becomes a pinch */
        if(drawing){drawing=false;opts.onDrawCancel&&opts.onDrawCancel();}
        pan=null;tapStart=null;const [a,b]=[...pointers.values()];
        pinch={d:Math.hypot(a.x-b.x,a.y-b.y),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},k:view.k,tx:view.tx,ty:view.ty};return;
      }
      if(pointers.size>2)return;
      tapStart={x:c.x,y:c.y,t:Date.now()};
      if(opts.drawMode&&opts.drawMode()){drawing=true;opts.onDrawStart(c);}
      else if(opts.grab&&opts.grab(c)){drawing=true;}  /* [209-E] a corner handle */
      else pan={x:c.x,y:c.y,tx:view.tx,ty:view.ty};
    };
    cv.onpointermove=e=>{
      if(!pointers.has(e.pointerId))return;const c=cpos(e);if(!c)return;pointers.set(e.pointerId,c);
      if(pinch&&pointers.size>=2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        view.k=pinch.k;view.tx=pinch.tx;view.ty=pinch.ty;pvZoomAt(cv,view,opts.sw,opts.sh,pinch.mid.x,pinch.mid.y,d/(pinch.d||1));view.tx+=mid.x-pinch.mid.x;view.ty+=mid.y-pinch.mid.y;redraw();return;}
      if(drawing){opts.onDrawMove(c);return;}
      if(pan){view.tx=pan.tx+(c.x-pan.x);view.ty=pan.ty+(c.y-pan.y);redraw();}
    };
    const up=e=>{
      const had=pointers.has(e.pointerId);const c=had?cpos(e):null;pointers.delete(e.pointerId);
      if(pinch){if(pointers.size<2){pinch=null;pan=null;}return;}
      if(!had)return;
      if(drawing){drawing=false;if(c)opts.onDrawEnd(c);else if(opts.onDrawCancel)opts.onDrawCancel();return;}
      const moved=!c||(tapStart&&Math.hypot(c.x-tapStart.x,c.y-tapStart.y)>6*(cv.width/Math.max(1,cv.getBoundingClientRect().width)));
      pan=null;
      if(tapStart&&!moved&&opts.onTap)opts.onTap(c);
      tapStart=null;
    };
    cv.onpointerup=up;cv.onpointercancel=e=>{pointers.delete(e.pointerId);pinch=null;pan=null;if(drawing){drawing=false;opts.onDrawCancel&&opts.onDrawCancel();}};
  }

  function livePlanImage() {
    try {
      if (typeof img !== 'undefined' && img && ((img.naturalWidth || img.width) > 0)) return img;
    } catch (_) {}
    return null;
  }

  function preview() {
    /* PASS 208 [208-A] - zoom and pan on both previews; see pvAttach above. */
    const right=ensureModal().querySelector('[data-sp="right"]');
    const hasZone=!!(session&&session.zoneSource);
    right.innerHTML='<div class="spPvHead"><div style="font-weight:700">The plan</div>'+pvToolbarHtml('main')+'</div><canvas data-sp="canvas" width="1400" height="965"></canvas>'+spCaptionHtml()+''+(hasZone?'<div class="spSourceCanvas"><div class="spPvHead"><div style="font-weight:700">The zone plan</div>'+pvToolbarHtml('zone')+'</div><canvas data-sp="zone-canvas" width="1400" height="965"></canvas><div class="spCaption">Show hatching, draw zones and pick match points here. Pinch or scroll to zoom, drag to pan. This sheet is never written into the plan or the register.</div></div>':'');
    const cv=right.querySelector('[data-sp="canvas"]'),ctx=cv.getContext('2d');const dims=currentDims();
    const geometry=()=>{const sw=dims.w||cv.width,sh=dims.h||cv.height;return pvGeometry(cv,pvMain,sw,sh);};
    const LW=cv.width/900;   /* line weights were tuned on a 900-wide canvas */
    const drawAll=()=>{ctx.clearRect(0,0,cv.width,cv.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);const live=livePlanImage(),g=geometry();if(live){try{ctx.drawImage(live,g.ox,g.oy,g.sw*g.scale,g.sh*g.scale)}catch(_){}}
      session.zones.forEach(zc=>{if(zc.decision==='rejected')return;const z=zc.obj,pts=z.pts||[];if(pts.length<3)return;ctx.save();ctx.strokeStyle=zc.decision==='accepted'?'#7e57c2':'#ffb300';ctx.lineWidth=2*LW;ctx.beginPath();pts.forEach((p,i)=>{const x=g.ox+p.x*g.scale,y=g.oy+p.y*g.scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.stroke();ctx.restore();});
      session.candidates.forEach(c=>{if(c.decision==='rejected')return;const x=g.ox+c.obj.x*g.scale,y=g.oy+c.obj.y*g.scale;ctx.save();ctx.strokeStyle=c.meta&&c.meta.suspectStub?'#ff7043':(c.decision==='review'?'#ffb300':'#00a65a');ctx.lineWidth=2*LW;ctx.beginPath();ctx.arc(x,y,7*LW,0,Math.PI*2);ctx.stroke();if(c.meta&&Array.isArray(c.meta.bbox)){const b=c.meta.bbox;ctx.globalAlpha=.7;ctx.strokeRect(g.ox+b[0]*g.scale,g.oy+b[1]*g.scale,b[2]*g.scale,b[3]*g.scale);}ctx.restore();});
      (session.zoneAlign&&session.zoneAlign.pairs||[]).forEach((p,i)=>{ctx.save();ctx.fillStyle='#e040fb';ctx.strokeStyle='#fff';ctx.lineWidth=1*LW;const x=g.ox+p.target.x*g.scale,y=g.oy+p.target.y*g.scale;ctx.beginPath();ctx.arc(x,y,6*LW,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#e040fb';ctx.font=`bold ${Math.round(12*LW)}px sans-serif`;ctx.fillText(`T${i+1}`,x+8*LW,y-7*LW);ctx.restore();});
      const p=session.templatePick;if(p&&p.start&&p.end){ctx.save();ctx.strokeStyle='#40c4ff';ctx.setLineDash([6*LW,4*LW]);ctx.lineWidth=2*LW;ctx.strokeRect(Math.min(p.start.x,p.end.x),Math.min(p.start.y,p.end.y),Math.abs(p.end.x-p.start.x),Math.abs(p.end.y-p.start.y));ctx.restore();}const tb=session.taughtBox;if(tb&&!(p&&p.start)){ctx.save();ctx.strokeStyle='#1e88e5';ctx.setLineDash([6*LW,4*LW]);ctx.lineWidth=2*LW;ctx.strokeRect(g.ox+tb[0]*g.scale,g.oy+tb[1]*g.scale,tb[2]*g.scale,tb[3]*g.scale);ctx.restore();
        if(uiStep===2&&!(session.templatePick&&session.templatePick.active)){/* [209-E] handles */ctx.save();ctx.fillStyle='#1e88e5';ctx.strokeStyle='#fff';ctx.lineWidth=2*LW;const R=10*LW;[[tb[0],tb[1]],[tb[0]+tb[2],tb[1]],[tb[0],tb[1]+tb[3]],[tb[0]+tb[2],tb[1]+tb[3]]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(g.ox+x*g.scale,g.oy+y*g.scale,R,0,Math.PI*2);ctx.fill();ctx.stroke();});ctx.restore();}}
      if(session.focusId){/* [209-F] the row he tapped */const fc=session.candidates.find(c=>c.id===session.focusId);if(fc){const x=g.ox+fc.obj.x*g.scale,y=g.oy+fc.obj.y*g.scale;ctx.save();ctx.strokeStyle='#e040fb';ctx.lineWidth=3*LW;ctx.beginPath();ctx.arc(x,y,14*LW,0,Math.PI*2);ctx.stroke();ctx.restore();}}};
    drawAll();
    const toPlan=c=>{const g=geometry();return {x:(c.x-g.ox)/g.scale,y:(c.y-g.oy)/g.scale};};
    const picking=()=>!!(session&&session.templatePick&&session.templatePick.active);
    /* [209-E] corner handles on the drawn box (step 2, not while drawing) */
    const handleCorners=()=>{const tb=session.taughtBox;if(!tb||uiStep!==2||picking())return null;const g=geometry();const x0=g.ox+tb[0]*g.scale,y0=g.oy+tb[1]*g.scale,x1=g.ox+(tb[0]+tb[2])*g.scale,y1=g.oy+(tb[1]+tb[3])*g.scale;return [{k:'nw',x:x0,y:y0},{k:'ne',x:x1,y:y0},{k:'sw',x:x0,y:y1},{k:'se',x:x1,y:y1}];};
    const grabHandle=c=>{const hs=handleCorners();if(!hs)return false;const r=22*(cv.width/Math.max(1,cv.getBoundingClientRect().width));let h=null,best=r+1;hs.forEach(k=>{const d=Math.hypot(k.x-c.x,k.y-c.y);if(d<=r&&d<best){best=d;h=k;}});if(!h)return false;session.boxDrag={corner:h.k,box:session.taughtBox.slice()};return true;};
    const moveHandle=c=>{const d=session.boxDrag;if(!d)return;const g=geometry(),p=toPlan(c),b=d.box;let x0=b[0],y0=b[1],x1=b[0]+b[2],y1=b[1]+b[3];if(d.corner==='nw'){x0=p.x;y0=p.y;}else if(d.corner==='ne'){x1=p.x;y0=p.y;}else if(d.corner==='sw'){x0=p.x;y1=p.y;}else{x1=p.x;y1=p.y;}const nb=[clamp(Math.min(x0,x1),0,g.sw),clamp(Math.min(y0,y1),0,g.sh),0,0];nb[2]=clamp(Math.max(x0,x1),0,g.sw)-nb[0];nb[3]=clamp(Math.max(y0,y1),0,g.sh)-nb[1];session.taughtBox=nb;drawAll();};
    const finishHandle=()=>{const d=session.boxDrag;if(!d)return;session.boxDrag=null;const nb=session.taughtBox;if(nb[2]<6||nb[3]<6){session.taughtBox=d.box;drawAll();return;}if(session.teach)session.teach.bbox=nb.slice();session.findDone=null;drawAll();};
    spCenterMain=(x,y)=>{const sw=dims.w||cv.width,sh=dims.h||cv.height;pvMain.k=Math.max(pvMain.k,4);const g0=pvGeometry(cv,{k:pvMain.k,tx:0,ty:0},sw,sh);pvMain.tx=cv.width/2-(g0.ox+x*g0.scale);pvMain.ty=cv.height/2-(g0.oy+y*g0.scale);pvClamp(cv,pvMain,sw,sh);const b=right.querySelector('.spPvBar[data-pv="main"] [data-pv-pct]');if(b)b.textContent=Math.round(pvMain.k*100)+'%';drawAll();};
    cv.style.cursor=picking()?'crosshair':((session.zoneAlign&&session.zoneAlign.pending&&session.zoneAlign.pending.source)?'crosshair':'grab');
    pvAttach(cv,right.querySelector('.spPvBar[data-pv="main"]'),{view:pvMain,sw:dims.w||cv.width,sh:dims.h||cv.height,redraw:drawAll,
      drawMode:picking,grab:grabHandle,
      onDrawStart:c=>{session.templatePick.start=c;session.templatePick.end=c;drawAll();},
      onDrawMove:c=>{if(session.boxDrag){moveHandle(c);return;}if(!session.templatePick||!session.templatePick.start)return;session.templatePick.end=c;drawAll();},
      onDrawCancel:()=>{if(session&&session.boxDrag){session.taughtBox=session.boxDrag.box;session.boxDrag=null;drawAll();return;}if(session&&session.templatePick){session.templatePick.start=null;session.templatePick.end=null;drawAll();}},
      onDrawEnd:c=>{if(session.boxDrag){finishHandle();return;}if(!session.templatePick||!session.templatePick.start)return;session.templatePick.end=c;const p=clone(session.templatePick),g=geometry();session.templatePick=null;const x0=(Math.min(p.start.x,p.end.x)-g.ox)/g.scale,y0=(Math.min(p.start.y,p.end.y)-g.oy)/g.scale,x1=(Math.max(p.start.x,p.end.x)-g.ox)/g.scale,y1=(Math.max(p.start.y,p.end.y)-g.oy)/g.scale,bbox=[clamp(x0,0,g.sw),clamp(y0,0,g.sh),clamp(x1,0,g.sw)-clamp(x0,0,g.sw),clamp(y1,0,g.sh)-clamp(y0,0,g.sh)];/* [206-B] the box is RECORDED here; step 3's one button runs detect + read. A box under 6 px is a tap, not a box. */if(bbox[2]<6||bbox[3]<6){session.templatePick={active:true,type:p.type,signal:p.signal,threshold:p.threshold,includeMirrors:p.includeMirrors,start:null,end:null};render();alert('Drag a box around the detector — that was a tap. Zoom in first if it is small.');return;}let snapped=false;try{const tb=tightenTemplateBox(bbox,p.signal);if(tb.tightened){bbox.splice(0,4,...tb.bbox);snapped=true;}}catch(_){}  /* [211-B] */session.teach={type:p.type,signal:p.signal,threshold:p.threshold,includeMirrors:p.includeMirrors,bbox};session.taughtBox=bbox;session.boxSnapped=snapped;session.findDone=null;uiStep=2;render();}  /* [210-A] stay here: handles first, Next when he is happy */,
      onTap:c=>{if(session.zoneAlign&&session.zoneAlign.pending&&session.zoneAlign.pending.source){const p=toPlan(c);session.zoneAlign.pairs.push({source:session.zoneAlign.pending.source,target:p});session.zoneAlign.pending=null;updateZoneAlignment();render();}}
    });
    if(hasZone){const zv=right.querySelector('[data-sp="zone-canvas"]'),zctx=zv.getContext('2d'),zs=session.zoneSource,zw=zs.width,zh=zs.height;const ZLW=zv.width/900;
      const zg=()=>pvGeometry(zv,pvZone,zw,zh);
      const zdraw=()=>{const g=zg(),zscale=g.scale,zox=g.ox,zoy=g.oy;zctx.fillStyle='#fff';zctx.fillRect(0,0,zv.width,zv.height);zctx.drawImage(zs.canvas,zox,zoy,zw*zscale,zh*zscale);
        session.zoneRegions.forEach(r=>{if(r.decision==='rejected')return;zctx.save();zctx.strokeStyle=r.decision==='accepted'?'#00a65a':'#ffb300';zctx.lineWidth=2*ZLW;zctx.beginPath();r.pts.forEach((p,i)=>{const x=zox+p.x*zscale,y=zoy+p.y*zscale;i?zctx.lineTo(x,y):zctx.moveTo(x,y)});zctx.closePath();zctx.stroke();zctx.restore();});
        (session.zoneAlign&&session.zoneAlign.pairs||[]).forEach((p,i)=>{zctx.save();zctx.fillStyle='#e040fb';const x=zox+p.source.x*zscale,y=zoy+p.source.y*zscale;zctx.beginPath();zctx.arc(x,y,6*ZLW,0,Math.PI*2);zctx.fill();zctx.font=`bold ${Math.round(12*ZLW)}px sans-serif`;zctx.fillText(`S${i+1}`,x+8*ZLW,y-7*ZLW);zctx.restore();});
        if(session.zoneTool&&session.zoneTool.mode==='sample'&&session.zoneTool.start&&session.zoneTool.end){const a=session.zoneTool.start,b=session.zoneTool.end;zctx.save();zctx.strokeStyle='#40c4ff';zctx.setLineDash([6*ZLW,4*ZLW]);zctx.lineWidth=2*ZLW;zctx.strokeRect(zox+Math.min(a.x,b.x)*zscale,zoy+Math.min(a.y,b.y)*zscale,Math.abs(a.x-b.x)*zscale,Math.abs(a.y-b.y)*zscale);zctx.restore();}
        if(session.zoneTool&&session.zoneTool.mode==='polygon'&&session.zoneTool.points.length){zctx.save();zctx.strokeStyle='#40c4ff';zctx.lineWidth=2*ZLW;zctx.beginPath();session.zoneTool.points.forEach((p,i)=>{const x=zox+p.x*zscale,y=zoy+p.y*zscale;i?zctx.lineTo(x,y):zctx.moveTo(x,y)});zctx.stroke();zctx.restore();}};
      zdraw();
      const ztoPlan=c=>{const g=zg();return {x:(c.x-g.ox)/g.scale,y:(c.y-g.oy)/g.scale};};
      const sampling=()=>!!(session&&session.zoneTool&&session.zoneTool.mode==='sample');
      zv.style.cursor=(sampling()||(session.zoneTool&&session.zoneTool.mode==='polygon')||(session.zoneAlign&&session.zoneAlign.pending&&!session.zoneAlign.pending.source))?'crosshair':'grab';
      pvAttach(zv,right.querySelector('.spPvBar[data-pv="zone"]'),{view:pvZone,sw:zw,sh:zh,redraw:zdraw,
        drawMode:sampling,
        onDrawStart:c=>{const p=ztoPlan(c);session.zoneTool.start=p;session.zoneTool.end=p;zdraw();},
        onDrawMove:c=>{if(!session.zoneTool||!session.zoneTool.start)return;session.zoneTool.end=ztoPlan(c);zdraw();},
        onDrawCancel:()=>{if(session&&session.zoneTool){session.zoneTool.start=null;session.zoneTool.end=null;zdraw();}},
        onDrawEnd:c=>{const t=session.zoneTool;if(!t||!t.start)return;t.end=ztoPlan(c);const b=[Math.min(t.start.x,t.end.x),Math.min(t.start.y,t.end.y),Math.abs(t.start.x-t.end.x),Math.abs(t.start.y-t.end.y)];session.zoneTool=null;try{teachZoneHatch(t.zone,b,{window:t.window,threshold:t.threshold});}catch(err){alert(err.message||String(err));render();}},
        onTap:c=>{if(session.zoneTool&&session.zoneTool.mode==='polygon'){session.zoneTool.points.push(ztoPlan(c));render();}
          else if(session.zoneAlign&&session.zoneAlign.pending&&!session.zoneAlign.pending.source){session.zoneAlign.pending.source=ztoPlan(c);session.zoneStatus=`Source point picked. Now tap the matching point on the plan preview.`;render();}}
      });
    }
  }

  function render() {
    /* PASS 205 [205-B] - render() draws; only open() shows. A finishing OCR used to re-open the modal after Close. */
    /* PASS 206 [206-B] - one step per screen. See uiStep above. */
    const m=ensureModal();const left=m.querySelector('[data-sp="left"]'),foot=m.querySelector('[data-sp="foot"]'),commitBtn=m.querySelector('[data-sp="commit"]');
    if(ocrOk===null)probeOcr();
    if(!session){
      uiStep=1;spStepHead();pvReset(pvMain);pvReset(pvZone);
      const b0=m.querySelector('[data-sp="bar"]'),c0=m.querySelector('[data-sp="cancel"]');if(b0)b0.style.display='none';if(c0)c0.style.display='none';
      const live=livePlanImage();
      left.innerHTML=`<div class="spScreen"><h3>Smart Plan reads the plan that is on screen.</h3><p>Current sheet: <b data-sp="sheet">${escapeHtml(spSheetName())}</b></p><p>It finds every detector on it, reads the printed numbers and lets you check the lot before anything is saved.</p><button class="btn spPrimary spBig" data-sp="use" ${live?'':'disabled'}>Use this plan</button><button class="btn spQuiet" data-sp="importplan">Import a different plan…</button><p class="spHint">PDF or photo — both work. Nothing is written to the register until you press Commit at the end.</p></div>`;
      left.querySelector('[data-sp="use"]').onclick=()=>{try{uiStep=2;start({name:candidateLevelName()});}catch(e){uiStep=1;alert(e.message||String(e));}};
      left.querySelector('[data-sp="importplan"]').onclick=()=>importPlanThenReturn();
      spNav(left);
      previewNoSession();commitBtn.disabled=true;foot.textContent='Nothing has been started yet.';foot.title='';const d0=m.querySelector('[data-sp="discard"]');if(d0)d0.style.display='none';return;
    }
    /* a programmatic stage() with candidates (the harness door that stays) lands on Review */
    if(!session.uiFlow&&!session.uiSeen&&session.candidates.length){session.uiSeen=true;uiStep=6;}
    if(session.committed)uiStep=7;
    spStepHead();{const d1=m.querySelector('[data-sp="discard"]');if(d1)d1.style.display='';}
    refreshIssues();const s=summary();let types=[];try{types=Object.keys(TYPE_MAP||{})}catch(_){types=['smoke','thermal']};
    const teach=session.teach||{};
    const typeOptions=types.filter(Boolean).map(t=>`<option value="${escapeHtml(t)}"${teach.type===t?' selected':''}>${escapeHtml(arcTypeLabel(t))}</option>`).join('');
    const busy=!!(session.detectBusy||session.ocrBusy);
    let html='';
    if(uiStep===2){
      const picking=!!(session.templatePick&&session.templatePick.active);
      html=`<div class="spScreen"><h3>Show one detector</h3><p>Drag a box around <b>ONE</b> detector on the plan. Smart Plan finds every other one that looks like it.</p>${SP_PICTURE}<div class="spField spTypeRow"><label>Type of item</label><select data-sp="dtype">${typeOptions}</select></div><button class="btn spPrimary spBig" data-sp="teach" ${picking||busy?'disabled':''}>${picking?'Now drag the box on the plan →':(session.teach?'Draw the box again':'Draw the box on the plan')}</button>${(session.teach&&!picking)?`<div class="spDone">${session.boxSnapped?'Box snapped to the symbol - the printed number stays outside it, where the reader looks. ':'Box drawn. '}Drag a corner on the plan to adjust it, draw it again, or press Next.</div>`:''}${picking?'<div class="spWarn">Zoom in on the plan first (pinch, scroll, or the + button), then drag from one corner of the detector to the opposite corner. Keep the box tight.</div>':''}${session.candidates.length?`<div class="spDone">${s.total} already found. Showing another detector adds to them.</div>`:''}<details data-sp="advanced"><summary>Advanced (usually not needed)</summary><div class="spField"><label>Signal</label><select data-sp="signal"><option value="auto">Auto</option><option value="red">Red ink</option><option value="ink">Dark / colour ink</option></select></div><div class="spField"><label>Sensitivity (0.35–0.95)</label><input data-sp="threshold" type="number" min="0.35" max="0.95" step="0.01" value="${DETECT_DEFAULT_THRESHOLD}"></div><label class="spCheck" style="min-height:36px"><input data-sp="mirrors" type="checkbox"> Also look for mirrored copies</label></details></div>`;
    }else if(uiStep===3){
      const t=session.teach;const done=session.findDone;
      const status=session.detectBusy?(session.detectStatus||'Detecting symbols…'):(session.ocrBusy?(session.ocrStatus||'Reading printed identities…'):'');
      const reader=ocrOk===false?'<div class="spWarn" data-sp="noocr">This app does not include the label reader — the numbers are typed in at Review.</div>':'';
      const btnLabel=ocrOk===false?'Find the rest':'Find the rest and read their numbers';
      html=`<div class="spScreen"><h3>Find and read</h3><p>Smart Plan will find every detector like the one you showed it${ocrOk===false?'':', then read the number printed next to each'}. This can take a few minutes on a big sheet — Cancel is in the footer.</p>${reader}${t?'':'<div class="spWarn">Show one detector first (Back).</div>'}<button class="btn spPrimary spBig" data-sp="findread" ${(!t||busy||session.committed)?'disabled':''}>${btnLabel}</button>${status?`<div class="spWarn" data-sp="status">${escapeHtml(status)}</div>`:''}${done?`<div class="spDone" data-sp="found">Found <b>${done.kept}</b> detector${done.kept===1?'':'s'}${done.read!=null?` · read <b>${done.read}</b> number${done.read===1?'':'s'}`:''}.${done.kept?'':' Try a tighter box, or a different detector, under Show one detector.'}${(()=>{const d=spReadDiag();if(!d||done.read==null)return '';return ` Reader: ${escapeHtml(d.style)}, ${d.looks} looks, ${d.agreed} agreed read${d.agreed===1?'':'s'} on ${d.readCandidates} symbol${d.readCandidates===1?'':'s'}, ${d.applied} applied, ${d.withheld} held for Review, ${Math.round(d.ms/1000)} s.<details data-sp="diag"><summary>Diagnostics (copy this to Claude if the numbers look wrong)</summary><textarea readonly data-sp="diagtext" style="width:100%;min-height:120px;font-size:11px">${escapeHtml(d.text)}</textarea></details>`;})()}</div>`:''}<button class="btn spQuiet" data-sp="another" ${busy?'disabled':''}>Show a different detector type</button></div>`;
    }else if(uiStep===4){
      html=`<div class="spScreen"><h3>Panel schedule <span class="spHint">(optional)</span></h3><p>Have the panel's device list? Load it and Smart Plan checks every number against it.</p><button class="btn spPrimary spBig" data-sp="schedule">${session.schedule.length?'Load a different list…':'Load the device list…'}</button><p class="spHint">CSV, TSV, TXT, JSON or XLSX — the same file the Annuals tool takes.</p><div data-sp="recon"></div>${session.schedule.length?'<button class="btn spQuiet" data-sp="reconcile">Check again</button>':''}</div>`;
    }else if(uiStep===5){
      const z=session.zoneSource;
      html=`<div class="spScreen"><h3>Zone plan <span class="spHint">(optional)</span></h3><p>Zones drawn on a separate sheet? Load it and Smart Plan carries the zones across onto this plan.</p><button class="btn ${z?'':'spPrimary'} spBig" data-sp="zone-source">${z?'Load a different zone plan…':'Load the zone plan…'}</button>${z?`<div class="spZoneWork"><div class="spHint" style="margin-bottom:6px">1 · Tell Smart Plan what each zone looks like — type the zone number, then either show it a patch of that zone's hatching or draw the zone by hand.</div><div class="spZoneGrid"><input data-sp="zone-no" placeholder="Zone" maxlength="5" inputmode="numeric"><input data-sp="zone-window" type="number" min="5" step="2" placeholder="Window"><input data-sp="zone-threshold" type="number" min="0.001" max="0.2" step="0.001" placeholder="Density: Auto"><button class="btn" data-sp="zone-sample">Show a patch of hatching</button><button class="btn" data-sp="zone-poly">Draw the zone by hand</button><button class="btn" data-sp="zone-finish">Finish the drawn zone</button><button class="btn" data-sp="zone-detect">Find the coloured zones</button></div><div class="spHint" style="margin:10px 0 6px">2 · Match three points that appear on BOTH plans (a corner, a door, a column) so the zones land in the right place.</div><div class="spActions"><button class="btn" data-sp="zone-pair">Match a point on both plans</button><button class="btn" data-sp="zone-undo-pair">Undo last match</button></div><div class="spHint" style="margin:10px 0 6px">3 · Bring the kept zones across. They arrive at Review.</div><button class="btn spPrimary spBig" data-sp="zone-transfer">Bring the zones across</button><div data-sp="zone-work-status"></div><div data-sp="zone-regions"></div></div>`:''}<div data-sp="zones"></div></div>`;
    }else if(uiStep===6){
      html=`<div class="spScreen"><h3>Review</h3><p>Every row is a detector Smart Plan found. Fix a number, change a type, or reject a row. Rows with a flag need a look.</p><div class="spStats"><div class="spStat"><strong>${s.total}</strong><span>found</span></div><div class="spStat"><strong>${s.accepted}</strong><span>accepted</span></div><div class="spStat"><strong>${s.review}</strong><span>to check</span></div><div class="spStat"><strong>${s.rejected}</strong><span>rejected</span></div><div class="spStat"><strong>${s.numbered}</strong><span>numbered</span></div></div><div class="spActions">${(()=>{const n=session.candidates.filter(c=>c.decision!=='rejected'&&!c.issues.length).length;return `<button class="btn" data-sp="safe" ${n?'':'disabled'}>${n?`Accept the ${n} without issues`:'Nothing to accept yet'}</button>${n?'':'<span class="spHint" data-sp="safe-why">Every row still has an issue - most need a number. Read them, or tap a row and type it.</span>'}`;})()}${(()=>{const m=session.candidates.filter(c=>c.decision!=='rejected').length;return `<button class="btn" data-sp="acceptall" ${m?'':'disabled'} title="Every row that is not rejected, flagged or not">Accept all ${m}</button>`;})()}<button class="btn" data-sp="review">Show flagged only</button><button class="btn" data-sp="all">Show all</button>${ocrOk===false?'':'<button class="btn" data-sp="ocr">Read printed numbers</button>'}</div><div data-sp="zones"></div><p class="spHint" data-sp="legend">Issues: a tick means nothing to fix; a number is how many things to check - they are listed under the row. Tap a row to see that detector on the plan.</p><div class="spColHead"><span>Issues</span><span>Type</span><span>Zone</span><span>Loop</span><span>Device</span><span>Decision</span></div><div data-sp="rows"></div></div>`;
    }else{
      const blockers=session.candidates.filter(c=>c.decision==='accepted'&&c.issues.some(x=>x.level==='error')).length;
      html=`<div class="spScreen"><h3>Commit</h3>${session.committed?`<div class="spDone">Committed. ${s.total} candidate(s) were reviewed. The devices are on the plan - Close Smart Plan, or start another plan.</div>`:`<p><b>${s.accepted}</b> detector${s.accepted===1?'':'s'}${s.zoneAccepted?` and <b>${s.zoneAccepted}</b> zone${s.zoneAccepted===1?'':'s'}`:''} will be added to the plan.${s.review?` <b>${s.review}</b> still at Review will be left out.`:''}${s.rejected?` ${s.rejected} rejected.`:''}</p>${blockers?`<div class="spWarn">${blockers} accepted row${blockers===1?' has':'s have'} a blocking issue — go Back to Review and fix or reject ${blockers===1?'it':'them'}.</div>`:''}${s.zoneReview?`<div class="spWarn">${s.zoneReview} zone${s.zoneReview===1?' is':'s are'} still at Review — accept or reject ${s.zoneReview===1?'it':'them'} on the Zone plan step.</div>`:''}<p>Nothing has been written yet. Commit adds them in one step — one Undo takes the lot back out.</p><button class="btn spPrimary spBig" data-sp="commitbig">Commit to Workspace</button>`}</div>`;
    }
    left.innerHTML=html;
    /* ---- wiring, by step ---- */
    const q=sel=>left.querySelector(sel);
    if(uiStep===2){
      const dt=q('[data-sp="dtype"]');const pickType=session.templatePick&&session.templatePick.type;if(dt&&(pickType||teach.type))dt.value=pickType||teach.type;  /* [213-B] the pick's own type wins over the last taught one */
      if(dt)dt.onchange=()=>{if(session&&session.templatePick)session.templatePick.type=dt.value;if(session&&session.teach)session.teach.type=dt.value;};
      q('[data-sp="teach"]').onclick=()=>{const type=dt.value,signal=(q('[data-sp="signal"]')||{}).value||'auto',threshold=Number((q('[data-sp="threshold"]')||{}).value)||DETECT_DEFAULT_THRESHOLD,includeMirrors=!!(q('[data-sp="mirrors"]')||{}).checked;session.templatePick={active:true,type,signal,threshold,includeMirrors,start:null,end:null};render();try{if(window.innerWidth<=820){const rp=m.querySelector('[data-sp="right"]');if(rp&&rp.scrollIntoView)rp.scrollIntoView({behavior:'smooth',block:'start'});}}catch(_){}};
      const sg=q('[data-sp="signal"]');if(sg&&teach.signal)sg.value=teach.signal;const th=q('[data-sp="threshold"]');if(th&&teach.threshold)th.value=teach.threshold;const mr=q('[data-sp="mirrors"]');if(mr)mr.checked=!!teach.includeMirrors;
      spNav(left,{next:'Next: Find and read',nextDisabled:!session.teach,nextPrimary:!!session.teach});
    }else if(uiStep===3){
      q('[data-sp="findread"]').onclick=async()=>{
        const t=session.teach;if(!t)return;session.uiFlow=true;session.findDone=null;
        try{
          const r=await detectTemplate({type:t.type,signal:t.signal,threshold:t.threshold,includeMirrors:t.includeMirrors,bbox:t.bbox});
          if(!session||r===null)return;                       /* cancelled: nothing was added */
          const kept=r&&r.summary?r.summary.kept:0;let read=null;
          if(ocrOk!==false&&session.candidates.some(c=>c.decision!=='rejected')){
            const o=await recognisePrintedIdentities();
            if(!session)return;
            if(o===null){session.findDone={kept,read:null};render();return;}
            read=o&&o.summary?(o.summary.applied||0):0;
          }
          if(session){session.findDone={kept,read};render();}
        }catch(e){if(session){session.detectBusy=false;session.ocrBusy=false;session.detectStatus='';session.ocrStatus='';render();}alert(e.message||String(e));}
      };
      q('[data-sp="another"]').onclick=()=>spGo(2);
      spNav(left,{next:session.findDone?'Next: Panel schedule':'Skip to Review',nextPrimary:!!session.findDone,nextDisabled:busy});
      if(!session.findDone){const nx=left.querySelector('[data-sp="next"]');if(nx)nx.onclick=()=>spGo(6);}
    }else if(uiStep===4){
      q('[data-sp="schedule"]').onclick=()=>m.querySelector(`#${SCHEDULE_FILE_ID}`).click();
      const rc=q('[data-sp="reconcile"]');if(rc)rc.onclick=()=>{try{reconcileSchedule(true);render();}catch(e){alert(e.message||String(e));}};
      renderReconciliation();
      spNav(left,{next:session.schedule.length?'Next: Zone plan':'Skip',nextPrimary:!!session.schedule.length});
    }else if(uiStep===5){
      q('[data-sp="zone-source"]').onclick=()=>m.querySelector(`#${ZONE_SOURCE_FILE_ID}`).click();
      if(session.zoneSource){
        q('[data-sp="zone-detect"]').onclick=()=>{try{detectZoneSourceRegions();}catch(e){alert(e.message||String(e));}};
        q('[data-sp="zone-pair"]').onclick=()=>{if(!session.zoneSource){alert('Load a separate zone plan first.');return;}session.zoneAlign.pending={source:null};session.zoneTool=null;session.zoneStatus='Tap a reference point on the zone plan, then the same point on the plan preview.';render();};
        q('[data-sp="zone-transfer"]').onclick=()=>{try{transferZoneRegions();}catch(e){alert(e.message||String(e));}};
        q('[data-sp="zone-sample"]').onclick=()=>{if(!session.zoneSource){alert('Load a separate zone plan first.');return;}const z=normaliseScheduleZone(q('[data-sp="zone-no"]').value),w=Number(q('[data-sp="zone-window"]').value),rawT=field(q('[data-sp="zone-threshold"]').value),t=rawT?Number(rawT):null;if(!z){alert('Enter a zone number first.');return;}session.zoneTool={mode:'sample',zone:z,window:Number.isFinite(w)&&w>0?w:null,threshold:Number.isFinite(t)&&t>0?t:null,start:null,end:null};session.zoneAlign.pending=null;session.zoneStatus=`Drag a box across several hatch strokes for Zone ${z} on the zone plan.`;render();};
        q('[data-sp="zone-poly"]').onclick=()=>{if(!session.zoneSource){alert('Load a separate zone plan first.');return;}const z=normaliseScheduleZone(q('[data-sp="zone-no"]').value);if(!z){alert('Enter a zone number first.');return;}session.zoneTool={mode:'polygon',zone:z,points:[]};session.zoneAlign.pending=null;session.zoneStatus=`Tap the corners of Zone ${z} on the zone plan, then press Finish the drawn zone.`;render();};
        q('[data-sp="zone-finish"]').onclick=()=>{try{if(!session.zoneTool||session.zoneTool.mode!=='polygon')throw new Error('Start Draw the zone by hand first.');const t=session.zoneTool;session.zoneTool=null;addManualZoneRegion(t.zone,t.points);session.zoneStatus=`Manual Zone ${t.zone} polygon added for review.`;render();}catch(e){alert(e.message||String(e));}};
        q('[data-sp="zone-undo-pair"]').onclick=()=>{if(session.zoneAlign.pairs.length)session.zoneAlign.pairs.pop();session.zoneAlign.pending=null;updateZoneAlignment();render();};
        const zoneWin=q('[data-sp="zone-window"]');if(zoneWin&&!zoneWin.value&&session.zoneSource)zoneWin.value=odd(Math.max(9,ZONE_BASE_WINDOW_ORIGINAL_PX*(session.zoneSource.scale||1)));
        renderZoneWorkbench();
      }
      renderZones();
      spNav(left,{next:session.zoneSource?'Next: Review':'Skip',nextPrimary:!!session.zoneSource});
    }else if(uiStep===6){
      q('[data-sp="safe"]').onclick=()=>{session.candidates.forEach(c=>{if(!c.issues.length)c.decision='accepted'});render();};const qa=q('[data-sp="acceptall"]');if(qa)qa.onclick=()=>{session.candidates.forEach(c=>{if(c.decision!=='rejected')c.decision='accepted'});render();};q('[data-sp="review"]').onclick=()=>renderRows(true);q('[data-sp="all"]').onclick=()=>renderRows(false);
      const ob=q('[data-sp="ocr"]');
      if(ob){ob.onclick=async()=>{try{await recognisePrintedIdentities();}catch(e){if(session){session.ocrBusy=false;session.ocrStatus='';render();}alert(e.message||String(e));}};ob.disabled=session.ocrBusy||session.detectBusy||session.committed||!session.candidates.length;
        /* PASS 205 [205-D] - same probe as Arc's own scan button: no ./ocr/, no OCR. EverDue never ships it. */
        if(typeof fsOcrProbe==='function'){fsOcrProbe().then(ok=>{if(!ok){const b2=left.querySelector('[data-sp="ocr"]');if(b2){b2.disabled=true;b2.title='This app does not include the label reader';}}}).catch(()=>{});}}
      renderZones();renderRows(false);
      spNav(left,{next:'Next: Commit',nextPrimary:true,nextDisabled:busy});
    }else{
      const cb=q('[data-sp="commitbig"]');if(cb)cb.onclick=()=>commitBtn.click();
      if(session.committed){
        /* [209-C] Back was dead here (render() forces step 7 once committed). */
        const nav=document.createElement('div');nav.className='spNav';
        const cl=document.createElement('button');cl.className='btn';cl.setAttribute('data-sp','closedone');cl.textContent='Close Smart Plan';cl.onclick=()=>{discard();uiStep=1;spClose();};
        const ag=document.createElement('button');ag.className='btn spPrimary';ag.setAttribute('data-sp','again');ag.textContent='Start another plan';ag.onclick=()=>{discard();uiStep=1;ensureModal().style.display='block';render();};
        nav.appendChild(cl);nav.appendChild(ag);left.appendChild(nav);
      } else spNav(left);
    }
    preview();const blockers=session.candidates.filter(c=>c.decision==='accepted'&&c.issues.some(x=>x.level==='error')).length,hiddenAccepted=session.candidates.some(c=>c.decision==='accepted'&&hiddenTypesNow().has(field(c.obj.type)));commitBtn.disabled=session.committed||session.ocrBusy||session.detectBusy||!s.accepted||!!blockers||!!s.zoneReview||hiddenAccepted;
    const cbig=q('[data-sp="commitbig"]');if(cbig)cbig.disabled=commitBtn.disabled;
    const rec=s.reconciliation?` • reconcile M ${s.reconciliation.MATCH||0} / X ${s.reconciliation.MISMATCH||0} / registered ${s.reconciliation.ALREADY_IN_REGISTER||0} / missing ${s.reconciliation.MISSING_ON_PLAN||0} / plan-only ${s.reconciliation.PLAN_ONLY||0}`:'';
    const ocr=s.ocr?` • OCR ${s.ocr.applied||0}/${s.total} applied, +${(s.ocr.offsetRecovered||0)+(s.ocr.quadrantRecovered||0)} retry, cap ${s.ocr.capPx||60}px`:'';const det=s.detection?` • detect ${s.detection.kept||0} kept / ${s.detection.stubFlags||0} stub flags / ${(s.detection.workPixels/1e6).toFixed(1)} MP`:'';const zf=s.zoneSource&&s.zoneSource.rmse!=null?` • zone fit ${Number(s.zoneSource.rmse).toFixed(1)}px`:'';
    /* [206-B] the footer says it in plain words; the numbers a developer wants are the tooltip */
    foot.title=`zones ${s.zoneAccepted}/${s.zones} accepted${s.zoneReview?` (${s.zoneReview} review)`:''} • ${s.errors} blocking issue(s) • ${s.warnings} review flag(s)${det}${ocr}${zf}${rec}`;
    foot.textContent=session.committed?`Committed. ${s.total} candidate(s) were reviewed.`:(session.detectBusy?(session.detectStatus||'Detecting symbols…'):(session.ocrBusy?(session.ocrStatus||'Reading printed identities…'):`Candidates stay temporary until Commit. ${s.total} found · ${s.accepted} accepted · ${s.review} to check${s.rejected?` · ${s.rejected} rejected`:''}${s.zones?` · ${s.zoneAccepted}/${s.zones} zones`:''}${s.errors?` · ${s.errors} blocking`:''}`));
    /* [205-A] progress + Cancel only while something runs; Discard is held until it stops. */
    const spBusy=!!(session.detectBusy||session.ocrBusy),spBar=m.querySelector('[data-sp="bar"]'),spCancel=m.querySelector('[data-sp="cancel"]'),spDiscard=m.querySelector('[data-sp="discard"]');
    if(spBar){spBar.style.display=spBusy&&session.progress&&session.progress.total?'inline-block':'none';if(session.progress&&session.progress.total)spBar.value=spBarValue(session.progress);}
    if(spCancel){spCancel.style.display=spBusy?'inline-block':'none';spCancel.disabled=!!session.cancelRequested;}
    if(spDiscard)spDiscard.disabled=spBusy;
  }

  function renderReconciliation(){
    if(!session)return;const m=ensureModal(),box=m.querySelector('[data-sp="recon"]');if(!box)return;
    if(!session.schedule.length){box.innerHTML='<div class="spHint">No device list loaded yet.</div>';return;}
    const r=session.scheduleReport||reconcileSchedule(false),q=r.summary;
    box.innerHTML=`<div class="spReconGrid"><div class="spReconCell"><strong>${q.MATCH}</strong><span class="spHint">MATCH</span></div><div class="spReconCell"><strong>${q.MISMATCH}</strong><span class="spHint">MISMATCH</span></div><div class="spReconCell"><strong>${q.ALREADY_IN_REGISTER||0}</strong><span class="spHint">ALREADY IN REGISTER</span></div><div class="spReconCell"><strong>${q.MISSING_ON_PLAN}</strong><span class="spHint">MISSING ON PLAN</span></div><div class="spReconCell"><strong>${q.PLAN_ONLY}</strong><span class="spHint">PLAN ONLY</span></div></div><div class="spHint" style="margin-top:7px">${escapeHtml(session.scheduleSource||'schedule')} • ${q.totalSchedule} schedule row(s) • ${q.totalPlan} non-rejected plan candidate(s)</div>`;
    if(r.mismatch.length){const lines=r.mismatch.slice(0,6).map(x=>`${x.row.loop?`L${x.row.loop}.D`:''}${x.row.dev}: ${x.reasons.join(', ')}`);box.innerHTML+=`<div class="spHint" style="color:#ffb3a7;margin-top:6px">Review: ${escapeHtml(lines.join(' · '))}${r.mismatch.length>6?' …':''}</div>`;}
  }


  function renderZoneWorkbench(){
    if(!session)return;const m=ensureModal(),status=m.querySelector('[data-sp="zone-work-status"]'),box=m.querySelector('[data-sp="zone-regions"]');if(!status||!box)return;const z=session.zoneSource,fit=updateZoneAlignment();
    if(!z){status.innerHTML='<div class="spHint">No separate zone plan loaded.</div>';box.innerHTML='';return;}
    let ftxt='';if(fit){const rr=(fit.residuals||[]).map((v,i)=>`P${i+1} ${Number(v).toFixed(1)}px`).join(' · ');ftxt=` • fit ${fit.rmse.toFixed(1)} px RMSE / gate ${fit.threshold.toFixed(1)} px • scale ${fit.scale.toFixed(3)} • rotation ${fit.rotationDeg.toFixed(1)}°${rr?` • ${rr}`:''}`;}status.innerHTML=`<div class="spHint">${escapeHtml(session.zoneStatus||`${z.name} • ${z.width}×${z.height} working px`)}<br>${session.zoneSamples.length} hatch sample(s) • ${session.zoneRegions.length} source region candidate(s) • ${session.zoneAlign.pairs.length} alignment pair(s)${escapeHtml(ftxt)}</div>`;
    box.innerHTML='';session.zoneSamples.forEach(s=>{const d=document.createElement('div');d.className='spHint';d.textContent=`Zone ${s.zone}: hue ${s.hue.toFixed(1)}°, window ${s.window}px, density ${Number(s.threshold).toFixed(3)}${s.thresholdAuto?' auto':''} (ink ${Number(s.ink||0).toFixed(3)})`;box.appendChild(d);});const overlapWarnings=sourceRegionOverlapWarnings();session.zoneRegions.forEach(r=>{const ow=overlapWarnings.get(r.id)||[],warn=ow.length?`<div class="spHint" style="color:#ffb3a7">${escapeHtml(ow.join(' · '))}</div>`:'';const row=document.createElement('div');row.className='spSourceRegion';row.innerHTML=`<div><b>Zone ${escapeHtml(r.zone)}</b> <span class="spHint">${escapeHtml(r.source)} • ${Math.round(r.area)} px²</span>${warn}</div><select><option value="review">Review</option><option value="accepted">Keep</option><option value="rejected">Reject</option></select>`;const sel=row.querySelector('select');sel.value=r.decision;sel.onchange=()=>{r.decision=sel.value;render();};box.appendChild(row);});
  }

  function renderZones() {
    if(!session)return;const m=ensureModal(),box=m.querySelector('[data-sp="zones"]');if(!box)return;
    if(!session.zones.length){box.innerHTML='';return;}
    box.className='spZoneBox';
    box.innerHTML='<div style="font-weight:700;margin-bottom:4px">Zone regions</div><div class="spHint" style="margin-bottom:5px">Transferred/detected zones must be explicitly accepted or rejected. A later Arc zone edit can re-zone existing non-manual devices, so Smart Plan never commits an unreviewed polygon.</div>';
    session.zones.forEach(zc=>{
      const row=document.createElement('div');row.className='spZoneRow';
      const zw=zc.transferWarning?`<div class="spHint" style="color:#ffb3a7">${escapeHtml(zc.transferWarning)}</div>`:'';
      row.innerHTML=`<div><b>${escapeHtml(field(zc.obj.zn)||'Unnumbered zone')}</b> <span class="spHint" title="${escapeHtml(zc.id)}">${escapeHtml(zc.id)}</span>${zw}</div><select data-sp-zone><option value="accepted">Accept</option><option value="review">Review</option><option value="rejected">Reject</option></select>`;
      const sel=row.querySelector('select');sel.value=zc.decision;sel.onchange=()=>{zc.decision=sel.value;if(session.schedule.length)reconcileSchedule(true);else refreshIssues();render();};box.appendChild(row);
    });
  }

  function renderRows(reviewOnly) {
    if(!session)return; const m=ensureModal(),box=m.querySelector('[data-sp="rows"]'); if(!box)return;
    box.innerHTML=''; const list=session.candidates.filter(c=>!reviewOnly||c.decision==='review'||c.issues.length);
    list.forEach(c=>{
      const row=document.createElement('div'); row.className='spRow';
      const cls=c.issues.some(x=>x.level==='error')?'bad':c.issues.length?'rev':'ok';
      row.innerHTML=`<span class="spBadge ${cls}" title="${escapeHtml(c.id)}">${c.issues.length||'✓'}</span>
        <select data-k="type"></select><input data-k="zone" maxlength="5" placeholder="Zone"><input data-k="loop" maxlength="5" placeholder="Loop"><input data-k="dev" maxlength="5" placeholder="Device"><select class="spDecision" data-k="decision"><option value="accepted">Accept</option><option value="review">Review</option><option value="rejected">Reject</option></select><div class="spIssue"></div>`;
      const typeSel=row.querySelector('[data-k="type"]');
      let types=[]; try{types=Object.keys(TYPE_MAP||{})}catch(_){types=[c.obj.type]}
      if(!types.includes(c.obj.type))types.unshift(c.obj.type);
      typeSel.innerHTML=types.filter(Boolean).map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(arcTypeLabel(t))}</option>`).join(''); typeSel.value=c.obj.type;
      ['zone','loop','dev'].forEach(k=>row.querySelector(`[data-k="${k}"]`).value=field(c.obj[k])); row.querySelector('[data-k="decision"]').value=c.decision;
      row.querySelector('.spIssue').textContent=c.issues.map(x=>x.text).join(' · ');
      if(session.focusId===c.id)row.classList.add('spRowFocus');
      row.onclick=e=>{const tag=e.target&&e.target.tagName;if(/^(INPUT|SELECT|OPTION|BUTTON)$/.test(tag||''))return;session.focusId=c.id;box.querySelectorAll('.spRowFocus').forEach(r=>r.classList.remove('spRowFocus'));row.classList.add('spRowFocus');if(spCenterMain)spCenterMain(Number(c.obj.x),Number(c.obj.y));};
      row.onchange=e=>{const k=e.target&&e.target.dataset&&e.target.dataset.k;if(!k)return;if(k==='decision')c.decision=e.target.value;else{c.obj[k]=field(e.target.value);if(c.meta)c.meta[`${k}Source`]='user';}refreshIssues();render();};
      box.appendChild(row);
    });
    if(!list.length)box.innerHTML='<div class="spHint" style="padding:12px">Nothing requires review.</div>';
  }

  function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

  /* PASS 205 [205-C2] - hostReady() only says the globals exist; the button is
     hidden on the register shell but open() is public. Refuse unless the
     workspace is actually on screen: register hidden AND the topbar laid out. */
  function workspaceOnScreen(){
    try{const reg=document.getElementById('fsReg');if(reg&&reg.style.display!=='none')return false;
      const bar=document.getElementById('topbar');if(!bar)return false;const r=bar.getBoundingClientRect();return r.width>0&&r.height>0;}catch(_){return false;}
  }
  function open() {
    /* PASS 206 [206-C] - W206-C, his words: "EverDue doesn't have the workspace so it can't have the smart plan?" Hidden there entirely. */
    if(appIsEverDue()){alert('Smart Plan is part of the Arc Adapt Workspace.');return;}
    if(!hostReady()||!workspaceOnScreen()){alert('Open a Workspace before starting Smart Plan.');return;}
    ensureModal().style.display='block'; render();
  }

  function installButton() {
    /* PASS 206 [206-A] - W206-A: "it should go into Tools". The top-bar button
       is gone; the tile is in index.html's TOOLS_TAB (id "smartplan") and calls
       open(). Only the Back hook is installed here now. In EverDue [206-C]
       there is no tile and open() refuses; the hook is harmless and stays. */
    const stale=document.getElementById(BTN_ID);if(stale&&stale.parentNode)stale.parentNode.removeChild(stale);
    /* the ./ocr/ probe waits for the first open(): a HEAD at boot is a 404 on every EverDue load (test_p188 Z0) */
    /* PASS 205 [205-C] - Back to the register ends the session. Candidates are
       staged against the level that was open; nothing of theirs may survive into
       the register shell, and the modal must not sit over it. Capture phase so
       it runs before Arc's own handler tears the workspace down. */
    const back=document.getElementById('fsBack');
    if(back&&!back.__spHooked){back.__spHooked=true;back.addEventListener('click',()=>{try{cancelActiveOperation();}catch(_){}if(session)discard();uiStep=1;const mm=document.getElementById(MODAL_ID);if(mm)mm.style.display='none';},true);}
  }

  function maxCanvasPx(){try{return typeof FS_MAX_CANVAS_PX!=='undefined'?FS_MAX_CANVAS_PX:MAX_CANVAS_FALLBACK}catch(_){return MAX_CANVAS_FALLBACK}}

  /* PASS 215 [215-D] - the module carries the APP version it shipped with; patch-version.py bumps it
     with index.html and sw.js, and index.html refuses a module that does not match its own. */
  const MODULE_VERSION = "V0.194 beta";
  const api={version:VERSION,build:MODULE_VERSION,open,start,stage,cancel:cancelActiveOperation,summary,reconciliation,importScheduleRows,importScheduleFile,importZoneSourceFile,teachZoneHatch,detectZoneSourceRegions,addManualZoneRegion,addZoneAlignmentPair,transferZoneRegions,detectTemplate,recognisePrintedIdentities,commit,discard,maxCanvasPx,_normalisePayload:normalisePayload,_dedupeLabels:dedupeLabels,_assignLabels:assignLabels,_fitZoneAlignment:fitZoneAlignment,_estimatePolyOverlap:estimatePolyOverlap,_clipPolygonRect:clipPolygonRect,_sourceRegionOverlapWarnings:sourceRegionOverlapWarnings,tightenTemplateBox,_cropStripCanvas:cropStripCanvas,_taughtBox:()=>session&&session.taughtBox?session.taughtBox.slice():null,_stripReads:()=>session?session.candidates.map(c=>({id:c.id,type:c.obj.type,x:c.obj.x,y:c.obj.y,dev:c.obj.dev,reads:c.meta.stripReads||null,conflict:c.meta.stripConflict||null,interiorNcc:c.meta.interiorNcc,interiorInk:c.meta.interiorInk})):null};
  Object.freeze(api); Object.defineProperty(window,'ArcSmartPlan',{value:api,configurable:true});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{installButton();ensureModal();},{once:true});else{installButton();ensureModal();}
})();
