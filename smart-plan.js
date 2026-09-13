/* Arc Adapt - Smart Plan. BUILT BY tests/patch-p205.py FROM tests/smart-plan/engine-v1.6.2.js
   (sha256 81cc74b56aa4361cd2f8c574053a9c7a075c281ff6e4e532e6cadc5a5dd0f3f4) plus the Pass 205 integration edits listed in that script.
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
  const DETECT_WORK_MAX_PX = 4000000;
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
    for(let i=0,j=0;i<data.length;i+=4,j++){
      mask[j]=signal==='red'?(rgbaIsRed(data[i],data[i+1],data[i+2])?1:0):(rgbaIsInk(data[i],data[i+1],data[i+2])?1:0);
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
    const out={signal,w,h,iw,ih,scaleX:w/iw,scaleY:h/ih,mask,integral,stride,workPixels:w*h};
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

  function nmsDetections(list,templateRefW,templateRefH){
    const keep=[];const ref=Math.min(templateRefW,templateRefH)*DETECT_NMS_CENTRE_FACTOR;
    list.slice().sort((a,b)=>b.score-a.score).forEach(c=>{
      const cx=c.x+c.w/2,cy=c.y+c.h/2;
      if(keep.some(k=>iouBox(c,k)>=DETECT_NMS_IOU||Math.hypot(cx-(k.x+k.w/2),cy-(k.y+k.h/2))<ref))return;
      keep.push(c);
    });return keep;
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
      const f=makeFeature(signal),wb=workBBox(f,bbox),base=cropMask(f,wb);
      if(base.ink<8)throw new Error(`The taught rectangle contains too little ${signal==='red'?'red ':' '}symbol ink. Draw tightly around one complete symbol.`);
      const taught=contourStats(f,wb.x,wb.y,wb.w,wb.h),taughtHole=closedContourStats(f,wb.x,wb.y,wb.w,wb.h),taughtClosed=taught.sides>=3||taughtHole.enclosedRatio>=0.035;
      const raw=[];const mirrors=includeMirrors?[false,true]:[false];
      let pass=0,totalPass=DETECT_SCALES.length*DETECT_ROTATIONS.length*mirrors.length;
      for(const scale of DETECT_SCALES){
        const scaled=scaleMask(base,scale);
        for(const mirror of mirrors)for(const rotation of DETECT_ROTATIONS){
          pass++;spThrowIfCancelled();session.detectStatus=`Detecting symbols \u2014 pass ${pass} / ${totalPass}`;session.progress={done:pass-1,total:totalPass};render();
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
      const dedup=nmsDetections(raw,base.w,base.h).slice(0,DETECT_MAX_RESULTS);
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
        const c=normaliseDetection({id:`${runId}-${i+1}`,obj:{kind:'sym',type,x:cx,y:cy,zone:'',loop:'',dev:'',info:''},meta:{source:'template',confidence:d.score,requiresDeviceNumber:true,suspectStub:suspect,detectorRun:runId,detectorSignal:signal,bbox:box,rotation:d.rotation,mirrored:d.mirrored,scale:d.scale,closedContourScore:cs.score,closedContourSides:comparableSides}},i);
        created.push(c);
      }
      if(options.replaceType!==false)session.candidates=session.candidates.filter(c=>!(c.meta&&c.meta.source==='template'&&field(c.obj.type)===type));
      session.candidates.push(...created);refreshIssues();
      const elapsed=Math.round((performance.now?performance.now():Date.now())-started);
      session.detectReport={summary:{type,signal,threshold,raw:raw.length,kept:created.length,stubFlags:created.filter(c=>c.meta.suspectStub).length,nmsCentreFactor:DETECT_NMS_CENTRE_FACTOR,workPixels:f.workPixels,workScale:Math.min(f.scaleX,f.scaleY),elapsedMs:elapsed,taughtClosed,taughtContourScore:taught.score,taughtHoleRatio:taughtHole.enclosedRatio},bbox:clone(wb.original),detections:created.map(c=>({id:c.id,x:c.obj.x,y:c.obj.y,score:c.meta.confidence,stub:!!c.meta.suspectStub,closedContourScore:c.meta.closedContourScore,closedContourSides:c.meta.closedContourSides,box:clone(c.meta.bbox)})),finishedAt:Date.now()};
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

  async function runOcrCandidatePass(worker,candidates,indexes,opts,rawLabels,phase,offsets,upscale){
    let cropReads=0,labelReads=0;
    for(let n=0;n<indexes.length;n++){
      const i=indexes[n],c=candidates[i],x=Number(c.obj.x),y=Number(c.obj.y);
      spThrowIfCancelled();
      session.ocrStatus=`Reading labels \u2014 ${n+1} / ${indexes.length}${phase==='center'?' (first pass)':phase==='offset'?' (retry)':phase==='quadrant'?' (wide retry)':''}`;session.progress={done:n,total:indexes.length};render();
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
    const opts=Object.assign({mode:'loop-device',radiusX:145,radiusY:85,retryOffset:30,upscale:2,maxAssignmentPx:OCR_ASSIGN_MAX_PX,redVariant:true,fallbackPsm11:true,quadrantRetry:true},options||{});
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
      phases.center=await runOcrCandidatePass(worker,candidates,all,opts,rawLabels,'center',[[0,0]],baseUpscale);
      let pool=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      const centerAssigned=pool.assigned.usedCandidates.size;

      let unread=unreadCandidateIndexes(pool,candidates);
      if(unread.length&&opts.retryOffset>0){
        const o=opts.retryOffset,offsets=OCR_RETRY_DIRECTIONS.map(d=>[d.dx*o,d.dy*o]);
        phases.offset=await runOcrCandidatePass(worker,candidates,unread,opts,rawLabels,'offset',offsets,baseUpscale);
        pool=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      } else phases.offset={candidates:0,crops:0,reads:0,upscale:baseUpscale};
      const afterOffset=pool.assigned.usedCandidates.size;

      unread=unreadCandidateIndexes(pool,candidates);
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
        pool=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      } else phases.quadrant={candidates:0,crops:0,reads:0,upscale:baseUpscale,width:OCR_QUADRANT_W,height:OCR_QUADRANT_H,psm:'6',raw:true};

      const labels=pool.labels,assigned=pool.assigned,consistency=pool.consistency;
      let applied=0,withheld=0,mismatch=0;
      candidates.forEach(c=>{if(c.meta.devSource==='ocr'){c.obj.dev='';c.meta.devSource='';}if(c.meta.loopSource==='ocr'){c.obj.loop='';c.meta.loopSource='';}c.meta.ocrIssue='';c.meta.ocrDistance=null;c.meta.ocrConfidence=null;});
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
#${MODAL_ID} .spStat{padding:9px;border-radius:10px;background:var(--fs-bg2,#292e34);border:1px solid var(--fs-border,#3a4047)}
#${MODAL_ID} .spStat strong{display:block;font-size:18px} #${MODAL_ID} .spStat span{font-size:10px;color:var(--fs-sub,#9aa2aa)}
#${MODAL_ID} .spRow{display:grid;grid-template-columns:32px minmax(88px,1.1fr) 68px 68px 68px 92px;gap:6px;align-items:center;padding:7px 4px;border-bottom:1px solid rgba(128,128,128,.18)}
#${MODAL_ID} .spRow input,#${MODAL_ID} .spRow select{min-width:0;width:100%;min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-bg,#15181c);color:inherit;padding:6px}
#${MODAL_ID} .spRow .spIssue{grid-column:2/-1;font-size:10px;color:#ffb3a7;line-height:1.35}
#${MODAL_ID} .spZoneBox{margin:8px 0 12px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-bg2,#292e34)}
#${MODAL_ID} .spZoneRow{display:grid;grid-template-columns:minmax(90px,1fr) 92px;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.14)}
#${MODAL_ID} .spZoneRow:last-child{border-bottom:0}
#${MODAL_ID} .spBadge{font-size:10px;border:1px solid #59626c;border-radius:999px;padding:3px 7px;white-space:nowrap}.spBadge.ok{border-color:#2d8b57;color:#71d69c}.spBadge.rev{border-color:#b88926;color:#ffd36e}.spBadge.bad{border-color:#a94141;color:#ff9999}
#${MODAL_ID} canvas{width:100%;height:auto;display:block;background:#fff;border-radius:10px;border:1px solid var(--fs-border,#3a4047)}
#${MODAL_ID} .spActions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0} #${MODAL_ID} .spHint{font-size:11px;line-height:1.45;color:var(--fs-sub,#9aa2aa)}
#${MODAL_ID} .spFoot{padding:10px 14px;border-top:1px solid var(--fs-border,#3a4047);display:flex;align-items:center;gap:8px;background:var(--fs-bg,#15181c)}
#${MODAL_ID} button{min-height:44px}.spPrimary{background:#ff5a3c!important;border-color:#ff5a3c!important;color:white!important;font-weight:700}.spDanger{border-color:#a94141!important;color:#ff9999!important}
#${MODAL_ID} .spDetect{margin:8px 0 10px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-bg2,#292e34)}
#${MODAL_ID} .spDetectGrid{display:grid;grid-template-columns:minmax(120px,1.2fr) minmax(120px,1fr) 76px 82px auto;gap:6px;align-items:center}
#${MODAL_ID} .spRecon{margin:8px 0 10px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-bg2,#292e34)}
#${MODAL_ID} .spReconGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:6px;margin-top:7px}
#${MODAL_ID} .spReconCell{padding:7px;border:1px solid rgba(128,128,128,.2);border-radius:8px}.spReconCell strong{display:block;font-size:16px}
#${MODAL_ID} .spZoneWork{margin:8px 0 10px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-bg2,#292e34)}
#${MODAL_ID} .spZoneGrid{display:grid;grid-template-columns:70px 78px 78px auto;gap:6px;align-items:center;margin-top:7px}
#${MODAL_ID} .spZoneGrid input{min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-bg,#15181c);color:inherit;padding:6px;min-width:0;width:100%}
#${MODAL_ID} .spSourceRegion{display:grid;grid-template-columns:1fr 92px;gap:7px;align-items:center;padding:4px 0;border-top:1px solid rgba(128,128,128,.14)}
#${MODAL_ID} .spSourceRegion select{min-height:36px;border-radius:7px;background:var(--fs-bg,#15181c);color:inherit;border:1px solid var(--fs-border,#4b525c)}
#${MODAL_ID} .spDetectGrid select,#${MODAL_ID} .spDetectGrid input{min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-bg,#15181c);color:inherit;padding:6px;min-width:0}
#${MODAL_ID} .spCheck{font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap}
#${MODAL_ID} .spSourceCanvas{margin-top:10px}
@media(max-width:820px){#${MODAL_ID} .spBody{display:block;overflow:auto}#${MODAL_ID} .spPane{overflow:visible}#${MODAL_ID} .spPane+ .spPane{border-left:0;border-top:1px solid var(--fs-border,#3a4047)}#${MODAL_ID} .spFoot{flex-wrap:wrap;row-gap:6px}#${MODAL_ID} .spFoot [data-sp="foot"]{flex:1 1 100%}#${MODAL_ID} .spFoot [data-sp="bar"]{flex:1 1 100%;width:auto!important}#${MODAL_ID} .spFoot .spGrow{display:none}#${MODAL_ID} .spFoot button{flex:1 1 auto}#${MODAL_ID} .spStats{grid-template-columns:repeat(3,1fr)}#${MODAL_ID} .spRow{grid-template-columns:28px 1fr 58px 58px 58px}.spRow .spDecision{grid-column:2/-1}#${MODAL_ID} .spDetectGrid{grid-template-columns:1fr 1fr}#${MODAL_ID} .spDetectGrid button{grid-column:1/-1}#${MODAL_ID} .spZoneGrid{grid-template-columns:1fr 1fr}#${MODAL_ID} .spZoneGrid button{grid-column:1/-1}}
`;
    document.head.appendChild(s);
  }

  function ensureModal() {
    ensureStyle();
    let m=document.getElementById(MODAL_ID); if(m) return m;
    m=document.createElement('div'); m.id=MODAL_ID;
    m.innerHTML=`<div class="spShell">
      <div class="spHead"><b>Smart Plan</b><span class="spBadge" title="Smart Plan engine ${VERSION}">beta</span><span class="spGrow"></span><button class="btn" data-sp="close">Close</button></div>
      <div class="spBody"><div class="spPane" data-sp="left"></div><div class="spPane" data-sp="right"></div></div>
      <div class="spFoot"><span class="spHint" data-sp="foot">Candidates stay temporary until Commit.</span><progress data-sp="bar" max="100" value="0" style="display:none;width:120px;height:10px"></progress><span class="spGrow"></span><button class="btn spDanger" data-sp="cancel" style="display:none">Cancel</button><button class="btn spDanger" data-sp="discard">Discard</button><button class="btn spPrimary" data-sp="commit">Commit to Workspace</button></div>
      <input type="file" id="${FILE_ID}" accept="application/json,.json" style="display:none"><input type="file" id="${SCHEDULE_FILE_ID}" accept=".csv,.tsv,.txt,.json,.xlsx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none"><input type="file" id="${ZONE_SOURCE_FILE_ID}" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,application/pdf" style="display:none">
    </div>`;
    document.body.appendChild(m);
    m.querySelector('[data-sp="close"]').onclick=()=>{ m.style.display='none'; };
    m.querySelector('[data-sp="cancel"]').onclick=()=>{ cancelActiveOperation(); };
    m.querySelector('[data-sp="discard"]').onclick=()=>{ if(!session||confirm('Discard this uncommitted Smart Plan review?')) discard(); };
    m.querySelector('[data-sp="commit"]').onclick=()=>{
      try { const r=commit(); alert(`Smart Plan committed ${r.devices} device(s)${r.zones?` and ${r.zones} zone region(s)`:''}.`); }
      catch(e){ alert(e.message||String(e)); }
    };
    m.querySelector(`#${FILE_ID}`).onchange=async e=>{
      const f=e.target.files&&e.target.files[0]; if(!f)return;
      try { const data=JSON.parse(await f.text()); stage(normalisePayload(data,f.name)); }
      catch(err){ alert(err.message||String(err)); }
      e.target.value='';
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

  function livePlanImage() {
    try {
      if (typeof img !== 'undefined' && img && ((img.naturalWidth || img.width) > 0)) return img;
    } catch (_) {}
    return null;
  }

  function preview() {
    const right=ensureModal().querySelector('[data-sp="right"]');
    const hasZone=!!(session&&session.zoneSource);
    right.innerHTML='<div style="font-weight:700;margin-bottom:8px">Candidate preview</div><canvas data-sp="canvas" width="900" height="620"></canvas><div class="spHint" style="margin-top:8px">Preview draws from Arc already-decoded Workspace image. Teach Template: drag a tight box around one complete symbol. Alignment target points are picked here after the matching source point.</div>'+(hasZone?'<div class="spSourceCanvas"><div style="font-weight:700;margin:10px 0 8px">Zone-plan source</div><canvas data-sp="zone-canvas" width="900" height="620"></canvas><div class="spHint" style="margin-top:6px">Hatch teaching and source alignment points stay local to Smart Plan. The source image is downsampled to ≤2.5 MP and is never written into the Workspace or register.</div></div>':'');
    const cv=right.querySelector('[data-sp="canvas"]'),ctx=cv.getContext('2d');const dims=currentDims();
    const geometry=()=>{const sw=dims.w||cv.width,sh=dims.h||cv.height,scale=Math.min(cv.width/sw,cv.height/sh);return {sw,sh,scale,ox:(cv.width-sw*scale)/2,oy:(cv.height-sh*scale)/2};};
    const drawAll=()=>{ctx.clearRect(0,0,cv.width,cv.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);const live=livePlanImage(),g=geometry();if(live){try{ctx.drawImage(live,g.ox,g.oy,g.sw*g.scale,g.sh*g.scale)}catch(_){}}
      session.zones.forEach(zc=>{if(zc.decision==='rejected')return;const z=zc.obj,pts=z.pts||[];if(pts.length<3)return;ctx.save();ctx.strokeStyle=zc.decision==='accepted'?'#7e57c2':'#ffb300';ctx.lineWidth=2;ctx.beginPath();pts.forEach((p,i)=>{const x=g.ox+p.x*g.scale,y=g.oy+p.y*g.scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.stroke();ctx.restore();});
      session.candidates.forEach(c=>{if(c.decision==='rejected')return;const x=g.ox+c.obj.x*g.scale,y=g.oy+c.obj.y*g.scale;ctx.save();ctx.strokeStyle=c.meta&&c.meta.suspectStub?'#ff7043':(c.decision==='review'?'#ffb300':'#00a65a');ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();if(c.meta&&Array.isArray(c.meta.bbox)){const b=c.meta.bbox;ctx.globalAlpha=.7;ctx.strokeRect(g.ox+b[0]*g.scale,g.oy+b[1]*g.scale,b[2]*g.scale,b[3]*g.scale);}ctx.restore();});
      (session.zoneAlign&&session.zoneAlign.pairs||[]).forEach((p,i)=>{ctx.save();ctx.fillStyle='#e040fb';ctx.strokeStyle='#fff';ctx.lineWidth=1;const x=g.ox+p.target.x*g.scale,y=g.oy+p.target.y*g.scale;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#e040fb';ctx.font='bold 12px sans-serif';ctx.fillText(`T${i+1}`,x+8,y-7);ctx.restore();});
      const p=session.templatePick;if(p&&p.start&&p.end){ctx.save();ctx.strokeStyle='#40c4ff';ctx.setLineDash([6,4]);ctx.lineWidth=2;ctx.strokeRect(Math.min(p.start.x,p.end.x),Math.min(p.start.y,p.end.y),Math.abs(p.end.x-p.start.x),Math.abs(p.end.y-p.start.y));ctx.restore();}};
    drawAll();
    const mainPos=e=>{const r=cv.getBoundingClientRect(),sx=cv.width/r.width,sy=cv.height/r.height,g=geometry();return {canvas:{x:(e.clientX-r.left)*sx,y:(e.clientY-r.top)*sy},plan:{x:((e.clientX-r.left)*sx-g.ox)/g.scale,y:((e.clientY-r.top)*sy-g.oy)/g.scale}};};
    if(session.templatePick&&session.templatePick.active){cv.style.cursor='crosshair';cv.onpointerdown=e=>{const p=mainPos(e).canvas;cv.setPointerCapture&&cv.setPointerCapture(e.pointerId);session.templatePick.start=p;session.templatePick.end=p;drawAll();};cv.onpointermove=e=>{if(!session.templatePick||!session.templatePick.start)return;session.templatePick.end=mainPos(e).canvas;drawAll();};cv.onpointerup=async e=>{if(!session.templatePick||!session.templatePick.start)return;session.templatePick.end=mainPos(e).canvas;const p=clone(session.templatePick),g=geometry();session.templatePick=null;const x0=(Math.min(p.start.x,p.end.x)-g.ox)/g.scale,y0=(Math.min(p.start.y,p.end.y)-g.oy)/g.scale,x1=(Math.max(p.start.x,p.end.x)-g.ox)/g.scale,y1=(Math.max(p.start.y,p.end.y)-g.oy)/g.scale,bbox=[clamp(x0,0,g.sw),clamp(y0,0,g.sh),clamp(x1,0,g.sw)-clamp(x0,0,g.sw),clamp(y1,0,g.sh)-clamp(y0,0,g.sh)];render();try{await detectTemplate({type:p.type,signal:p.signal,threshold:p.threshold,includeMirrors:p.includeMirrors,bbox});}catch(err){if(session){session.detectBusy=false;session.detectStatus='';render();}alert(err.message||String(err));}};
    }else if(session.zoneAlign&&session.zoneAlign.pending&&session.zoneAlign.pending.source){cv.style.cursor='crosshair';cv.onclick=e=>{const p=mainPos(e).plan;session.zoneAlign.pairs.push({source:session.zoneAlign.pending.source,target:p});session.zoneAlign.pending=null;updateZoneAlignment();render();};}
    if(hasZone){const zv=right.querySelector('[data-sp="zone-canvas"]'),zctx=zv.getContext('2d'),zs=session.zoneSource,zw=zs.width,zh=zs.height,zscale=Math.min(zv.width/zw,zv.height/zh),zox=(zv.width-zw*zscale)/2,zoy=(zv.height-zh*zscale)/2;zctx.fillStyle='#fff';zctx.fillRect(0,0,zv.width,zv.height);zctx.drawImage(zs.canvas,zox,zoy,zw*zscale,zh*zscale);
      session.zoneRegions.forEach(r=>{if(r.decision==='rejected')return;zctx.save();zctx.strokeStyle=r.decision==='accepted'?'#00a65a':'#ffb300';zctx.lineWidth=2;zctx.beginPath();r.pts.forEach((p,i)=>{const x=zox+p.x*zscale,y=zoy+p.y*zscale;i?zctx.lineTo(x,y):zctx.moveTo(x,y)});zctx.closePath();zctx.stroke();zctx.restore();});
      (session.zoneAlign&&session.zoneAlign.pairs||[]).forEach((p,i)=>{zctx.save();zctx.fillStyle='#e040fb';const x=zox+p.source.x*zscale,y=zoy+p.source.y*zscale;zctx.beginPath();zctx.arc(x,y,6,0,Math.PI*2);zctx.fill();zctx.font='bold 12px sans-serif';zctx.fillText(`S${i+1}`,x+8,y-7);zctx.restore();});
      if(session.zoneTool&&session.zoneTool.mode==='sample'&&session.zoneTool.start&&session.zoneTool.end){const a=session.zoneTool.start,b=session.zoneTool.end;zctx.save();zctx.strokeStyle='#40c4ff';zctx.setLineDash([6,4]);zctx.lineWidth=2;zctx.strokeRect(zox+Math.min(a.x,b.x)*zscale,zoy+Math.min(a.y,b.y)*zscale,Math.abs(a.x-b.x)*zscale,Math.abs(a.y-b.y)*zscale);zctx.restore();}
      if(session.zoneTool&&session.zoneTool.mode==='polygon'&&session.zoneTool.points.length){zctx.save();zctx.strokeStyle='#40c4ff';zctx.lineWidth=2;zctx.beginPath();session.zoneTool.points.forEach((p,i)=>{const x=zox+p.x*zscale,y=zoy+p.y*zscale;i?zctx.lineTo(x,y):zctx.moveTo(x,y)});zctx.stroke();zctx.restore();}
      const zpos=e=>{const r=zv.getBoundingClientRect(),x=(e.clientX-r.left)*zv.width/r.width,y=(e.clientY-r.top)*zv.height/r.height;return{x:(x-zox)/zscale,y:(y-zoy)/zscale};};
      if(session.zoneTool&&session.zoneTool.mode==='sample'){zv.style.cursor='crosshair';zv.onpointerdown=e=>{const p=zpos(e);zv.setPointerCapture&&zv.setPointerCapture(e.pointerId);session.zoneTool.start=p;session.zoneTool.end=p;};zv.onpointermove=e=>{if(!session.zoneTool||!session.zoneTool.start)return;session.zoneTool.end=zpos(e);};zv.onpointerup=e=>{const t=session.zoneTool;if(!t||!t.start)return;t.end=zpos(e);const b=[Math.min(t.start.x,t.end.x),Math.min(t.start.y,t.end.y),Math.abs(t.start.x-t.end.x),Math.abs(t.start.y-t.end.y)];session.zoneTool=null;try{teachZoneHatch(t.zone,b,{window:t.window,threshold:t.threshold});}catch(err){alert(err.message||String(err));render();}};
      }else if(session.zoneTool&&session.zoneTool.mode==='polygon'){zv.style.cursor='crosshair';zv.onclick=e=>{session.zoneTool.points.push(zpos(e));render();};
      }else if(session.zoneAlign&&session.zoneAlign.pending&&!session.zoneAlign.pending.source){zv.style.cursor='crosshair';zv.onclick=e=>{session.zoneAlign.pending.source=zpos(e);session.zoneStatus=`Source point picked. Now click the matching point on the Workspace preview.`;render();};}
    }
  }

  function render() {
    /* PASS 205 [205-B] - render() draws; only open() shows. A finishing OCR used to re-open the modal after Close. */
    const m=ensureModal();const left=m.querySelector('[data-sp="left"]'),foot=m.querySelector('[data-sp="foot"]'),commitBtn=m.querySelector('[data-sp="commit"]');
    if(!session){
      const b0=m.querySelector('[data-sp="bar"]'),c0=m.querySelector('[data-sp="cancel"]');if(b0)b0.style.display='none';if(c0)c0.style.display='none';
      left.innerHTML=`<h3 style="margin-bottom:8px">Build a candidate plan, then review it before Arc saves anything</h3><p class="spHint">Teach one symbol and Smart Plan finds the rest, reads the printed addresses, checks them against the panel schedule and brings zones across from a zone plan. Everything stays a proposal until you press Commit.</p><div class="spActions"><button class="btn spPrimary" data-sp="start">Start from current plan</button><button class="btn" data-sp="import">Import candidate JSON</button></div><div class="spHint"><b>Safety rule:</b> candidates live only in Smart Plan memory. Detection, OCR and review do not add anything to <code>objects</code>, <code>levels</code>, <code>fsSite.plan</code> or the Asset Register until Commit.</div>`;
      left.querySelector('[data-sp="start"]').onclick=()=>{try{start();}catch(e){alert(e.message||String(e));}};left.querySelector('[data-sp="import"]').onclick=()=>m.querySelector(`#${FILE_ID}`).click();m.querySelector('[data-sp="right"]').innerHTML='<div class="spHint">Start from the current Workspace, teach one symbol from the plan, review the detected candidates, then read printed IDs locally. Nothing is committed automatically.</div>';commitBtn.disabled=true;foot.textContent='No candidate session is active.';return;
    }
    refreshIssues();const s=summary();let types=[];try{types=Object.keys(TYPE_MAP||{})}catch(_){types=['smoke','thermal']};const typeOptions=types.filter(Boolean).map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(arcTypeLabel(t))}</option>`).join('');
    left.innerHTML=`<div class="spStats"><div class="spStat"><strong>${s.total}</strong><span>candidates</span></div><div class="spStat"><strong>${s.accepted}</strong><span>accepted</span></div><div class="spStat"><strong>${s.review}</strong><span>review</span></div><div class="spStat"><strong>${s.rejected}</strong><span>rejected</span></div><div class="spStat"><strong>${s.numbered}</strong><span>numbered</span></div></div>
      <div class="spDetect"><div style="font-weight:700;margin-bottom:5px">Teach a symbol</div><div class="spDetectGrid"><select data-sp="dtype">${typeOptions}</select><select data-sp="signal"><option value="auto">Signal: Auto</option><option value="red">Signal: Red ink</option><option value="ink">Signal: Dark/colour ink</option></select><input data-sp="threshold" type="number" min="0.35" max="0.95" step="0.01" value="${DETECT_DEFAULT_THRESHOLD}"><label class="spCheck"><input data-sp="mirrors" type="checkbox"> Mirrors</label><button class="btn spPrimary" data-sp="teach">Teach template</button></div><div class="spHint">Drag a tight rectangle around one complete example on the preview. Photo scales: 0.95/1.0/1.05/1.15; the unsafe 0.85 pass stays removed. Possible one-sided leader stubs are sent to Review, never auto-deleted.</div></div>
      <div class="spRecon"><div style="font-weight:700">Panel schedule & reconciliation</div><div class="spHint">Import the panel/device schedule before committing. Exact loop + device is the primary identity; a unique device number may match only when loop is blank. Schedule rows never bypass Review.</div><div class="spActions"><button class="btn" data-sp="schedule">Import schedule</button><button class="btn" data-sp="reconcile">Reconcile again</button></div><div data-sp="recon"></div></div>
      <div class="spZoneWork"><div style="font-weight:700">Separate zone plan transfer</div><div class="spHint">Load a photographed/image/PDF zone plan locally, teach each coloured hatch or draw a source polygon, keep the real region(s), then pick ≥3 matching source/Workspace points. A similarity fit must pass the RMSE gate before zones enter Review.</div><div class="spActions"><button class="btn" data-sp="zone-source">Load zone plan</button><button class="btn" data-sp="zone-detect">Find hatch regions</button><button class="btn" data-sp="zone-pair">Add alignment pair</button><button class="btn" data-sp="zone-transfer">Transfer kept zones</button></div><div class="spZoneGrid"><input data-sp="zone-no" placeholder="Zone" maxlength="5"><input data-sp="zone-window" type="number" min="5" step="2" placeholder="Window"><input data-sp="zone-threshold" type="number" min="0.001" max="0.2" step="0.001" placeholder="Density: Auto"><button class="btn" data-sp="zone-sample">Teach hatch sample</button><button class="btn" data-sp="zone-poly">Draw polygon</button><button class="btn" data-sp="zone-finish">Finish polygon</button><button class="btn" data-sp="zone-undo-pair">Undo pair</button></div><div data-sp="zone-work-status"></div><div data-sp="zone-regions"></div></div>
      <div class="spActions"><button class="btn" data-sp="import">Replace candidates</button><button class="btn" data-sp="ocr">Read printed IDs</button><button class="btn" data-sp="safe">Accept all without issues</button><button class="btn" data-sp="review">Show review only</button><button class="btn" data-sp="all">Show all</button></div><div data-sp="zones"></div><div data-sp="rows"></div>`;
    left.querySelector('[data-sp="import"]').onclick=()=>m.querySelector(`#${FILE_ID}`).click();
    left.querySelector('[data-sp="schedule"]').onclick=()=>m.querySelector(`#${SCHEDULE_FILE_ID}`).click();
    left.querySelector('[data-sp="reconcile"]').onclick=()=>{try{reconcileSchedule(true);render();}catch(e){alert(e.message||String(e));}};
    left.querySelector('[data-sp="reconcile"]').disabled=!session.schedule.length;
    left.querySelector('[data-sp="zone-source"]').onclick=()=>m.querySelector(`#${ZONE_SOURCE_FILE_ID}`).click();
    left.querySelector('[data-sp="zone-detect"]').onclick=()=>{try{detectZoneSourceRegions();}catch(e){alert(e.message||String(e));}};
    left.querySelector('[data-sp="zone-pair"]').onclick=()=>{if(!session.zoneSource){alert('Load a separate zone plan first.');return;}session.zoneAlign.pending={source:null};session.zoneTool=null;session.zoneStatus='Click a source reference point on the zone plan, then the same point on the Workspace preview.';render();};
    left.querySelector('[data-sp="zone-transfer"]').onclick=()=>{try{transferZoneRegions();}catch(e){alert(e.message||String(e));}};
    left.querySelector('[data-sp="zone-sample"]').onclick=()=>{if(!session.zoneSource){alert('Load a separate zone plan first.');return;}const z=normaliseScheduleZone(left.querySelector('[data-sp="zone-no"]').value),w=Number(left.querySelector('[data-sp="zone-window"]').value),rawT=field(left.querySelector('[data-sp="zone-threshold"]').value),t=rawT?Number(rawT):null;if(!z){alert('Enter a zone number first.');return;}session.zoneTool={mode:'sample',zone:z,window:Number.isFinite(w)&&w>0?w:null,threshold:Number.isFinite(t)&&t>0?t:null,start:null,end:null};session.zoneAlign.pending=null;session.zoneStatus=`Drag a box across several hatch strokes for Zone ${z} on the source preview.`;render();};
    left.querySelector('[data-sp="zone-poly"]').onclick=()=>{if(!session.zoneSource){alert('Load a separate zone plan first.');return;}const z=normaliseScheduleZone(left.querySelector('[data-sp="zone-no"]').value);if(!z){alert('Enter a zone number first.');return;}session.zoneTool={mode:'polygon',zone:z,points:[]};session.zoneAlign.pending=null;session.zoneStatus=`Click the corners of Zone ${z} on the source plan, then press Finish polygon.`;render();};
    left.querySelector('[data-sp="zone-finish"]').onclick=()=>{try{if(!session.zoneTool||session.zoneTool.mode!=='polygon')throw new Error('Start Draw polygon first.');const t=session.zoneTool;session.zoneTool=null;addManualZoneRegion(t.zone,t.points);session.zoneStatus=`Manual Zone ${t.zone} polygon added for review.`;render();}catch(e){alert(e.message||String(e));}};
    left.querySelector('[data-sp="zone-undo-pair"]').onclick=()=>{if(session.zoneAlign.pairs.length)session.zoneAlign.pairs.pop();session.zoneAlign.pending=null;updateZoneAlignment();render();};
    const zoneWin=left.querySelector('[data-sp="zone-window"]');if(zoneWin&&!zoneWin.value&&session.zoneSource)zoneWin.value=odd(Math.max(9,ZONE_BASE_WINDOW_ORIGINAL_PX*(session.zoneSource.scale||1)));
    left.querySelector('[data-sp="teach"]').onclick=()=>{const type=left.querySelector('[data-sp="dtype"]').value,signal=left.querySelector('[data-sp="signal"]').value,threshold=Number(left.querySelector('[data-sp="threshold"]').value)||DETECT_DEFAULT_THRESHOLD,includeMirrors=left.querySelector('[data-sp="mirrors"]').checked;session.templatePick={active:true,type,signal,threshold,includeMirrors,start:null,end:null};render();};
    left.querySelector('[data-sp="ocr"]').onclick=async()=>{try{await recognisePrintedIdentities();}catch(e){if(session){session.ocrBusy=false;session.ocrStatus='';render();}alert(e.message||String(e));}};left.querySelector('[data-sp="ocr"]').disabled=session.ocrBusy||session.detectBusy||session.committed||!session.candidates.length;
    left.querySelector('[data-sp="teach"]').disabled=session.detectBusy||session.ocrBusy||session.committed;
    /* PASS 205 [205-D] - same probe as Arc's own scan button: no ./ocr/, no OCR. EverDue never ships it. */
    (function(){const ob=left.querySelector('[data-sp="ocr"]');if(!ob)return;ob.disabled=session.detectBusy||session.ocrBusy||session.committed;
      if(typeof fsOcrProbe==='function'){fsOcrProbe().then(ok=>{if(!ok){const b2=left.querySelector('[data-sp="ocr"]');if(b2){b2.disabled=true;b2.title='This app does not include the label reader';}}}).catch(()=>{});}})();
    left.querySelector('[data-sp="safe"]').onclick=()=>{session.candidates.forEach(c=>{if(!c.issues.length)c.decision='accepted'});render();};left.querySelector('[data-sp="review"]').onclick=()=>renderRows(true);left.querySelector('[data-sp="all"]').onclick=()=>renderRows(false);
    renderReconciliation();renderZoneWorkbench();renderZones();renderRows(false);preview();const blockers=session.candidates.filter(c=>c.decision==='accepted'&&c.issues.some(x=>x.level==='error')).length,hiddenAccepted=session.candidates.some(c=>c.decision==='accepted'&&hiddenTypesNow().has(field(c.obj.type)));commitBtn.disabled=session.committed||session.ocrBusy||session.detectBusy||!s.accepted||!!blockers||!!s.zoneReview||hiddenAccepted;
    const rec=s.reconciliation?` • reconcile M ${s.reconciliation.MATCH||0} / X ${s.reconciliation.MISMATCH||0} / registered ${s.reconciliation.ALREADY_IN_REGISTER||0} / missing ${s.reconciliation.MISSING_ON_PLAN||0} / plan-only ${s.reconciliation.PLAN_ONLY||0}`:'';
    const ocr=s.ocr?` • OCR ${s.ocr.applied||0}/${s.total} applied, +${(s.ocr.offsetRecovered||0)+(s.ocr.quadrantRecovered||0)} retry, cap ${s.ocr.capPx||60}px`:'';const det=s.detection?` • detect ${s.detection.kept||0} kept / ${s.detection.stubFlags||0} stub flags / ${(s.detection.workPixels/1e6).toFixed(1)} MP`:'';const zf=s.zoneSource&&s.zoneSource.rmse!=null?` • zone fit ${Number(s.zoneSource.rmse).toFixed(1)}px`:'';
    foot.textContent=session.committed?`Committed. ${s.total} candidate(s) were reviewed.`:(session.detectBusy?(session.detectStatus||'Detecting symbols…'):(session.ocrBusy?(session.ocrStatus||'Reading printed identities…'):`Temporary only • zones ${s.zoneAccepted}/${s.zones} accepted${s.zoneReview?` (${s.zoneReview} review)`:''} • ${s.errors} blocking issue(s) • ${s.warnings} review flag(s)${det}${ocr}${zf}${rec}`));
    /* [205-A] progress + Cancel only while something runs; Discard is held until it stops. */
    const spBusy=!!(session.detectBusy||session.ocrBusy),spBar=m.querySelector('[data-sp="bar"]'),spCancel=m.querySelector('[data-sp="cancel"]'),spDiscard=m.querySelector('[data-sp="discard"]');
    if(spBar){spBar.style.display=spBusy&&session.progress&&session.progress.total?'inline-block':'none';if(session.progress&&session.progress.total)spBar.value=Math.round(100*session.progress.done/session.progress.total);}
    if(spCancel){spCancel.style.display=spBusy?'inline-block':'none';spCancel.disabled=!!session.cancelRequested;}
    if(spDiscard)spDiscard.disabled=spBusy;
  }

  function renderReconciliation(){
    if(!session)return;const m=ensureModal(),box=m.querySelector('[data-sp="recon"]');if(!box)return;
    if(!session.schedule.length){box.innerHTML='<div class="spHint">No schedule loaded. CSV/TSV/TXT/JSON are supported directly; XLSX uses Arc\'s existing annuals parser when available.</div>';return;}
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
    if(!hostReady()||!workspaceOnScreen()){alert('Open a Workspace before starting Smart Plan.');return;}
    ensureModal().style.display='block'; render();
  }

  function installButton() {
    if(document.getElementById(BTN_ID))return;
    const bar=document.getElementById('topbar'); if(!bar)return;
    const b=document.createElement('button');b.className='btn';b.id=BTN_ID;b.title='Smart Plan — build a reviewed asset plan from drawings and schedules';b.textContent='Smart Plan';b.onclick=open;
    const anchor=document.getElementById('fsTestBtn'); if(anchor&&anchor.parentNode===bar)anchor.insertAdjacentElement('afterend',b);else bar.appendChild(b);
    /* PASS 205 [205-C] - Back to the register ends the session. Candidates are
       staged against the level that was open; nothing of theirs may survive into
       the register shell, and the modal must not sit over it. Capture phase so
       it runs before Arc's own handler tears the workspace down. */
    const back=document.getElementById('fsBack');
    if(back&&!back.__spHooked){back.__spHooked=true;back.addEventListener('click',()=>{try{cancelActiveOperation();}catch(_){}if(session)discard();const mm=document.getElementById(MODAL_ID);if(mm)mm.style.display='none';},true);}
  }

  function maxCanvasPx(){try{return typeof FS_MAX_CANVAS_PX!=='undefined'?FS_MAX_CANVAS_PX:MAX_CANVAS_FALLBACK}catch(_){return MAX_CANVAS_FALLBACK}}

  const api={version:VERSION,open,start,stage,cancel:cancelActiveOperation,summary,reconciliation,importScheduleRows,importScheduleFile,importZoneSourceFile,teachZoneHatch,detectZoneSourceRegions,addManualZoneRegion,addZoneAlignmentPair,transferZoneRegions,detectTemplate,recognisePrintedIdentities,commit,discard,maxCanvasPx,_normalisePayload:normalisePayload,_dedupeLabels:dedupeLabels,_assignLabels:assignLabels,_fitZoneAlignment:fitZoneAlignment,_estimatePolyOverlap:estimatePolyOverlap,_clipPolygonRect:clipPolygonRect,_sourceRegionOverlapWarnings:sourceRegionOverlapWarnings};
  Object.freeze(api); Object.defineProperty(window,'ArcSmartPlan',{value:api,configurable:true});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{installButton();ensureModal();},{once:true});else{installButton();ensureModal();}
})();
