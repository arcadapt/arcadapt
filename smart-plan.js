/* Arc Adapt - Smart Plan. BUILT BY tests/patch-p205.py FROM tests/smart-plan/engine-v1.6.2.js
   (sha256 81cc74b56aa4361cd2f8c574053a9c7a075c281ff6e4e532e6cadc5a5dd0f3f4) plus the Pass 205 integration edits listed in that script,
   then tests/patch-p206.py (the guided-flow UI, Pass 206), then tests/patch-p208.py (zoom + pan on the previews), then tests/patch-p209.py (local-mean ink, interior gate, bare-number reader, no-rebuild ticks, handles), then tests/patch-p210.py (handles at once, Accept all, Issues header, read diagnostics), then tests/patch-p211.py (the box snaps to the symbol; sticky step nav), then tests/patch-p212.py (light mode), then tests/patch-p213.py (closed-rectangle snap; the type sticks), then tests/patch-p216.py (counts by type; no back trap; areas to leave out). The engine functions are byte-identical to V0.184.
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
  const HIRES_K = 4, HIRES_TILE = 512, HIRES_MAX_PX = 120000000, HIRES_OCR_UPSCALE = 3, HIRES_INK_GROW = 1, HIRES_STRIP_UPSCALES = [4, 6];   /* [218-D] */
  const OCR_RETRY_DIRECTIONS = Object.freeze([{name:'up',dx:0,dy:-1},{name:'down',dx:0,dy:1},{name:'right',dx:1,dy:0},{name:'left',dx:-1,dy:0}]);
  /* PASS 209 [209-G3] - BARE-NUMBER SHEETS. Some drawings print only the device
     number beside the symbol (58, not L01.D58), 7 px tall at the sheet's own
     resolution. Four tight strips around the symbol, Lanczos 6x, one line,
     digits only; a read must agree across two scales. */
  /* [221-A] the shape test's own numbers, all RATIOS of the text band so the same
     crop behaves the same at 4x and at 7x. */
  const FIX7_ROW_FLOOR = 0.15, FIX7_MIN_BAND = 6, FIX7_MIN_COL = 3;
  const FIX7_TOP_SPAN = 0.72, FIX7_BOT_SPAN = 0.6, FIX7_BOT_MIN = 0.05;
  const FIX7_BAND_MARGIN = 0.18, FIX7_GAP = 0.7;
  const OCR_DIAG_MAX = 14;   /* [221-D] how many reads the diagnostics carries back */
  const OCR_STRIP_WIDEN = 0.85;   /* [219-B] how much wider the confirming look is, in strip widths */
  const OCR_STRIP_UPSCALES = [5, 7], OCR_STRIP_UPSCALE = 6, OCR_STRIP_SINGLE_MIN_CONF = 85, OCR_STRIP_NARROW_CUT = 0.2, OCR_STRIP_ADOPT_RATIO = 0.15, OCR_STYLE_PROBE_N = 6;
  /* [221-B] DELIBERATELY NOT WIDENED - see tests/patch-p221.py. A window sized for a
     three-digit number reads a two-digit one WORSE (tesseract returns nothing for a
     short number sitting in a wide white tile), and two digits is the common case.
     The three-digit number is caught by the wider SECOND look on a 2-digit read. */
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
  const DETECT_INTERIOR_SELF = 0.2, DETECT_INTERIOR_MIN_PX = 4, DETECT_HOLLOW_NCC = 0.6, DETECT_HOLLOW_INK = 0.08;
  const DETECT_HOLE_TAUGHT = 0.035, DETECT_HOLE_KEEP = 0.4, DETECT_HOLE_SIDE = 0.65;   /* [239-A] a hit on a closed symbol must enclose at least this much of what the taught encloses, or read as a four-sided box with every side at least this covered */   /* [238-A] a taught interior with under DETECT_INTERIOR_MIN_PX of ink, or that does not correlate with itself one pixel over, is hollow - no signature inside: the whole symbol is compared at the pose the finder found, and the inside may carry at most the taught's ink plus this fraction of its area */
  const DETECT_DEFAULT_THRESHOLD = 0.50;
  const DETECT_SCALES = [0.95, 1.0, 1.05, 1.15];
  const DETECT_ROTATIONS = [0, 90, 180, 270];
  const DETECT_NMS_IOU = 0.15;
  const DETECT_NMS_CENTRE_FACTOR = 1.30;
  const DETECT_MAX_RESULTS = 400;
  /* [226-A] THE VECTOR FINDER. A vector PDF says where every square is, exactly; these
     bound what counts as one. Sides in plan px. VEC_SIDE_MATCH is how far a square's side
     may sit from the one he showed (his drafting firm's 14.34 pt squares agree to 0.06 pt;
     6 % leaves room for a plotter's rounding, not for a different symbol). VEC_CORNER_TOL
     is how far apart two strokes' endpoints may be and still make a corner - some corners
     are drawn as separate strokes that do not meet exactly. */
  const VEC_SIDE_MIN = 6, VEC_SIDE_MAX = 80, VEC_CORNER_TOL = 0.45, VEC_SIDE_MATCH = 0.06;
  const VEC_TAUGHT_MIN = 0.5, VEC_TAUGHT_MAX = 1.15;   /* the taught square's side against his box */
  /* inner strokes: a symbol repeats its stroke count exactly (his 109 smokes all have 3); a
     hatch is anchored to the sheet, not the symbol, so its count varies (41-53 on his) and any two
     hatches are the same symbol; a filled shape's outline lands on the square's own sides,
     so its stroke count is chance (0-5 on his sounders) and the fill alone is the symbol */
  const VEC_HATCH_MIN = 10, VEC_INNER_TOL = 1;
  /* [233-B] two squares are the same symbol when the strokes inside them sit at the same places (any of the 8 turns and flips, each endpoint within VEC_INNER_GEOM_TOL), not merely when they count the same; the candidate may carry VEC_INNER_TOL strokes more (a wire end) */
  const VEC_INNER_GEOM_TOL = 0.5;
  /* [230-A] ANY SYMBOL DRAWN AS PATHS. A shape is any path no bigger than VEC_SHAPE_MAX_PX.
     The symbol he showed is the longest end-to-end joined group of pieces fully inside his
     box (joined: an endpoint within VEC_SHAPE_TOL of another piece's vertex). A repeat is
     the same pieces at the same relative positions, any of the 8 turns and flips, every
     vertex within VEC_SHAPE_TOL; pieces totalling under VEC_SHAPE_MISS_FRAC of the drawn
     length may be missing (a plotter drops a 3 px edge to a dot now and then). */
  const VEC_SHAPE_MAX_PX = 80, VEC_SHAPE_MIN_PX = 3, VEC_SHAPE_TOL = 0.5, VEC_SHAPE_MISS_FRAC = 0.25;
  const VEC_SHAPE_NUMBERED_FRAC = 0.5;
  /* [231-B] a repeat at another size: the anchor's length over the template's, VEC_SHAPE_SCALE_MIN..MAX; within VEC_SHAPE_SCALE_SAME of 1 it is the same size; a symbol needs VEC_SHAPE_SCALE_MIN_PIECES strokes before another size is looked for */
  const VEC_SHAPE_SCALE_MIN = 0.25, VEC_SHAPE_SCALE_MAX = 4, VEC_SHAPE_SCALE_SAME = 0.02, VEC_SHAPE_SCALE_MIN_PIECES = 3;   /* a shape symbol carries numbers when at least this share of its repeats have a digit word beside them; otherwise the reader leaves the lot alone */
  const VEC_SYMS = Object.freeze([[1,0,0,1],[0,-1,1,0],[-1,0,0,-1],[0,1,-1,0],[-1,0,0,1],[0,1,1,0],[1,0,0,-1],[0,-1,-1,0]]);
  /* [228-A] THE STROKE-FONT DIGITS. A glyph piece is a black stroked path no bigger than
     VEC_PIECE_MAX_PX; pieces that touch (within a fraction of the expected glyph height,
     tighter sideways than up-and-down because the next digit is only 0.8 px away while an
     8's loops can sit 0.9 px apart) make a glyph; a glyph is digit-sized when its height is
     VEC_GLYPH_H_MIN..MAX of the square's side; glyphs on one baseline (VEC_WORD_BASE of a
     height apart) with a gap under VEC_WORD_GAP heights make a word. A glyph reads as a
     digit when its 90th-percentile point distance to that digit's template, in units of
     glyph height, is under VEC_GLYPH_TOL and no OTHER digit comes within VEC_GLYPH_MARGIN
     of that. A word is a label when it is all digits, at most three, and its centre is
     within VEC_LABEL_REACH sides of the square. The templates are the ten digits of the
     stroke font on his sheets, height 1, as drawn: 8, 1 and 3 have a second form. */
  const VEC_PIECE_MAX_PX = 12, VEC_GLYPH_H_MIN = 0.32, VEC_GLYPH_H_MAX = 0.58, VEC_GLYPH_W_MAX = 0.5;
  const VEC_TOUCH_X = 0.05, VEC_TOUCH_Y = 0.16, VEC_WORD_BASE = 0.25, VEC_WORD_GAP = 0.7, VEC_WORD_MAX = 3;
  const VEC_GLYPH_TOL = 0.08, VEC_GLYPH_MARGIN = 0.03, VEC_LABEL_REACH = 1.6, VEC_SAMPLE = 0.04;
  const VEC_STACK_GAP = 0.3;   /* [237-B] two glyph fragments stacked in one column with a gap under this many glyph heights are one glyph */
  const VEC_DIGITS = Object.freeze([{"d":"1","w":0.217,"s":[[[0.217,1.0],[0.217,0.0],[0.0,0.217]]]},{"d":"6","w":0.449,"s":[[[0.336,0.0],[0.206,0.075],[0.103,0.178],[0.037,0.299],[0.0,0.449],[0.0,0.776],[0.019,0.86],[0.065,0.935],[0.14,0.981],[0.224,1.0],[0.308,0.981],[0.383,0.935],[0.43,0.86],[0.449,0.776],[0.449,0.664],[0.439,0.598],[0.411,0.533],[0.364,0.477],[0.299,0.449],[0.0,0.449]]]},{"d":"2","w":0.443,"s":[[[0.226,0.0],[0.123,0.019],[0.047,0.075],[0.0,0.17]],[[0.415,0.34],[0.443,0.255],[0.434,0.16],[0.387,0.075],[0.311,0.019],[0.226,0.0]],[[0.415,0.34],[0.0,1.0],[0.443,1.0]]]},{"d":"4","w":0.551,"s":[[[0.215,0.0],[0.0,0.776],[0.551,0.776]],[[0.383,0.561],[0.383,1.0]]]},{"d":"9","w":0.443,"s":[[[0.104,1.0],[0.217,0.953],[0.311,0.868],[0.377,0.764],[0.425,0.651],[0.443,0.528],[0.443,0.226],[0.425,0.142],[0.377,0.066],[0.302,0.019],[0.217,0.0],[0.132,0.019],[0.057,0.066],[0.009,0.142],[0.0,0.226],[0.0,0.33],[0.009,0.415],[0.057,0.491],[0.132,0.538],[0.217,0.557],[0.443,0.557]]]},{"d":"5","w":0.443,"s":[[[0.0,1.0],[0.226,1.0],[0.311,0.981],[0.387,0.934],[0.434,0.868],[0.443,0.783],[0.443,0.67],[0.434,0.585],[0.387,0.509],[0.311,0.462],[0.226,0.443],[0.0,0.443],[0.0,0.0],[0.396,0.0]]]},{"d":"7","w":0.443,"s":[[[0.226,1.0],[0.443,0.0],[0.0,0.0],[0.0,0.113]]]},{"d":"3","w":0.453,"s":[[[0.0,0.0],[0.226,0.0]],[[0.226,0.443],[0.311,0.434],[0.387,0.377],[0.434,0.311],[0.453,0.226],[0.434,0.142],[0.387,0.066],[0.311,0.019],[0.226,0.0]],[[0.226,0.443],[0.113,0.443]],[[0.453,0.67],[0.434,0.585],[0.387,0.509],[0.311,0.462],[0.226,0.443]],[[0.453,0.67],[0.453,0.783]],[[0.226,1.0],[0.311,0.991],[0.387,0.934],[0.434,0.868],[0.453,0.783]],[[0.226,1.0],[0.0,1.0]]]},{"d":"0","w":0.434,"s":[[[0.104,0.057],[0.028,0.226],[0.0,0.406],[0.0,0.594],[0.028,0.774],[0.104,0.943]],[[0.33,0.057],[0.274,0.009],[0.217,0.0],[0.151,0.009],[0.104,0.057]],[[0.33,0.943],[0.396,0.774],[0.434,0.594],[0.434,0.406],[0.396,0.226],[0.33,0.057]],[[0.104,0.943],[0.151,0.991],[0.217,1.0],[0.274,0.991],[0.33,0.943]]]},{"d":"8","w":0.443,"s":[[[0.443,0.226],[0.425,0.142],[0.377,0.066],[0.311,0.019],[0.217,0.0],[0.132,0.019],[0.066,0.066],[0.019,0.142],[0.0,0.226],[0.019,0.311],[0.377,0.377],[0.425,0.311],[0.443,0.226],[0.443,0.226]],[[0.443,0.67],[0.425,0.585],[0.377,0.509],[0.311,0.462],[0.217,0.443],[0.132,0.462],[0.066,0.509],[0.019,0.585],[0.0,0.67]],[[0.443,0.67],[0.443,0.783]],[[0.0,0.783],[0.019,0.868],[0.066,0.934],[0.132,0.991],[0.217,1.0],[0.311,0.991],[0.377,0.934],[0.425,0.868],[0.443,0.783]],[[0.0,0.783],[0.0,0.67]]]},{"d":"8","w":0.511,"s":[[[0.511,0.261],[0.489,0.152],[0.435,0.076],[0.348,0.022],[0.25,0.0],[0.152,0.022],[0.065,0.076],[0.011,0.152],[0.0,0.261],[0.011,0.359],[0.065,0.435],[0.152,0.489],[0.25,0.511],[0.348,0.489],[0.435,0.435],[0.489,0.359],[0.511,0.261],[0.511,0.261]],[[0.511,0.772],[0.489,0.674],[0.435,0.587],[0.348,0.533],[0.25,0.511],[0.152,0.533],[0.065,0.587],[0.011,0.674],[0.0,0.772]],[[0.511,0.772],[0.511,0.902]],[[0.0,0.902],[0.011,1.0],[0.489,1.0],[0.511,0.902]],[[0.0,0.902],[0.0,0.772]]]},{"d":"1","w":0.224,"s":[[[0.0,0.224],[0.224,0.0],[0.224,1.0]]]},{"d":"3","w":0.439,"s":[[[0.0,0.0],[0.224,0.0]],[[0.224,0.449],[0.308,0.43],[0.308,0.019],[0.224,0.0]],[[0.224,0.449],[0.112,0.449]],[[0.439,0.664],[0.421,0.579],[0.374,0.514],[0.308,0.458],[0.224,0.449]],[[0.439,0.664],[0.439,0.776]],[[0.224,1.0],[0.308,0.981],[0.374,0.935],[0.421,0.86],[0.439,0.776]],[[0.224,1.0],[0.0,1.0]]]}]);
  /* [220-A] how far around a symbol to look, in multiples of its half-width, and the
     gate for "this pixel is a coloured fill" - the same saturation/value cut
     teachZoneHatch already uses, so a wall, black ink or white paper never votes.
     FILL_MIN_FRACTION is a FRACTION and not a pixel count on purpose: an absolute
     floor means the same detector passes on a 300-dpi sheet and fails on a 150-dpi
     one, which is a bug that only ever shows up on somebody else's scan. */
  const FILL_RING_OUTER = 2.6;
  /* [224-A] SATURATION IS THE WHOLE PAPER TEST. FILL_MAX_VAL (0.985) used to sit
     beside this and threw away any pixel brighter than it AS PAPER - which is every
     pale tint, because a pale tint of a colour saturates one channel at 255 and so
     reads v = 1.0 exactly. Measured on his sheet: rgb(255,204,156) at s 0.39 and
     rgb(184,184,255) at s 0.28, the two zones that came back empty, discarded as
     paper and then counted AGAINST their own fill. White paper is s ~ 0 and a warm
     scanner cast is s 0.05, so this line refuses both without help. FILL_MIN_VAL
     has been dead since 221-C replaced it with FILL_INK_VAL; both are gone rather
     than left in place looking like bounds that something enforces. */
  const FILL_MIN_SAT = 0.10;
  /* [221-C] both measured against COLOUR+PAPER, never against every pixel in the disc.
     FILL_INK_VAL is what counts as ink and is therefore excluded from the question. */
  const FILL_INK_VAL = 0.42;
  const FILL_MIN_FRACTION = 0.55;
  const FILL_DOMINANT_SHARE = 0.70;
  const FILL_HUE_TOLERANCE = 14;
  /* [225-A] THE ZONE NAMES ARE ON THE SHEET. Read once, at half size, in sparse-text
     mode: his labels are 30 px lettering and half size found 8 of 8 in 1.7 s where 1x
     took 11 s and broke one of them. Half size is also why there is no size floor: his
     room names are 14 px and at half size the reader does not see them at all, and a
     floor that never bites would only ever drop a real label on a sheet with smaller
     lettering. A stray word that says ZONE with no colour under it names nothing. */
  const ZONE_LABEL_SCALE = 0.5;
  const ZONE_LABEL_RE = /^ZONE[^A-Z0-9]{0,2}(\d{1,3})(?![\d])/i;   /* a wire through the words reads as a stray mark */
  const ZONE_LABEL_WORD_RE = /^ZONE/i;   /* ZONE, ZONE-, ZONE®, ZONES, - the word with its number lost to whatever was drawn against it */
  const ZONE_LABEL_NUM_RE = /^(\d{1,3})(?![\d])/;
  const ZONE_STUMP_H = 14;   /* what is left of small text after the opening is erased below this height */
  const ZONE_DIGIT_FROM = [0.2, -0.1], ZONE_DIGIT_PSM = ['7', '8', '13'], ZONE_DIGIT_REACH = 3.2, ZONE_DIGIT_UPSCALE = 2;   /* the second look: a strip 3.2 heights wide starting just right of the word and again a little inside it, each read as a line, a word and a raw line - six votes on one digit */
  /* [225-A] THE LEADER. A one-pixel grey line renders at ~50% - or, straddling two
     columns, at ~75% each - and is NOT ink by the fill rule (FILL_INK_VAL 0.42), so the
     walk has its own softer mask. The dot at the end is
     black and compact: 5-15 px of ink across, on BOTH sides of the line, for four rows -
     a wall the line crosses is wider, a room name it crosses is grey and one-sided. */
  const ZONE_LEADER_V = 0.80;
  const ZONE_LEADER_GAP = 3, ZONE_LEADER_MIN = 25, ZONE_LEADER_NEAR = 70, ZONE_LEADER_BACK = 40;
  const ZONE_LEADER_REACH = 500, ZONE_LEADER_RUN = 900, ZONE_LEADER_TURN = 8;
  const ZONE_DOT_MIN = 5, ZONE_DOT_MAX = 15, ZONE_DOT_SIDE = 2, ZONE_DOT_ROWS = 4, ZONE_DOT_HALF = 7;
  const ZONE_ANCHOR_HALF = 6;   /* fillRingHue on a 12 px box samples a 15.6 px disc under the dot */
  const ZONE_DIAG_MAX = 14;   /* [221-D] how many detectors the pasted payload carries */
  /* [221-D] THE REFUSED ONES FIRST. "Some detectors in coloured zones didn't get picked
     up" is a question about refusals, and a flat slice of the first fourteen would answer
     it with fourteen that worked. The session keeps an entry for EVERY detector; only what
     he pastes is trimmed. */
  function zoneDiagOut(d){
    if(!Array.isArray(d))return [];
    const no=d.filter(e=>!e.zoned), yes=d.filter(e=>e.zoned);
    return no.concat(yes).slice(0,ZONE_DIAG_MAX);
  }
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
    if (meta && meta.requiresDeviceNumber && !field(obj.dev) && !meta.devCleared) out.push({code:'missing_dev', level:'review', text:'Device number/address unread'});   /* [232-B] he took it off - no flag */
    if (meta && meta.confidence != null && Number(meta.confidence) < 0.75) out.push({code:'low_confidence', level:'review', text:'Weak symbol match'});
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
      method:field(m0.method),vectorSide:m0.vectorSide == null ? null : Number(m0.vectorSide),vectorInner:m0.vectorInner == null ? null : Number(m0.vectorInner),vectorFill:!!m0.vectorFill,vectorShape:!!m0.vectorShape,vectorPartial:!!m0.vectorPartial,noNumber:!!m0.noNumber,vectorScale:m0.vectorScale==null?1:Number(m0.vectorScale),zoneCleared:!!m0.zoneCleared,loopCleared:!!m0.loopCleared,devCleared:!!m0.devCleared,devHow:field(m0.devHow),   /* [232-B] */   /* [230-A] */   /* [228-A] the vector finder's facts about a candidate, kept */
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
      fillZones:null,   /* [220-A] */
      taught:[],   /* [239-B] every teach so far: type, the box he drew, its crop, how many it found */
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
      fillZones:session.fillZones?{groups:session.fillZones.groups.length,named:session.fillZones.groups.filter(g=>field(g.zone)).length,sampled:session.fillZones.sampled,plain:session.fillZones.plain}:null,   /* [220-A] */
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
  /* ================= PASS 220 [220-A] ZONES FROM THE COLOUR FILL =================
     The plan itself is the zone source. Everything below reads the WORKSPACE
     IMAGE, never the 4x grey tiles Pass 218 built - those are grey, and hue is
     the whole signal here.

     A DISC AROUND THE SYMBOL, AND A FRACTION, NOT A COUNT. Everything within
     FILL_RING_OUTER half-widths of the symbol's centre is sampled - the symbol
     itself included, because its own black outline, white middle and the black
     number beside it are all removed by the saturation/value gate anyway, and a
     minority of coloured symbol ink cannot pull a saturation-weighted CIRCULAR
     mean off the floor's hue. (An inner radius that skipped the symbol was
     written first and then deleted: mutate-p220 showed removing it changed
     nothing a test could see, even with the symbols printed in red, which is
     the definition of a guard that is not guarding.)

     What DOES decide is how much of that disc is coloured at all. A detector
     six pixels outside a zone boundary catches a sliver of the fill next door;
     one standing on white paper catches none. Both must come back with no hue,
     because a zone number he has to un-type is worse than one he types. The
     floor is a FRACTION of the disc rather than a pixel count so that the same
     detector behaves the same way on a 150-dpi scan and a 4x re-render. */
  /* [221-C] INK IS NOT EVIDENCE EITHER WAY.
     220-A asked whether 35% of ALL the pixels in the disc were coloured. On his sheet
     four detectors sitting well inside the pale-purple ZONE 6 got no zone at all,
     because on a small symbol the symbol itself, its printed number, a wall and a wire
     are most of that disc - even though every scrap of floor under them is one colour.
     A wall drawn through a zone is not an argument about which zone it is.
     So ink is excluded from the denominator: the question is COLOUR vs PAPER. A
     detector on white paper still gets nothing (all paper), and one straddling a
     boundary still gets nothing - that is the separate dominance test below, which
     asks what share of the COLOURED pixels agree with each other. */
  /* [222-D] A REFUSAL CARRIES ITS NUMBERS. 221-D recorded hue/colour/fraction/
     dominance for every detector and recorded NOTHING for a refused one, because
     this returned a bare null - so his "some detectors in coloured zones didn't get
     picked up" was the one question the payload could not answer. It now returns
     {zoned:false, why, ...the same numbers}. THE CALLER'S BEHAVIOUR IS UNCHANGED:
     anything without zoned===true is no zone, exactly as before. */
  function fillRingHue(ctx, b){
    const [bx,by,bw,bh]=b;
    const cx=bx+bw/2, cy=by+bh/2, r=Math.max(bw,bh)/2;
    const ro=r*FILL_RING_OUTER;
    const x0=Math.max(0,Math.floor(cx-ro)), y0=Math.max(0,Math.floor(cy-ro));
    const x1=Math.ceil(cx+ro), y1=Math.ceil(cy+ro);
    const w=Math.max(1,x1-x0), h=Math.max(1,y1-y0);
    let d; try{ d=ctx.getImageData(x0,y0,w,h).data; }catch(_){ return null; }
    let sx=0,sy=0,ss=0,sv=0,n=0,paper=0;const hues=[];
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const px=x0+xx+0.5, py=y0+yy+0.5, dx=px-cx, dy=py-cy;
      if(Math.hypot(dx,dy)>ro)continue;
      const i=(yy*w+xx)*4;
      if(d[i+3]<128)continue;
      const q=rgbToHsv(d[i],d[i+1],d[i+2]);
      if(q.v<FILL_INK_VAL)continue;                    /* ink: the symbol, its number, a wall, a wire */
      if(q.s<FILL_MIN_SAT){paper++;continue;}   /* [224-A] unfilled paper - no colour, never merely bright */
      const wt=Math.max(.1,q.s);
      sx+=Math.cos(q.h*Math.PI/180)*wt; sy+=Math.sin(q.h*Math.PI/180)*wt;
      ss+=q.s; sv+=q.v; n++; hues.push(q.h);
    }
    const lit=n+paper;
    const frac=lit?n/lit:0;
    if(!lit)return {zoned:false,why:'nothing-lit',n:n,paper:paper,fraction:0,dominance:0};   /* [222-D] */
    if(frac<FILL_MIN_FRACTION)return {zoned:false,why:'too-little-colour',n:n,paper:paper,fraction:frac,dominance:0};   /* [222-D] */
    let hue=Math.atan2(sy,sx)*180/Math.PI; if(hue<0)hue+=360;
    /* one colour, or a boundary? If the coloured pixels do not agree with each other
       the detector is standing on the join and the answer is no answer. */
    let agree=0; for(let k=0;k<hues.length;k++)if(circularHueDelta(hues[k],hue)<=FILL_HUE_TOLERANCE)agree++;
    const dom=agree/Math.max(1,hues.length);
    if(dom<FILL_DOMINANT_SHARE)return {zoned:false,why:'on-a-boundary',h:hue,n:n,paper:paper,fraction:frac,dominance:dom};   /* [222-D] */
    return {zoned:true,h:hue,s:ss/n,v:sv/n,n:n,paper:paper,fraction:frac,dominance:dom};
  }

  /* Single-link on the circle. Sorted by hue, a gap wider than the tolerance
     starts a new group, then the last group is merged into the first if they
     meet across 0/360 - otherwise a red fill splits into "358 deg" and "3 deg". */
  function clusterHues(items){
    if(!items.length)return [];
    const a=items.slice().sort((p,q)=>p.h-q.h);
    const out=[[a[0]]];
    for(let i=1;i<a.length;i++){
      const prev=out[out.length-1];
      if(circularHueDelta(a[i].h, prev[prev.length-1].h)<=FILL_HUE_TOLERANCE)prev.push(a[i]);
      else out.push([a[i]]);
    }
    if(out.length>1){
      const first=out[0], last=out[out.length-1];
      if(circularHueDelta(first[0].h, last[last.length-1].h)<=FILL_HUE_TOLERANCE){
        out[0]=last.concat(first); out.pop();
      }
    }
    return out;
  }

  function meanHue(list){
    let sx=0,sy=0,ss=0,sv=0;
    list.forEach(x=>{const wt=Math.max(.1,x.s);sx+=Math.cos(x.h*Math.PI/180)*wt;sy+=Math.sin(x.h*Math.PI/180)*wt;ss+=x.s;sv+=x.v;});
    let h=Math.atan2(sy,sx)*180/Math.PI; if(h<0)h+=360;
    return {h,s:ss/list.length,v:sv/list.length};
  }

  function hsvCss(h,s,v){
    const c=v*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=v-c;
    let r=0,g=0,b=0;
    if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;} else if(h<180){g=c;b=x;}
    else if(h<240){g=x;b=c;} else if(h<300){r=x;b=c;} else {r=c;b=x;}
    const f=n=>Math.round((n+m)*255);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  function sampleFillZones(){
    if(!session)throw new Error('Start a Smart Plan session first.');
    const live=livePlanImage(); if(!live)throw new Error('No decoded Workspace plan is available.');
    const cands=session.candidates.filter(c=>c.decision!=='rejected');
    if(!cands.length)throw new Error('Find some symbols first - the zone colour is read from under each one.');
    const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height;
    const cv=document.createElement('canvas'); cv.width=iw; cv.height=ih;
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(live,0,0,iw,ih);
    const hues=[]; let plain=0; const zoneDiag=[];   /* [221-D] */
    cands.forEach(c=>{
      const b=(c.meta&&Array.isArray(c.meta.bbox)&&c.meta.bbox.length===4)?c.meta.bbox
             :[Number(c.obj.x)-9,Number(c.obj.y)-9,18,18];
      const r=fillRingHue(ctx,b),got=!!(r&&r.zoned);   /* [222-D] */
      if(got)hues.push({id:c.id,h:r.h,s:r.s,v:r.v,n:r.n}); else plain++;
      zoneDiag.push({id:c.id,x:Number(c.obj.x),y:Number(c.obj.y),hue:(r&&r.h!=null)?Math.round(r.h):null,
        colour:r?r.n:null,paper:r?r.paper:null,fraction:r?Math.round(r.fraction*100)/100:null,
        dominance:r?Math.round(r.dominance*100)/100:null,why:got?'':((r&&r.why)||'no-sample'),zoned:got});   /* [221-D] [222-D] */
    });
    const groups=clusterHues(hues).map((list,i)=>{
      const m=meanHue(list);
      return {id:`fill-${i+1}`,hue:m.h,sat:m.s,val:m.v,css:hsvCss(m.h,m.s,m.v),
              zone:'',members:list.map(x=>x.id),count:list.length};
    }).sort((a,b)=>b.count-a.count);
    /* carry a zone number already typed for a colour that is still here */
    const old=(session.fillZones&&session.fillZones.groups)||[];
    groups.forEach(g=>{const prev=old.find(o=>circularHueDelta(o.hue,g.hue)<=FILL_HUE_TOLERANCE&&field(o.zone));if(prev){g.zone=prev.zone;g.zoneFrom=prev.zoneFrom||'';g.zoneNames=prev.zoneNames||[];}});   /* [229-1] read or typed rides with the name */
    session.fillZones={groups,sampled:cands.length,plain,diag:zoneDiag,at:Date.now()};
    zoneLog('sample',{sampled:cands.length,groups:groups.length,plain});   /* [229-1] */
    session.zoneStatus=groups.length
      ? `${groups.length} colour${groups.length===1?'':'s'} under ${cands.length-plain} of ${cands.length} symbols. Name each one.`
      : `No coloured fill under any symbol - this plan's zones are not colour areas.`;
    render();
    return clone(session.fillZones);
  }

  function setFillZone(groupId, zone){
    if(!session||!session.fillZones)throw new Error('Find the zones by colour first.');
    const g=session.fillZones.groups.find(x=>x.id===groupId);
    if(!g)throw new Error('No such colour group.');
    g.zone=normaliseScheduleZone(zone); g.zoneFrom=(g.zoneNames&&g.zoneNames.length===1&&g.zoneNames[0]===g.zone)?'sheet':'typed';   /* [225-B] */
    return g.zone;
  }

  /* Writing is its own step so a half-typed set of numbers never lands in Review.
     A zone he typed himself, or one off the panel schedule, always wins; only a
     zone this pass wrote is ever overwritten by this pass. */
  function applyFillZones(){
    if(!session||!session.fillZones)throw new Error('Find the zones by colour first.');
    const byId=new Map(session.candidates.map(c=>[c.id,c]));
    let set=0, cleared=0;
    session.fillZones.groups.forEach(g=>{
      const z=field(g.zone);
      g.members.forEach(id=>{
        const c=byId.get(id); if(!c||c.decision==='rejected')return;
        const owned=(c.meta.zoneSource==='fill');
        if(c.meta.zoneSource==='user')return;   /* [232-B] his - typed or taken off - is never put back by colour */
        if(z){ if(owned||!field(c.obj.zone)){c.obj.zone=z;c.meta.zoneSource='fill';set++;} }
        else if(owned){ c.obj.zone='';c.meta.zoneSource='';cleared++; }
      });
    });
    if(session.schedule.length)reconcileSchedule(true); else refreshIssues();
    session.zoneStatus=`${set} symbol${set===1?'':'s'} zoned by colour${cleared?`, ${cleared} cleared`:''}.`;
    zoneLog('apply',{set,cleared,groups:session.fillZones.groups.length});   /* [229-1] */
    render();
    return {set,cleared};
  }

  /* [225-A] ---- the zone names, read off the sheet ------------------------------ */
  function zoneLabelWords(tsv, scale){
    return tsvWords(tsv).map(w=>({text:w.text,conf:w.confidence,block:w.block_num,par:w.par_num,line:w.line_num,word:w.word_num,
      x:w.bbox.x0/scale,y:w.bbox.y0/scale,w:(w.bbox.x1-w.bbox.x0)/scale,h:(w.bbox.y1-w.bbox.y0)/scale}));
  }
  function zoneLabelsFromWords(words){
    const out=[], orphans=[]; const used=new Set();
    words.forEach((w,i)=>{
      if(used.has(i))return;
      let m=ZONE_LABEL_RE.exec(w.text);
      if(m){used.add(i);out.push({zone:String(Number(m[1])),text:w.text,bbox:[w.x,w.y,w.w,w.h],conf:w.conf});return;}
      if(!ZONE_LABEL_WORD_RE.test(w.text))return;
      /* the number is the nearest word that starts with digits and sits on the same row just
         right of ZONE - by GEOMETRY, not by tesseract's line and word numbering, which put
         one of his 5s on its own line */
      let j=-1,best=1e9;
      words.forEach((v,k)=>{if(k===i||used.has(k)||!ZONE_LABEL_NUM_RE.test(v.text))return;
        const gap=v.x-(w.x+w.w), dy=Math.abs((v.y+v.h/2)-(w.y+w.h/2));
        if(gap<-1.0*w.h||gap>2*w.h||dy>0.6*w.h)return; if(gap<best){best=gap;j=k;}});   /* the word's box often swallows part of the digit: gap may be negative */
      const v=j>=0?words[j]:null, n=v?ZONE_LABEL_NUM_RE.exec(v.text):null;
      if(!n){used.add(i);orphans.push(w);return;}   /* the word ZONE with no number beside it - looked at again, closer */
      used.add(i);used.add(j);
      const x0=Math.min(w.x,v.x),y0=Math.min(w.y,v.y),x1=Math.max(w.x+w.w,v.x+v.w),y1=Math.max(w.y+w.h,v.y+v.h);
      out.push({zone:String(Number(n[1])),text:w.text+' '+v.text,bbox:[x0,y0,x1-x0,y1-y0],conf:Math.min(w.conf,v.conf)});
    });
    return {labels:out,orphans};
  }
  /* [225-A] THE SECOND LOOK. On his own sheet one of the eight labels came back as the
     word ZONE with its 4 lost - the sparse pass had glued the digit to a door swing
     beside it. The digit is still there, so the strip just right of the word is read
     again on its own, at 1x, as a single line: one small crop per orphan, digits only. */
  async function zoneDigitRead(worker, live, w){
    const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height, k=ZONE_DIGIT_UPSCALE;
    const votes=[];   /* [zone, x1, y0, y1, conf] per strip that read as a bare number */
    for(const from of ZONE_DIGIT_FROM){
      const x0=Math.max(0,Math.round(w.x+w.w+from*w.h)), y0=Math.max(0,Math.round(w.y-w.h*0.5));
      const cw=Math.min(iw-x0,Math.round(w.h*ZONE_DIGIT_REACH)), ch=Math.min(ih-y0,Math.round(w.h*2));
      if(cw<4||ch<4)continue;
      const cv=document.createElement('canvas'); cv.width=cw*k; cv.height=ch*k;
      const ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.drawImage(live,x0,y0,cw,ch,0,0,cv.width,cv.height);
      for(const psm of ZONE_DIGIT_PSM){
        if(worker.setParameters) await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
        const res=await worker.recognize(cv,{},{text:true,tsv:true});
        /* the strip must read as a NUMBER and little else - a letter in it means the crop
           caught the word, a symbol or a wall */
        const m=/^[^0-9A-Za-z]{0,2}(\d{1,3})[^0-9A-Za-z]{0,3}$/.exec(String(res&&res.data&&res.data.text||'').trim());
        if(!m)continue;
        const t=tsvWords(res&&res.data?res.data.tsv:'').find(x=>/\d/.test(x.text));
        votes.push([String(Number(m[1])), t?x0+t.bbox.x1/k:x0+cw, t?y0+t.bbox.y0/k:w.y, t?y0+t.bbox.y1/k:w.y+w.h, t?(Number(t.confidence)||0):0]);
      }
      cv.width=1; cv.height=1;
    }
    if(!votes.length)return null;
    /* a lone digit is the reader's weakest case - a 7 came back as 2 from one strip and
       as 7 from five - so the strips and modes VOTE, and the first strip breaks a tie */
    const tally=new Map(); votes.forEach(v=>tally.set(v[0],(tally.get(v[0])||0)+1));
    let zone=votes[0][0]; tally.forEach((n,z)=>{if(n>tally.get(zone))zone=z;});
    const v=votes.find(x=>x[0]===zone);
    const by0=Math.min(w.y,v[2]), by1=Math.max(w.y+w.h,v[3]);
    return {zone,text:w.text+' '+zone,bbox:[w.x,by0,v[1]-w.x,by1-by0],conf:Math.min(w.conf,v[4]),second:true,votes:votes.length};
  }
  /* two masks over the whole sheet: LINE (anything darker than the leader grey) for the
     walk, INK (the fill rule's own ink) for the dot. One pass over the pixels. */
  function zoneMasks(d,w,h){
    const line=new Uint8Array(w*h), ink=new Uint8Array(w*h);
    for(let i=0,p=0;i<w*h;i++,p+=4){
      if(d[p+3]<128)continue;
      const v=Math.max(d[p],d[p+1],d[p+2])/255;
      if(v<ZONE_LEADER_V)line[i]=1;
      if(v<FILL_INK_VAL)ink[i]=1;
    }
    return {line,ink,w,h};
  }
  /* [225-A] THE READER SEES A SHEET WITHOUT ITS THIN LINES. Every failure the sparse pass
     had on his two sheets was a leader, a door swing or a wall drawn against a label: the
     4 glued to a door swing, a 2 read as S, a 6 read as a symbol. A 3x3 opening on the
     line mask erases anything one or two pixels wide - leaders, walls, room names, the
     symbol numbers - and leaves the 4 px strokes of a 30 px label untouched. The walk to
     the dot still runs on the ORIGINAL pixels; only the reader gets the cleaned copy.
     Measured on his two sheets: before this, 7 of 8 and 7 of 8 with a different label
     lost each time; after it, 8 of 8 and 8 of 8, every one as ZONE plus its digit. */
  function zoneCleanCanvas(id,m){
    const w=m.w,h=m.h,n=w*h,src=m.line,er=new Uint8Array(n),keep=new Uint8Array(n);
    for(let y=1;y<h-1;y++){const r=y*w;for(let x=1;x<w-1;x++){const i=r+x;if(!src[i])continue;
      if(src[i-1]&&src[i+1]&&src[i-w]&&src[i+w]&&src[i-w-1]&&src[i-w+1]&&src[i+w-1]&&src[i+w+1])er[i]=1;}}
    for(let y=1;y<h-1;y++){const r=y*w;for(let x=1;x<w-1;x++){const i=r+x;if(!er[i])continue;
      keep[i]=1;keep[i-1]=1;keep[i+1]=1;keep[i-w]=1;keep[i+w]=1;keep[i-w-1]=1;keep[i-w+1]=1;keep[i+w-1]=1;keep[i+w+1]=1;}}
    /* and the STUMPS go too: small text (room names, asset codes) is 2 px thick, so the
       opening leaves broken fragments of it that the reader then glues to a nearby label
       - his ZONE 6 came back as ZONE(R) with STAFF ACCOMMODATION's stumps under it. Any
       connected piece shorter than ZONE_STUMP_H is erased; a label's letters are 30 px. */
    const seen=new Uint8Array(n),stack=new Int32Array(n);
    for(let s0=0;s0<n;s0++){if(!keep[s0]||seen[s0])continue;let sp=0;stack[sp++]=s0;seen[s0]=1;const comp=[];let y0=h,y1=-1;
      while(sp){const i=stack[--sp];comp.push(i);const y=(i/w)|0,x=i-y*w;if(y<y0)y0=y;if(y>y1)y1=y;
        if(x>0&&keep[i-1]&&!seen[i-1]){seen[i-1]=1;stack[sp++]=i-1;}
        if(x<w-1&&keep[i+1]&&!seen[i+1]){seen[i+1]=1;stack[sp++]=i+1;}
        if(y>0&&keep[i-w]&&!seen[i-w]){seen[i-w]=1;stack[sp++]=i-w;}
        if(y<h-1&&keep[i+w]&&!seen[i+w]){seen[i+w]=1;stack[sp++]=i+w;}}
      if(y1-y0+1<ZONE_STUMP_H)for(const i of comp)keep[i]=0;}
    const d=new Uint8ClampedArray(id.data);
    for(let i=0,p=0;i<n;i++,p+=4){if(src[i]&&!keep[i]){d[p]=255;d[p+1]=255;d[p+2]=255;d[p+3]=255;}}
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    cv.getContext('2d').putImageData(new ImageData(d,w,h),0,0);
    return cv;
  }
  function zmAny(m,x,y0,y1){ if(x<0||x>=m.w)return false; for(let y=Math.max(0,y0);y<=Math.min(m.h-1,y1);y++)if(m.line[y*m.w+x])return true; return false; }
  function zmThin(m,x,y){ return zmAny(m,x,y-1,y+1)&&!zmAny(m,x,y-3,y-2)&&!zmAny(m,x,y+2,y+3); }
  function zoneLeaderH(m,bbox){
    const [bx,by,bw,bh]=bbox; let best=null;
    [[1,bx+bw],[-1,bx]].forEach(([dirn,edge])=>{
      for(let yy=Math.max(2,Math.round(by)-4);yy<=Math.min(m.h-3,Math.round(by+bh)+4);yy++){
        let xx=Math.round(edge)-ZONE_LEADER_NEAR*dirn, start=null, last=null, miss=0; const runs=[];
        for(let k=0;k<ZONE_LEADER_NEAR+ZONE_LEADER_REACH;k++,xx+=dirn){
          if(xx>=0&&xx<m.w&&zmThin(m,xx,yy)){ if(start===null)start=xx; last=xx; miss=0; }
          else if(start!==null&&++miss>ZONE_LEADER_GAP){ runs.push([start,last]); start=null; miss=0; }
        }
        if(start!==null)runs.push([start,last]);
        runs.forEach(([s0,e])=>{
          const len=(e-s0)*dirn; if(len<ZONE_LEADER_MIN)return;
          if((e-edge)*dirn<-ZONE_LEADER_BACK)return;          /* ends inside the words: a letter, not a leader */
          const near=Math.abs(s0-edge); if(near>ZONE_LEADER_NEAR)return;   /* starts away from the words: a wall */
          if(!best||near<best.near||(near===best.near&&len>best.len))best={len,dirn,row:yy,xe:e,near};
        });
      }
    });
    return best;
  }
  function zoneLeaderV(m,x,y0,dirn){
    let y=y0, last=null, miss=0, dot=null, wide=0;
    for(let n=0;n<ZONE_LEADER_RUN&&y>=0&&y<m.h;n++,y+=dirn){
      if(zmAny(m,x,y,y)||zmAny(m,x-1,y,y)||zmAny(m,x+1,y,y)){
        last=y; miss=0;
        let lft=0,rgt=0; const row=y*m.w;
        for(let k=1;k<=ZONE_DOT_HALF;k++){ if(x-k>=0&&m.ink[row+x-k])lft++; if(x+k<m.w&&m.ink[row+x+k])rgt++; }
        const wdt=lft+rgt+(m.ink[row+x]?1:0);
        wide=(wdt>=ZONE_DOT_MIN&&wdt<=ZONE_DOT_MAX&&lft>=ZONE_DOT_SIDE&&rgt>=ZONE_DOT_SIDE)?wide+1:0;
        if(wide>=ZONE_DOT_ROWS&&dot===null&&n>ZONE_LEADER_TURN)dot=y-Math.floor(ZONE_DOT_ROWS/2);
      } else if(++miss>ZONE_LEADER_GAP)break;   /* blank from the corner is no leader at all */
    }
    return {last,dot};
  }
  function zoneLeaderAnchor(m,bbox){
    const H=zoneLeaderH(m,bbox); if(!H)return null;
    let best=null;
    [-1,1].forEach(d=>{[H.xe,H.xe+H.dirn,H.xe+2*H.dirn].forEach(xc=>{
      const r=zoneLeaderV(m,xc,H.row,d); if(r.last===null)return;
      const len=Math.abs(r.last-H.row); if(len<ZONE_LEADER_TURN)return;
      if(!best||len>best.len)best={len,x:xc,y:(r.dot!==null?r.dot:r.last),dot:r.dot!==null};
    });});
    if(best)return {x:best.x,y:best.y,how:'leader'+(best.dot?'-dot':'-end')};
    return {x:H.xe,y:H.row,how:'leader-h'};
  }
  async function readZoneNames(){
    if(!session)throw new Error('Start a Smart Plan session first.');
    if(!session.fillZones||!session.fillZones.groups.length)throw new Error('Find the zones by colour first.');
    const live=livePlanImage(); if(!live)throw new Error('No decoded Workspace plan is available.');
    if(session.zoneNamesBusy)return null;
    const f=session.fillZones; const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height;
    session.zoneNamesBusy=true; session.zoneStatus='Reading the zone names off the sheet…'; render();
    const started=Date.now();
    try{
      const worker=await ensureOcrWorker();
      const cv=document.createElement('canvas'); cv.width=iw; cv.height=ih;
      const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(live,0,0,iw,ih);
      const id=ctx.getImageData(0,0,iw,ih);
      const m=zoneMasks(id.data,iw,ih);          /* the walk to the dot runs on the original pixels */
      const clean=zoneCleanCanvas(id,m);         /* the reader gets the sheet without its thin lines */
      /* TWO PASSES, cleaned sheet first, then the sheet as drawn. Measured on his two
         sheets: each pass alone loses one label - a different one each time, because the
         sparse reader's blocks fall differently around the lines - and the two together
         lose none. A label is the same label when its box sits where the other pass's
         did; the reading with the higher confidence wins, and a ZONE word with no
         number in EITHER pass gets the second look. */
      const sw=Math.max(1,Math.round(iw*ZONE_LABEL_SCALE)), sh=Math.max(1,Math.round(ih*ZONE_LABEL_SCALE));
      if(worker.setParameters) await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
      const labels=[], orphans=[];
      const same=(a,b)=>Math.abs((a[0]+a[2]/2)-(b[0]+b[2]/2))<Math.max(a[3],b[3])*2&&Math.abs((a[1]+a[3]/2)-(b[1]+b[3]/2))<Math.max(a[3],b[3]);
      for(const source of [clean,live]){
        const small=document.createElement('canvas'); small.width=sw; small.height=sh;
        small.getContext('2d').drawImage(source,0,0,sw,sh);
        const res=await worker.recognize(small,{},{text:true,tsv:true});
        small.width=1; small.height=1;
        const found=zoneLabelsFromWords(zoneLabelWords(res&&res.data?res.data.tsv:'',ZONE_LABEL_SCALE));
        found.labels.forEach(L=>{L.pass=source===clean?'clean':'drawn';const k=labels.findIndex(x=>same(x.bbox,L.bbox));
          if(k<0)labels.push(L); else if(L.zone!==labels[k].zone&&L.conf>labels[k].conf)labels[k]=L;});
        found.orphans.forEach(w=>{const b=[w.x,w.y,w.w,w.h];if(!orphans.some(o=>same([o.x,o.y,o.w,o.h],b)))orphans.push(w);});
      }
      for(const w of orphans){ if(labels.some(x=>same(x.bbox,[w.x,w.y,w.w,w.h])))continue;
        try{ const L=await zoneDigitRead(worker,clean,w); if(L)labels.push(L); }catch(_){} }
      clean.width=1; clean.height=1;
      labels.forEach(L=>{
        const a=m?zoneLeaderAnchor(m,L.bbox):null;
        L.anchor=a?[a.x,a.y]:[L.bbox[0]+L.bbox[2]/2,L.bbox[1]+L.bbox[3]/2]; L.how=a?a.how:'label';
        const r=a?fillRingHue(ctx,[a.x-ZONE_ANCHOR_HALF,a.y-ZONE_ANCHOR_HALF,2*ZONE_ANCHOR_HALF,2*ZONE_ANCHOR_HALF]):fillRingHue(ctx,L.bbox);
        L.hue=(r&&r.zoned)?Math.round(r.h):null; L.group='';
        if(L.hue==null)return;
        let g=null; f.groups.forEach(x=>{const d=circularHueDelta(x.hue,L.hue); if(d<=FILL_HUE_TOLERANCE&&(!g||d<g.d))g={d,id:x.id};});
        if(g)L.group=g.id;
      });
      let named=0;
      f.groups.forEach(g=>{
        const names=Array.from(new Set(labels.filter(L=>L.group===g.id).map(L=>L.zone)));
        g.zoneNames=names; g.zoneConflict=names.length>1;
        if(g.zoneFrom==='sheet'){g.zone='';g.zoneFrom='';}          /* a previous read never outranks this one */
        if(names.length===1&&!field(g.zone)){g.zone=names[0];g.zoneFrom='sheet';named++;}
        else if(names.length===1&&g.zone===names[0]){g.zoneFrom='sheet';named++;}
      });
      const conflicts=f.groups.filter(g=>g.zoneConflict).length;
      f.labels=labels.map(L=>({zone:L.zone,text:L.text,bbox:L.bbox.map(v=>Math.round(v)),anchor:L.anchor.map(v=>Math.round(v)),how:L.how,hue:L.hue,group:L.group,conf:Math.round(L.conf),pass:L.pass||'second',second:!!L.second}));
      f.named=named; f.readMs=Date.now()-started;
      /* [226-1] his ruling on the V0.204 walk: a CLEAN read goes straight on. Clean = every colour
         named and none with two names. The same applyFillZones() the button runs - nothing lands
         that the button would not have put there. Anything short of clean is exactly as before:
         the boxes fill, the refusal shows its reason, and the button waits for him. */
      const cleanRead=labels.length>0&&f.groups.length>0&&named===f.groups.length&&conflicts===0;
      f.autoApplied=false;
      zoneLog('read',{labels:labels.length,named,conflicts});   /* [229-1] */
      if(cleanRead){const put=applyFillZones();f.autoApplied=true;f.applied=put.set;
        session.zoneStatus=`${f.groups.length} colour${f.groups.length===1?'':'s'} under ${f.sampled-f.plain} of ${f.sampled} symbols. ${named} named off the sheet and put on ${put.set} symbol${put.set===1?'':'s'} - check Review if one looks wrong.`;}
      else session.zoneStatus=labels.length
        ?`${f.groups.length} colour${f.groups.length===1?'':'s'} under ${f.sampled-f.plain} of ${f.sampled} symbols. ${named} named off the sheet${conflicts?`, ${conflicts} with two names`:''} - check them, then put them on.`
        :`${f.groups.length} colour${f.groups.length===1?'':'s'} under ${f.sampled-f.plain} of ${f.sampled} symbols. No zone names found on the sheet - name each one.`;
      return clone(f);
    } catch(e){
      f.labels=[]; f.named=0; f.readError=(e&&e.message)||String(e);
      session.zoneStatus=`${f.groups.length} colour${f.groups.length===1?'':'s'} under ${f.sampled-f.plain} of ${f.sampled} symbols. Could not read the zone names (${f.readError}) - name each one.`;
      return clone(f);
    } finally { session.zoneNamesBusy=false; render(); }
  }

  function fillZoneRowsHtml(){
    const f=session&&session.fillZones; if(!f)return '';
    if(!f.groups.length)return `<div class="spHint" style="margin-top:8px">No coloured fill was found under any symbol.</div>`;
    const rows=f.groups.map(g=>`<div class="spFillRow"><span class="spSwatch" style="background:${g.css}"></span>`
      +`<span class="spFillN">${g.count} symbol${g.count===1?'':'s'}`
      +(g.zoneConflict?`<span class="spFillHint" data-sp="fillread">two names on the sheet: ${escapeHtml((g.zoneNames||[]).join(' and '))}</span>`
        :(g.zoneFrom==='sheet'&&field(g.zone)?`<span class="spFillHint" data-sp="fillread">read off the sheet</span>`:''))   /* [225-B] */
      +`</span>`
      +`<input data-sp="fillzone" data-gid="${escapeHtml(g.id)}" value="${escapeHtml(g.zone)}" placeholder="Zone" maxlength="5" inputmode="numeric"></div>`).join('');
    return `<div class="spFillList">${rows}</div>`
      +(session.zoneNamesBusy?`<div class="spHint" style="margin-top:6px" data-sp="fillreading">Reading the zone names off the sheet…</div>`:'')   /* [225-B] */
      +(f.plain?`<div class="spHint" style="margin-top:6px">${f.plain} symbol${f.plain===1?'':'s'} sit on no colour and will stay unzoned.</div>`:'')
      +`<button class="btn spPrimary spBig" data-sp="fillapply" style="margin-top:9px">Put these zones on the symbols</button>`;
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
    session=null;hires=null;   /* [218-D] ~90 MB of tiles go with the session */
    const m=document.getElementById(MODAL_ID); if(m) m.style.display='none';
  }


  function start(options) {
    options=options||{};
    return stage({
      coordinateSpace:EXPECTED_COORD_SPACE,
      source:{kind:'native-workspace',coordinateSpace:EXPECTED_COORD_SPACE,name:field(options.name)||'Current Workspace'},
      areas:{exclude:[],include:[]},candidates:[],zones:[],schedule:clone(options.schedule||[]).map(normaliseScheduleRow).filter(Boolean),scheduleSource:null,scheduleReport:null
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
  /* [226-A] ---- the drawing's own geometry ---------------------------------------- */
  /* Every closed axis-aligned square the PDF draws, in plan px, read once per plan and
     kept on the session. Paths come out of pdf.js as constructPath ops with their own
     coordinate stack (save / restore / transform / form XObjects), so the walk keeps a
     matrix and converts through the viewport the plan was rendered with, then subtracts
     the region he kept (src.dx / src.dy) - the same mapping the hi-res reader uses. */
  function vecMul(m,n){return [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];}
  function vecSquaresFromSegments(px){
    const H=[],V=[];
    for(const [x0,y0,x1,y1] of px){const L=Math.hypot(x1-x0,y1-y0);if(L<VEC_SIDE_MIN||L>VEC_SIDE_MAX)continue;
      if(Math.abs(y1-y0)<0.35)H.push([Math.min(x0,x1),(y0+y1)/2,Math.max(x0,x1)]);else if(Math.abs(x1-x0)<0.35)V.push([(x0+x1)/2,Math.min(y0,y1),Math.max(y0,y1)]);}
    const vix=new Map(),hix=new Map();
    for(const v of V){const k=Math.round(v[0]);(vix.get(k)||vix.set(k,[]).get(k)).push(v);}
    for(const h of H){const k=Math.round(h[1]);(hix.get(k)||hix.set(k,[]).get(k)).push(h);}
    const near=(m,k)=>[].concat(m.get(k-1)||[],m.get(k)||[],m.get(k+1)||[]);
    const T=VEC_CORNER_TOL,out=[];
    for(const [x,y,x1] of H){const L=x1-x;
      for(const [x2,y2,x3] of near(hix,Math.round(y+L))){
        if(Math.abs(x2-x)>T||Math.abs(x3-x1)>T||Math.abs(y2-(y+L))>T)continue;
        const lv=near(vix,Math.round(x)).some(v=>Math.abs(v[0]-x)<=T&&Math.abs(v[1]-y)<=T&&Math.abs(v[2]-y2)<=T);
        const rv=near(vix,Math.round(x1)).some(v=>Math.abs(v[0]-x1)<=T&&Math.abs(v[1]-y)<=T&&Math.abs(v[2]-y2)<=T);
        if(lv&&rv&&!out.some(o=>Math.abs(o.x-(x+L/2))<1.5&&Math.abs(o.y-(y+L/2))<1.5))out.push({x:x+L/2,y:y+L/2,side:L});}}
    return {squares:out,h:H.length,v:V.length};
  }
  async function vectorSquares(){
    const src=planSource(); if(!src)return {squares:null,why:'no-source-pdf'};
    if(session.vector&&session.vector.src===src)return session.vector;
    const started=performance.now?performance.now():Date.now();
    try{
      if(typeof ensurePdfJs!=='function')return {squares:null,why:'no-pdfjs-loader'};
      await ensurePdfJs(); if(!window.pdfjsLib)return {squares:null,why:'pdfjs-did-not-load'};
      const bin=atob(src.b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      const pdf=await window.pdfjsLib.getDocument({data:u}).promise,page=await pdf.getPage(src.page||1);
      const vp=page.getViewport({scale:src.scale||1}),ol=await page.getOperatorList(),O=window.pdfjsLib.OPS;
      const paths=[];let ctm=[1,0,0,1,0,0];const stack=[];let cur=null,start=null;let sub=null,black=true;   /* [228-A] the glyph pieces need the polylines and the stroke colour */
      const ap=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
      const FILL=new Set([O.fill,O.eoFill,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke]);
      const STROKE=new Set([O.stroke,O.closeStroke,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke]);   /* [228-A] */
      for(let i=0;i<ol.fnArray.length;i++){const fn=ol.fnArray[i],a=ol.argsArray[i];
        if(fn===O.save)stack.push(ctm.slice());
        else if(fn===O.restore){if(stack.length)ctm=stack.pop();}
        else if(fn===O.transform)ctm=vecMul(ctm,a);
        else if(fn===O.paintFormXObjectBegin){stack.push(ctm.slice());if(a&&a[0])ctm=vecMul(ctm,a[0]);}
        else if(fn===O.paintFormXObjectEnd){if(stack.length)ctm=stack.pop();}
        else if(fn===O.setStrokeRGBColor){const rgb=a?Array.from(a).slice(0,3):[];black=rgb.length===3&&rgb.every(v=>Number(v)<=64);}   /* [228-A] pdf.js hands the colour over as 0..255; a digit is black, a room code on his sheet is not */
        else if(fn===O.setStrokeGray){const g=Number(a&&a[0]);black=g<=0.25||(g>1&&g<=64);}
        else if(fn===O.setStrokeCMYKColor){const k=Number(a&&a[3]);black=k>=0.75||(k>1&&k>=191);}
        else if(fn===O.constructPath){const ops=a[0],c=a[1];let k=0;const segs=[],subs=[];sub=null;
          for(const op of ops){
            if(op===O.moveTo){cur=ap(ctm,c[k],c[k+1]);start=cur;k+=2;sub=[cur];subs.push(sub);}
            else if(op===O.lineTo){const p=ap(ctm,c[k],c[k+1]);if(cur)segs.push([cur,p]);if(!sub&&cur){sub=[cur];subs.push(sub);}   /* [237-A] a stroke continuing the previous path keeps its polyline too */cur=p;k+=2;if(sub)sub.push(p);}
            else if(op===O.curveTo){const p=ap(ctm,c[k+4],c[k+5]);if(cur)segs.push([cur,p]);if(!sub&&cur){sub=[cur];subs.push(sub);}cur=p;k+=6;if(sub)sub.push(p);}
            else if(op===O.curveTo2||op===O.curveTo3){const p=ap(ctm,c[k+2],c[k+3]);if(cur)segs.push([cur,p]);if(!sub&&cur){sub=[cur];subs.push(sub);}cur=p;k+=4;if(sub)sub.push(p);}
            else if(op===O.closePath){if(cur&&start)segs.push([cur,start]);cur=start;if(sub&&start)sub.push(start);}
            else if(op===O.rectangle){const x=c[k],y=c[k+1],w=c[k+2],h=c[k+3];k+=4;const p=[ap(ctm,x,y),ap(ctm,x+w,y),ap(ctm,x+w,y+h),ap(ctm,x,y+h)];for(let q=0;q<4;q++)segs.push([p[q],p[(q+1)%4]]);cur=p[0];start=p[0];subs.push([p[0],p[1],p[2],p[3],p[0]]);}
          }
          /* the op after the path is how it is painted: a filled path is a solid shape (a sounder's triangle), a stroked one is lines */
          const nx=ol.fnArray[i+1];paths.push({segs,fill:FILL.has(nx),stroke:STROKE.has(nx),black,subs});}
      }
      const toPx=(p)=>{const A=vp.convertToViewportPoint(p[0],p[1]);return [A[0]-(src.dx||0),A[1]-(src.dy||0)];};
      const px=[],ppx=[],pieces=[],shapes=[];   /* [230-A] */
      paths.forEach(pt=>{const ss=pt.segs.map(([p,q])=>{const A=toPx(p),B=toPx(q);return [A[0],A[1],B[0],B[1]];});ss.forEach(v=>px.push(v));
        if(ss.length){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;ss.forEach(([a,b,c,d])=>{x0=Math.min(x0,a,c);y0=Math.min(y0,b,d);x1=Math.max(x1,a,c);y1=Math.max(y1,b,d);});ppx.push({segs:ss,fill:pt.fill,x0,y0,x1,y1});
          const small=x1-x0<=VEC_PIECE_MAX_PX&&y1-y0<=VEC_PIECE_MAX_PX,pl=(small||(x1-x0<=VEC_SHAPE_MAX_PX&&y1-y0<=VEC_SHAPE_MAX_PX))?pt.subs.filter(s=>s.length>=2).map(s=>s.map(toPx)):null;
          /* [228-A] a glyph piece: black, stroked, not filled, small */
          if(pt.stroke&&!pt.fill&&pt.black&&small)pieces.push({x0,y0,x1,y1,pl});
          /* [230-A] a shape: any path that is not a dot and no bigger than a symbol */
          if(pl&&pl.length&&(x1-x0>=0.2||y1-y0>=0.2)&&x1-x0<=VEC_SHAPE_MAX_PX&&y1-y0<=VEC_SHAPE_MAX_PX)shapes.push({x0,y0,x1,y1,pl,fill:pt.fill,len:vecShapeLen(pl)});}});
      const sq=vecSquaresFromSegments(px);
      vecSignatures(sq.squares,ppx);
      session.vector={src,squares:sq.squares,segments:px.length,pieces,shapes,ms:Math.round((performance.now?performance.now():Date.now())-started),why:''};   /* [228-A] [230-A] */
      try{pdf.destroy();}catch(_){}
      return session.vector;
    }catch(e){session.vector={src,squares:null,why:'vector-failed: '+((e&&e.message)||'unknown')};return session.vector;}
  }
  /* WHAT IS INSIDE EACH SQUARE, from the drawing: the strokes that begin AND end inside it
     (a loop wire running through has its ends outside and does not count - which is the
     whole reason the raster finder lost those smokes), and whether a filled shape sits in
     it (a sounder's solid triangle). A smoke on his sheet is 3 inner strokes and no fill;
     a thermal's hatch is 40-50; a sounder is a fill with 5-7. */
  function vecSignatures(squares,paths){
    const M=0.8;
    for(const s of squares){const h=s.side/2,x0=s.x-h,y0=s.y-h,x1=s.x+h,y1=s.y+h;let n=0,fill=false,len=0;const segs=[];
      for(const p of paths){if(p.x1<x0-M||p.x0>x1+M||p.y1<y0-M||p.y0>y1+M)continue;
        if(p.fill&&p.x0>=x0-M&&p.x1<=x1+M&&p.y0>=y0-M&&p.y1<=y1+M)fill=true;
        for(const [a,b,c,d] of p.segs){if(a>x0+M&&a<x1-M&&b>y0+M&&b<y1-M&&c>x0+M&&c<x1-M&&d>y0+M&&d<y1-M){n++;len+=Math.hypot(c-a,d-b);if(!p.fill&&Math.hypot(c-a,d-b)>=0.2)segs.push([a-s.x,b-s.y,c-s.x,d-s.y]);}}}
      s.inner=n;s.fill=fill;s.len=Math.round(len*10)/10;s.innerSegs=segs;   /* [233-B] the strokes themselves, about the centre */}
  }
  function vecSameSymbol(a,b){
    if(!!a.fill!==!!b.fill)return false;
    const ah=a.inner>=VEC_HATCH_MIN,bh=b.inner>=VEC_HATCH_MIN;
    if(ah||bh)return ah&&bh;                                                  /* two hatches: the hatch never repeats exactly */
    if(a.fill)return true;                                                    /* a filled shape: its outline strokes land on the square's own sides and count 0-5 by chance */
    if(Math.abs(a.inner-b.inner)>VEC_INNER_TOL)return false;
    return vecSameInside(a,b);   /* [233-B] the same count is not the same symbol */
  }
  function vecSameInside(a,b){
    /* [233-B] every stroke inside the square he showed sits inside the candidate too - in one of the 8 turns and flips, endpoints within VEC_INNER_GEOM_TOL either way round; extra strokes in the candidate are allowed up to VEC_INNER_TOL (a wire end) */
    const A=a.innerSegs||[],B=b.innerSegs||[];if(!A.length)return B.length<=VEC_INNER_TOL;
    if(B.length<A.length||B.length-A.length>VEC_INNER_TOL)return false;
    const T=VEC_INNER_GEOM_TOL,near=(x,y,u,v)=>Math.abs(x-u)<=T&&Math.abs(y-v)<=T;
    for(const m of VEC_SYMS){
      let ok=true;
      for(const [x0,y0,x1,y1] of A){const p=[m[0]*x0+m[1]*y0,m[2]*x0+m[3]*y0],q=[m[0]*x1+m[1]*y1,m[2]*x1+m[3]*y1];
        if(!B.some(([u0,v0,u1,v1])=>(near(p[0],p[1],u0,v0)&&near(q[0],q[1],u1,v1))||(near(p[0],p[1],u1,v1)&&near(q[0],q[1],u0,v0)))){ok=false;break;}}
      if(ok)return true;}
    return false;
  }
  /* The square he drew the box around names the size; every square of that size is a
     device; what is drawn inside it, against what is drawn inside the one he showed, says
     whether it is THIS device. */
  function vectorSideFor(squares,wb){
    const [ox,oy,ow,oh]=wb.original,cx=ox+ow/2,cy=oy+oh/2,lo=Math.min(ow,oh),hi=Math.max(ow,oh);
    const mine=squares.filter(s=>Math.abs(s.x-cx)<=ow/2&&Math.abs(s.y-cy)<=oh/2&&s.side>=VEC_TAUGHT_MIN*lo&&s.side<=VEC_TAUGHT_MAX*hi)   /* [230-A] its centre inside his box, not 2 px outside it */
      .sort((a,b)=>Math.abs(a.side-lo)-Math.abs(b.side-lo));
    return mine.length?mine[0].side:null;
  }

  /* [230-A] ---- any symbol drawn as paths --------------------------------------- */
  function vecShapeVerts(pl){const out=[];for(const s of pl)for(const q of s)out.push(q);return out;}
  function vecShapeLen(pl){let L=0;for(const s of pl)for(let i=0;i+1<s.length;i++)L+=Math.hypot(s[i+1][0]-s[i][0],s[i+1][1]-s[i][1]);return L;}
  /* [234-B] the digits on a sheet are one size whatever the symbol beside them: the reader's scale is the sheet's own - the median side of its squares - and the symbol's size only when the drawing has no squares. His concealed smoke is 5 x 10 px; at 10.2 the glyph window is 3.3-5.9 px and the sheet's digits are 6.5 */
  function vecLabelScale(vs,shp){if(vs&&vs.squares&&vs.squares.length){const s=vs.squares.map(q=>Number(q.side)).filter(x=>x>0).sort((a,b)=>a-b);if(s.length)return s[Math.floor(s.length/2)];}return Math.max(shp.w,shp.h);}
  function vecShapeIndex(vec){
    /* every vertex of every shape, by its rounded cell, once per sheet */
    if(vec.shapeIndex)return vec.shapeIndex;
    const ix=new Map();
    (vec.shapes||[]).forEach((s,i)=>{for(const v of vecShapeVerts(s.pl)){const k=Math.round(v[0])+','+Math.round(v[1]);const a=ix.get(k);if(a){if(a[a.length-1]!==i)a.push(i);}else ix.set(k,[i]);}});
    vec.shapeIndex=ix;return ix;
  }
  function vecShapeFor(box,shapes){
    /* the symbol inside the box he drew: pieces wholly inside, joined end to end; the longest joined group */
    if(!box||!shapes||!shapes.length)return null;
    const [bx,by,bw,bh]=box,T=VEC_SHAPE_TOL,inside=shapes.filter(s=>s.x0>=bx-T&&s.y0>=by-T&&s.x1<=bx+bw+T&&s.y1<=by+bh+T);
    if(!inside.length)return null;
    const near=(a,b)=>Math.abs(a[0]-b[0])<=T&&Math.abs(a[1]-b[1])<=T;
    const joined=(A,B)=>{for(const a of A){for(const b of B)if(near(a,b))return true;}return false;};
    const verts=inside.map(s=>vecShapeVerts(s.pl)),seen=new Array(inside.length).fill(false);let best=null;
    for(let i=0;i<inside.length;i++){if(seen[i])continue;const grp=[i];seen[i]=true;
      for(let g=0;g<grp.length;g++)for(let j=0;j<inside.length;j++){if(seen[j])continue;if(joined(verts[grp[g]],verts[j])){seen[j]=true;grp.push(j);}}
      const L=grp.reduce((a,k)=>a+inside[k].len,0);if(!best||L>best.L)best={grp,L};}
    if(!best||!(best.L>0))return null;
    const pcs=best.grp.map(k=>inside[k]);
    /* [231-A] his box clipped the cone: a stroke joined end to end to the symbol counts even when it crosses the edge
       of his box, as long as it touches the box at all. Still a shape (small), so a wall or a wire is never pulled in. */
    {const touching=shapes.filter(s=>!pcs.includes(s)&&s.x1>=bx-T&&s.x0<=bx+bw+T&&s.y1>=by-T&&s.y0<=by+bh+T);
      let grew=true;while(grew){grew=false;for(const s of touching){if(pcs.includes(s))continue;const V=vecShapeVerts(s.pl);if(pcs.some(p=>joined(vecShapeVerts(p.pl),V))){pcs.push(s);grew=true;}}}}
    best.L=pcs.reduce((a,s)=>a+s.len,0);   /* [231-A] the whole symbol's length, grown pieces included */
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;pcs.forEach(s=>{x0=Math.min(x0,s.x0);y0=Math.min(y0,s.y0);x1=Math.max(x1,s.x1);y1=Math.max(y1,s.y1);});
    const w=x1-x0,h=y1-y0;if(Math.max(w,h)<VEC_SHAPE_MIN_PX)return null;
    const cx=(x0+x1)/2,cy=(y0+y1)/2;
    const pieces=pcs.map(s=>({pl:s.pl.map(q=>q.map(v=>[v[0]-cx,v[1]-cy])),len:s.len,fill:!!s.fill}));
    let anchor=0;pieces.forEach((p,i)=>{if(p.len>pieces[anchor].len)anchor=i;});
    return {pieces,anchor,w,h,len:best.L,fill:pieces.some(p=>p.fill),cx,cy};
  }
  function vecPieceAt(pl,d,m,shapes,ix,sc){
    /* the sheet piece whose polylines are pl turned (and scaled, [231-B]) by m and moved by d, or -1 */
    const T=VEC_SHAPE_TOL*Math.max(1,sc||1),tp=pl.map(s=>s.map(([x,y])=>[m[0]*x+m[1]*y+d[0],m[2]*x+m[3]*y+d[1]]));
    const v0=tp[0][0],rx=Math.round(v0[0]),ry=Math.round(v0[1]);
    const R=Math.ceil(T);for(let ax=-R;ax<=R;ax++)for(let ay=-R;ay<=R;ay++){const c=ix.get((rx+ax)+','+(ry+ay));if(!c)continue;
      for(const i of c){const s=shapes[i];if(s.pl.length!==tp.length)continue;let ok=true;
        for(const q of tp){let hit=false;
          for(const sp of s.pl){if(sp.length!==q.length)continue;let f=true,r=true;
            for(let k=0;k<q.length;k++){const a=q[k],b=sp[k],c2=sp[q.length-1-k];if(f&&!(Math.abs(a[0]-b[0])<=T&&Math.abs(a[1]-b[1])<=T))f=false;if(r&&!(Math.abs(a[0]-c2[0])<=T&&Math.abs(a[1]-c2[1])<=T))r=false;if(!f&&!r)break;}
            if(f||r){hit=true;break;}}
          if(!hit){ok=false;break;}}
        if(ok)return i;}}
    return -1;
  }
  function vecShapeMatches(shape,shapes,ix){
    /* every place the shape repeats: the anchor piece first (same piece and vertex counts), then the rest around it.
       [231-B] a repeat may be the same strokes at another size: the anchor's length against the template's is the
       scale; the rest must match at that scale. Only for a symbol of three or more strokes. */
    const A=shape.pieces[shape.anchor],an=A.pl.length,av=vecShapeVerts(A.pl).length,a0=A.pl[0][0],hits=[],aLen=A.len||vecShapeLen(A.pl);
    const corners=[[-shape.w/2,-shape.h/2],[shape.w/2,-shape.h/2],[shape.w/2,shape.h/2],[-shape.w/2,shape.h/2]];
    const canScale=shape.pieces.length>=VEC_SHAPE_SCALE_MIN_PIECES;
    for(let i=0;i<shapes.length;i++){const s=shapes[i];if(s.pl.length!==an||vecShapeVerts(s.pl).length!==av)continue;
      let sc=aLen>0?(s.len||vecShapeLen(s.pl))/aLen:1;
      if(Math.abs(sc-1)<=VEC_SHAPE_SCALE_SAME)sc=1;else if(!canScale||sc<VEC_SHAPE_SCALE_MIN||sc>VEC_SHAPE_SCALE_MAX)continue;
      let placed=false;
      for(const m0 of VEC_SYMS){if(placed)break;const m=[m0[0]*sc,m0[1]*sc,m0[2]*sc,m0[3]*sc],ax=m[0]*a0[0]+m[1]*a0[1],ay=m[2]*a0[0]+m[3]*a0[1];
        for(const v of vecShapeVerts(s.pl)){const d=[v[0]-ax,v[1]-ay];
          if(vecPieceAt(A.pl,d,m,shapes,ix,sc)!==i)continue;
          let missing=0;for(let k=0;k<shape.pieces.length;k++){if(k===shape.anchor)continue;if(vecPieceAt(shape.pieces[k].pl,d,m,shapes,ix,sc)<0)missing+=shape.pieces[k].len;}
          if(missing>VEC_SHAPE_MISS_FRAC*shape.len)continue;
          const cs=corners.map(([x,y])=>[m[0]*x+m[1]*y+d[0],m[2]*x+m[3]*y+d[1]]),x0=Math.min(...cs.map(c=>c[0])),x1=Math.max(...cs.map(c=>c[0])),y0=Math.min(...cs.map(c=>c[1])),y1=Math.max(...cs.map(c=>c[1]));
          const cx=(x0+x1)/2,cy=(y0+y1)/2;if(hits.some(h=>Math.abs(h.cx-cx)<1.5&&Math.abs(h.cy-cy)<1.5)){placed=true;break;}
          hits.push({cx,cy,w:x1-x0,h:y1-y0,partial:missing>0,scale:sc===1?1:Math.round(sc*20)/20});placed=true;break;}}
    }
    /* a repeat missing a piece never stands where a whole one already stands: a symmetric symbol flipped onto itself would otherwise count twice */
    return hits.filter(h=>!h.partial||!hits.some(o=>!o.partial&&Math.abs(o.cx-h.cx)<(o.w+h.w)/2&&Math.abs(o.cy-h.cy)<(o.h+h.h)/2));
  }

  /* [228-A] ---- the numbers, read off the drawing --------------------------------- */
  function vecSamplePts(strokes,h,x0,y0){
    /* points every VEC_SAMPLE heights along every polyline, in units of glyph height, from the glyph's top-left */
    const out=[],step=VEC_SAMPLE;
    for(const s of strokes)for(let i=0;i+1<s.length;i++){
      const ax=(s[i][0]-x0)/h,ay=(s[i][1]-y0)/h,bx=(s[i+1][0]-x0)/h,by=(s[i+1][1]-y0)/h,L=Math.hypot(bx-ax,by-ay),n=Math.max(1,Math.ceil(L/step));
      for(let k=0;k<=n;k++){const t=k/n;out.push([ax+(bx-ax)*t,ay+(by-ay)*t]);}
    }
    return out;
  }
  function vecP90(p,q){
    /* the 90th-percentile nearest distance from p to q: a shape has to match nearly everywhere */
    const ds=new Float64Array(p.length);
    for(let i=0;i<p.length;i++){let best=1e9;const [x,y]=p[i];for(let j=0;j<q.length;j++){const dx=x-q[j][0],dy=y-q[j][1],d=dx*dx+dy*dy;if(d<best)best=d;}ds[i]=Math.sqrt(best);}
    ds.sort();return ds[Math.min(ds.length-1,Math.floor(ds.length*0.9))];
  }
  let vecTemplateCache=null;
  function vecTemplates(){
    if(vecTemplateCache)return vecTemplateCache;
    vecTemplateCache=VEC_DIGITS.map(t=>({d:t.d,pts:vecSamplePts(t.s,1,0,0)}));
    return vecTemplateCache;
  }
  function vecReadGlyph(strokes,b){
    const h=b[3]-b[1];if(!(h>0))return null;
    const pts=vecSamplePts(strokes,h,b[0],b[1]);
    const scores=vecTemplates().map(t=>({d:t.d,s:Math.max(vecP90(pts,t.pts),vecP90(t.pts,pts))})).sort((a,b)=>a.s-b.s);
    const best=scores[0],other=scores.find(x=>x.d!==best.d);
    if(best.s>VEC_GLYPH_TOL||(other&&other.s-best.s<VEC_GLYPH_MARGIN))return null;
    return best.d;
  }
  function vecLabelsFor(cx,cy,side,pieces){
    /* the pieces around one square -> glyphs -> words -> the digit words, nearest first */
    const reach=side*VEC_LABEL_REACH+side*0.6,half=side/2+0.02*side,gh=side*0.45;
    const near=[];
    for(const p of pieces){
      const mx=(p.x0+p.x1)/2,my=(p.y0+p.y1)/2;
      if(Math.abs(mx-cx)>reach||Math.abs(my-cy)>reach)continue;
      if(p.x0>=cx-half&&p.x1<=cx+half&&p.y0>=cy-half&&p.y1<=cy+half)continue;   /* inside the square: the symbol */
      near.push(p);
    }
    const tx=gh*VEC_TOUCH_X,ty=gh*VEC_TOUCH_Y;
    const glyphs=[];
    for(const p of near){
      const hit=glyphs.filter(g=>!(g.x1<p.x0-tx||p.x1<g.x0-tx||g.y1<p.y0-ty||p.y1<g.y0-ty));
      if(!hit.length){glyphs.push({x0:p.x0,y0:p.y0,x1:p.x1,y1:p.y1,pieces:[p]});continue;}
      const g=hit[0];g.pieces.push(p);g.x0=Math.min(g.x0,p.x0);g.y0=Math.min(g.y0,p.y0);g.x1=Math.max(g.x1,p.x1);g.y1=Math.max(g.y1,p.y1);
      for(const o of hit.slice(1)){g.pieces.push(...o.pieces);g.x0=Math.min(g.x0,o.x0);g.y0=Math.min(g.y0,o.y0);g.x1=Math.max(g.x1,o.x1);g.y1=Math.max(g.y1,o.y1);glyphs.splice(glyphs.indexOf(o),1);}
    }
    /* [237-B] a glyph drawn with a gap - a plotter dropped the strokes between an 8's loops (his 88, one of 204): two fragments, each too short to be a glyph, stacked in one column with a gap under VEC_STACK_GAP glyph heights, that together are glyph-sized, are one glyph */
    for(let i=0;i<glyphs.length;i++){const a=glyphs[i];if(a.y1-a.y0>=side*VEC_GLYPH_H_MIN)continue;
      for(let j=0;j<glyphs.length;j++){if(i===j)continue;const b=glyphs[j];if(b.y1-b.y0>=side*VEC_GLYPH_H_MIN)continue;
        const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),wmin=Math.min(a.x1-a.x0,b.x1-b.x0);if(wmin<=0||ox<0.8*wmin)continue;
        const gapY=Math.max(a.y0,b.y0)-Math.min(a.y1,b.y1);if(gapY<0||gapY>gh*VEC_STACK_GAP)continue;
        const uh=Math.max(a.y1,b.y1)-Math.min(a.y0,b.y0);if(uh<side*VEC_GLYPH_H_MIN||uh>side*VEC_GLYPH_H_MAX)continue;
        a.pieces.push(...b.pieces);a.x0=Math.min(a.x0,b.x0);a.y0=Math.min(a.y0,b.y0);a.x1=Math.max(a.x1,b.x1);a.y1=Math.max(a.y1,b.y1);glyphs.splice(j,1);if(j<i)i--;j=-1;}}
    const sized=glyphs.filter(g=>{const h=g.y1-g.y0,w=g.x1-g.x0;return h>=side*VEC_GLYPH_H_MIN&&h<=side*VEC_GLYPH_H_MAX&&w<=side*VEC_GLYPH_W_MAX;}).sort((a,b)=>a.x0-b.x0);
    const words=[];
    for(const g of sized){
      const h=g.y1-g.y0;let w=null;
      for(const x of words){if(Math.abs(x.bot-g.y1)<=h*VEC_WORD_BASE&&g.x0-x.x1<=h*VEC_WORD_GAP){w=x;break;}}
      if(w){w.g.push(g);w.x1=Math.max(w.x1,g.x1);w.top=Math.min(w.top,g.y0);}else words.push({g:[g],bot:g.y1,top:g.y0,x0:g.x0,x1:g.x1});
    }
    const out=[];let seen=0;
    for(const w of words){
      if(w.g.length>VEC_WORD_MAX)continue;
      const mx=(w.x0+w.x1)/2,my=(w.top+w.bot)/2,d=Math.max(Math.abs(mx-cx),Math.abs(my-cy));
      if(d>side*VEC_LABEL_REACH)continue;
      seen++;
      let text='';
      /* [233-C] a word is cut at the first glyph that is not a digit: a leading letter means a code (M12), a trailing one is dropped ('74 I' reads 74) */
      for(let gi=0;gi<w.g.length;gi++){const g=w.g[gi];const dgt=vecReadGlyph(g.pieces.flatMap(p=>p.pl),[g.x0,g.y0,g.x1,g.y1]);if(dgt===null){if(gi===0)text=null;break;}text+=dgt;}
      if(text===null||!text.length)continue;
      out.push({text,dist:d,bbox:[w.x0,w.top,w.x1-w.x0,w.bot-w.top]});
    }
    out.sort((a,b)=>a.dist-b.dist);
    return {words:out,seen};
  }
  function vecReadLabels(candidates,rawLabels){
    /* [228-A] every candidate the vector finder placed gets its number from the drawing, if
       the drawing has one beside it in the stroke font. Reads go into the same pool as the
       OCR's, so one label lands on one device and the OCR only looks at what is left. */
    const started=performance.now?performance.now():Date.now();
    const v=session.vector;const pieces=v&&v.pieces;
    if(!pieces||!pieces.length)return {candidates:0,reads:0,readCandidates:0,seen:0,ms:0,why:v?(v.why||'no-glyph-pieces'):'no-vector'};
    let reads=0,readCandidates=0,seen=0,n=0;
    candidates.forEach(c=>{
      if(!c.meta||c.meta.method!=='vector'||!(c.meta.vectorSide>0)||c.meta.noNumber||c.meta.devCleared)return;   /* [230-A] [232-B] */
      n++;const cx=Number(c.obj.x),cy=Number(c.obj.y),side=c.meta.vectorSide;
      const r=vecLabelsFor(cx,cy,side,pieces);seen+=r.seen;
      if(!r.words.length)return;
      const w=r.words[0],dev=String(parseInt(w.text,10));
      rawLabels.push({loop:'',dev,raw:w.text,text:w.text,confidence:100,bbox:w.bbox.slice(),votes:1,variant:'vector',psm:'',phase:'vector',observedNear:c.id,offsetX:0,offsetY:0,upscale:1});
      reads++;readCandidates++;
    });
    return {candidates:n,reads,readCandidates,seen,ms:Math.round((performance.now?performance.now():Date.now())-started),why:''};
  }

  /* [229-1] ---- the zones follow the finder --------------------------------------- */
  function zoneLog(what,extra){
    if(!session)return;
    if(!Array.isArray(session.zoneLog))session.zoneLog=[];
    session.zoneLog.push(Object.assign({t:Date.now(),what},extra||{}));
    if(session.zoneLog.length>40)session.zoneLog.splice(0,session.zoneLog.length-40);
  }
  function zonesNamed(){
    return !!(session&&session.fillZones&&session.fillZones.groups&&session.fillZones.groups.some(g=>field(g.zone)));
  }
  function zonesForNewcomers(added){
    /* [229-1] his walk: smokes found, zones put on, then the thermals found - and the thermals
       had no zone, whatever he pressed. Now a find that adds candidates while the zones
       already carry a name re-samples and re-applies at once: the names ride on the colour
       (sampleFillZones carries them), so the newcomers land in the groups they sit on. */
    if(!added||!zonesNamed())return null;
    try{
      const f=sampleFillZones();
      const r=applyFillZones();
      session.zoneStatus=`${r.set} symbol${r.set===1?'':'s'} zoned by colour - the ${added} just found included.`;
      zoneLog('auto-after-find',{added,sampled:f.sampled,set:r.set,cleared:r.cleared});
      render();
      return {added,sampled:f.sampled,set:r.set};
    }catch(e){zoneLog('auto-after-find-failed',{added,error:(e&&e.message)||String(e)});return null;}
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
    session.detectBusy=true;session.detectStatus='Preparing the local finder…';render();
    const started=performance.now?performance.now():Date.now();
    try{
      const f=makeFeature(signal);let wb=workBBox(f,bbox);{const tt=tightenWorkBox(f,wb);if(tt){const o=[tt.x/f.scaleX,tt.y/f.scaleY,tt.w/f.scaleX,tt.h/f.scaleY];wb={x:tt.x,y:tt.y,w:tt.w,h:tt.h,original:o,tightened:true};}}  /* [211-A] */
      const base=cropMask(f,wb);
      if(base.ink<8)throw new Error(`The taught rectangle contains too little ${signal==='red'?'red ':' '}symbol ink. Draw tightly around one complete symbol.`);
      const taught=contourStats(f,wb.x,wb.y,wb.w,wb.h),taughtHole=closedContourStats(f,wb.x,wb.y,wb.w,wb.h),taughtClosed=taught.sides>=3||taughtHole.enclosedRatio>=0.035;
      /* [226-A] the drawing's own geometry first; template matching only when it has nothing to say */
      let vecRun=null;
      {
        session.detectStatus='Reading the drawing\u2019s own geometry\u2026';spTick();
        const vs=await vectorSquares();spThrowIfCancelled();
        const side=(vs&&vs.squares&&vs.squares.length)?vectorSideFor(vs.squares,wb):null;
        if(!vs||!vs.squares)vecRun={why:vs?vs.why:'no-vector'};
        else if(!vs.squares.length)vecRun={why:vs.segments?'no-squares-in-the-drawing':'no-lines-in-the-pdf-(a-scan)',squares:0};
        else if(side===null){
          /* [230-A] no square under his box: the joined pieces inside it are the symbol, and every exact repeat on the sheet is a device */
          const shp=vecShapeFor(bbox,vs.shapes||[]);   /* the box HE drew - the raster tighten can shrink it to one stroke of a hollow symbol */
          const found=shp?vecShapeMatches(shp,vs.shapes,vecShapeIndex(vs)):[];
          /* does this symbol carry a number? The sheet says: when at least half of the repeats have a digit word beside them in the stroke font it does; his loudspeakers have one in 12 (a neighbour's label within reach) and the reader leaves every one of them alone */
          const labelSide=shp?vecLabelScale(vs,shp):0;   /* [234-B] */
          const withWord=(shp&&vs.pieces&&vs.pieces.length)?found.filter(h=>vecLabelsFor(h.cx,h.cy,labelSide,vs.pieces).words.length>0).length:0;
          const numbered=found.length>0&&withWord>=VEC_SHAPE_NUMBERED_FRAC*found.length;
          if(!shp||found.length<1)vecRun={why:shp?'shape-repeats-nowhere':'taught-box-is-not-a-square',squares:vs.squares.length,shapeTried:!!shp};
          else{
            const hits=found.map(h=>{const bw=h.w+1+2*TIGHTEN_MARGIN_PX,bh=h.h+1+2*TIGHTEN_MARGIN_PX,bx0=Math.floor(h.cx-bw/2),by0=Math.floor(h.cy-bh/2),bx1=Math.ceil(h.cx+bw/2),by1=Math.ceil(h.cy+bh/2);return {x:bx0,y:by0,w:bx1-bx0,h:by1-by0,interior:1,interiorInk:1,side:labelSide,inner:0,fill:shp.fill,shape:true,partial:h.partial,noNumber:!numbered,scale:h.scale};});   /* [234-B] side is the reader's scale: the sheet's, not the symbol's */
            const scales={};found.forEach(h=>{const k=String(h.scale);scales[k]=(scales[k]||0)+1;});   /* [231-B] */
            vecRun={why:'',side:Math.round(Math.max(shp.w,shp.h)*100)/100,squares:vs.squares.length,allSquares:vs.squares.length,shown:{inner:0,fill:shp.fill,pieces:shp.pieces.length},matched:hits.length,unmatched:0,ms:vs.ms,hits,misses:[],shape:{pieces:shp.pieces.length,w:Math.round(shp.w*100)/100,h:Math.round(shp.h*100)/100,len:Math.round(shp.len*10)/10,matched:hits.length,partial:hits.filter(h=>h.partial).length,numbered,withWord,scales,otherSize:found.filter(h=>h.scale!==1).length,labelSide:Math.round(labelSide*100)/100}};
          }
        }
        else{
          const same=vs.squares.filter(s=>Math.abs(s.side-side)<=side*VEC_SIDE_MATCH);
          const [ox,oy,ow,oh]=wb.original,cx0=ox+ow/2,cy0=oy+oh/2;
          const shown=same.filter(s=>Math.abs(s.x-cx0)<=ow/2+2&&Math.abs(s.y-cy0)<=oh/2+2).sort((a,b)=>Math.hypot(a.x-cx0,a.y-cy0)-Math.hypot(b.x-cx0,b.y-cy0))[0];
          const hits=[],misses=[];let unmatched=0;
          for(const s of same){
            /* the candidate's box is the SQUARE itself, not the box he drew: the number reader lays its strips out from the box's size and the zone sampler its ring, and a loose teach pushes both off (test_p221 N2 and Z1 caught it both ways). Same shape as the template route's tightened box - the ink extent plus TIGHTEN_MARGIN_PX each side, floored and ceiled to whole pixels the way workBBox does - so a candidate carries the same box whichever route found it */
            if(vecSameSymbol(shown,s)){const bs=s.side+1+2*TIGHTEN_MARGIN_PX,bx0=Math.floor(s.x-bs/2),by0=Math.floor(s.y-bs/2),bx1=Math.ceil(s.x+bs/2),by1=Math.ceil(s.y+bs/2);hits.push({x:bx0,y:by0,w:bx1-bx0,h:by1-by0,interior:1,interiorInk:1,side:s.side,inner:s.inner,fill:s.fill});}
            else{unmatched++;misses.push({x:Math.round(s.x*10)/10,y:Math.round(s.y*10)/10,inner:s.inner,fill:s.fill});}
          }
          vecRun={why:'',side:Math.round(side*100)/100,squares:same.length,allSquares:vs.squares.length,shown:{inner:shown.inner,fill:shown.fill},matched:hits.length,unmatched,ms:vs.ms,hits,misses};
        }
      }
      if(vecRun&&vecRun.hits){
        const runId=`vector-${Date.now().toString(36)}`;const created=[];let areaSkipped=0;
        vecRun.hits.forEach((d,i)=>{
          const cx=d.x+d.w/2,cy=d.y+d.h/2;if(spAreaExcluded(cx,cy)){areaSkipped++;return;}
          created.push(normaliseDetection({id:`${runId}-${i+1}`,obj:{kind:'sym',type,x:cx,y:cy,zone:'',loop:'',dev:'',info:''},meta:{source:'template',method:'vector',confidence:Math.round(d.interior*1000)/1000,requiresDeviceNumber:!d.noNumber,   /* [230-A] */suspectStub:false,detectorRun:runId,detectorSignal:signal,bbox:[d.x,d.y,d.w,d.h],rotation:0,mirrored:false,scale:1,closedContourScore:1,closedContourSides:4,interiorNcc:d.interior,interiorInk:d.interiorInk,vectorSide:d.side,vectorInner:d.inner,vectorFill:d.fill,vectorShape:!!d.shape,vectorPartial:!!d.partial,noNumber:!!d.noNumber,vectorScale:d.scale==null?1:Number(d.scale)}},i));   /* [230-A] [231-B] */
        });
        if(options.replaceType!==false)session.candidates=session.candidates.filter(c=>!(c.meta&&c.meta.source==='template'&&field(c.obj.type)===type));
        session.candidates.push(...created);refreshIssues();
        const elapsed=Math.round((performance.now?performance.now():Date.now())-started);
        session.detectReport={summary:{runId,type,signal,threshold,method:'vector',raw:vecRun.squares,kept:created.length,skippedByArea:areaSkipped,stubFlags:0,nmsCentreFactor:DETECT_NMS_CENTRE_FACTOR,workPixels:f.workPixels,workScale:Math.min(f.scaleX,f.scaleY),elapsedMs:elapsed,taughtClosed,taughtContourScore:taught.score,taughtHoleRatio:taughtHole.enclosedRatio,vector:{side:vecRun.side,squares:vecRun.squares,allSquares:vecRun.allSquares,shown:vecRun.shown,matched:vecRun.matched,unmatched:vecRun.unmatched,geometryMs:vecRun.ms,shape:vecRun.shape||null}},bbox:clone(wb.original),tightened:!!wb.tightened,detections:created.map(c=>({id:c.id,x:c.obj.x,y:c.obj.y,score:c.meta.confidence,stub:false,closedContourScore:1,closedContourSides:4,box:clone(c.meta.bbox)})),finishedAt:Date.now()};
        if(vecRun.shape)session.vectorShapeLast={type,pieces:vecRun.shape.pieces,matched:vecRun.matched,partial:vecRun.shape.partial,numbered:vecRun.shape.numbered,w:vecRun.shape.w,h:vecRun.shape.h,scales:vecRun.shape.scales,otherSize:vecRun.shape.otherSize};   /* [230-B] its own row; the squares' row stands */
        else session.vectorLast={type,side:vecRun.side,squares:vecRun.squares,shown:vecRun.shown,matched:vecRun.matched,unmatched:vecRun.unmatched,misses:vecRun.misses};   /* misses carry what is drawn in them, for the diagnostics */
        session.detectReport.summary.zonesRefreshed=zonesForNewcomers(created.length);   /* [229-1] */
        spRecordTeach(type,wb.original,created.length,'vector');   /* [239-B] */
        session.detectStatus='';return clone(session.detectReport);
      }
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
      const tplInnerRaw=rectSum(f,wb.x+wb.w*DETECT_INTERIOR_TRIM,wb.y+wb.h*DETECT_INTERIOR_TRIM,wb.w*(1-2*DETECT_INTERIOR_TRIM),wb.h*(1-2*DETECT_INTERIOR_TRIM)),tplInnerInk=Math.max(1,tplInnerRaw);
      /* [238-A] a hollow symbol - a sounder's cone, a bell - has nothing inside its box to compare: on his scan the interior check threw away all 102 sounders and kept 33 letters and walls. The inside is a signature only if it survives a pixel of play: the taught interior against itself one pixel over (his scan: smoke 0.42, thermal 0.36, sounder -0.06). When it does not, the whole symbol is compared instead */
      const hollow=(()=>{   /* an empty interior is hollow outright: paper correlates with itself through a scanner's noise */const mx=Math.round(wb.w*DETECT_INTERIOR_TRIM),my=Math.round(wb.h*DETECT_INTERIOR_TRIM),iw=wb.w-2*mx,ih=wb.h-2*my;if(iw<3||ih<3)return false;if(tplInnerRaw<DETECT_INTERIOR_MIN_PX)return true;const me=lumPatch(f,wb.x+mx,wb.y+my,iw,ih,iw,ih);let best=-1;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const v=nccOf(me,lumPatch(f,wb.x+mx+dx,wb.y+my+dy,iw,ih,iw,ih));if(v>best)best=v;}return best<DETECT_INTERIOR_SELF;})();
      const innerArea=Math.max(1,wb.w*(1-2*DETECT_INTERIOR_TRIM)*wb.h*(1-2*DETECT_INTERIOR_TRIM)),hollowInkMax=tplInnerRaw+DETECT_HOLLOW_INK*innerArea;
      const dedup=nmsDetections(raw,base.w,base.h).map(d=>{const inkRaw=rectSum(f,d.x+d.w*DETECT_INTERIOR_TRIM,d.y+d.h*DETECT_INTERIOR_TRIM,d.w*(1-2*DETECT_INTERIOR_TRIM),d.h*(1-2*DETECT_INTERIOR_TRIM));d.interiorInk=inkRaw/tplInnerInk;d.innerRaw=inkRaw;if(hollow){const t=tplVariants[(d.mirrored?4:0)+Math.round((((d.rotation%360)+360)%360)/90)]||tplVariants[0];d.interior=nccOf(t.p,lumPatch(f,d.x,d.y,d.w,d.h,t.w,t.h));}else d.interior=interiorNcc(f,tplVariants,d);return d;})
        .filter(d=>hollow?(d.interior>=DETECT_HOLLOW_NCC&&d.innerRaw<=hollowInkMax):(d.interiorInk>=DETECT_INTERIOR_INK_MIN&&d.interiorInk<=DETECT_INTERIOR_INK_MAX&&(d.interior>=DETECT_INTERIOR_NCC_SURE||(d.interior>=DETECT_INTERIOR_NCC_MIN&&d.interiorInk<=DETECT_INTERIOR_INK_LIKE)))).slice(0,DETECT_MAX_RESULTS);
      const runId=`template-${Date.now().toString(36)}`;const created=[],innerRaws=[],holes=[];let areaSkipped=0;   /* [216-C] */
      for(let i=0;i<dedup.length;i++){
        const d=dedup[i],cs=contourStats(f,d.x,d.y,d.w,d.h),hole=closedContourStats(f,d.x,d.y,d.w,d.h);
        const ratios=cs.coverage.map((v,j)=>v/Math.max(0.08,taught.coverage[j]||0.08));
        const comparableSides=ratios.filter(v=>v>=0.42).length;
        /* High-specificity flag only: the taught symbol has a real enclosed
           contour, while this match has effectively none. Do not penalise weak
           real symbols just because a photographed side is faint. */
        const suspect=taughtClosed&&d.score>=0.55&&comparableSides<=1&&hole.enclosedRatio<0.01;
        /* [239-A] a boxed symbol's hit must enclose: a letter, a wall corner, three parallel lines pass the dice and the interior check as a thermal (his scan: 21 of 84) and enclose nothing; every real one encloses 0.63-1.0 of what the taught does. A four-sided box with every side covered stays (a dashed concealed smoke whose gap the dilation did not close) */
        if(!hollow&&taughtHole.enclosedRatio>=DETECT_HOLE_TAUGHT&&hole.enclosedRatio<DETECT_HOLE_KEEP*taughtHole.enclosedRatio&&!(cs.sides>=4&&Math.min.apply(null,cs.coverage)>=DETECT_HOLE_SIDE))continue;
        const sx=f.iw/f.w,sy=f.ih/f.h;
        const box=[d.x*sx,d.y*sy,d.w*sx,d.h*sy],cx=box[0]+box[2]/2,cy=box[1]+box[3]/2;
        if(spAreaExcluded(cx,cy)){areaSkipped++;continue;}   /* [216-C] in a left-out area, or outside every only-here area */
        const c=normaliseDetection({id:`${runId}-${i+1}`,obj:{kind:'sym',type,x:cx,y:cy,zone:'',loop:'',dev:'',info:''},meta:{source:'template',confidence:d.score,requiresDeviceNumber:true,suspectStub:suspect,detectorRun:runId,detectorSignal:signal,bbox:box,rotation:d.rotation,mirrored:d.mirrored,scale:d.scale,closedContourScore:cs.score,closedContourSides:comparableSides,interiorNcc:d.interior,interiorInk:d.interiorInk}},i);
        created.push(c);innerRaws.push(d.innerRaw);holes.push({h:hole.enclosedRatio,s:cs.sides,c:cs.coverage});
      }
      if(options.replaceType!==false)session.candidates=session.candidates.filter(c=>!(c.meta&&c.meta.source==='template'&&field(c.obj.type)===type));
      session.candidates.push(...created);refreshIssues();
      const elapsed=Math.round((performance.now?performance.now():Date.now())-started);
      session.detectReport={summary:{runId,type,signal,threshold,method:'template',vectorWhy:(vecRun&&vecRun.why)||'',drawn:clone(bbox),raw:raw.length,kept:created.length,skippedByArea:areaSkipped,stubFlags:created.filter(c=>c.meta.suspectStub).length,nmsCentreFactor:DETECT_NMS_CENTRE_FACTOR,workPixels:f.workPixels,workScale:Math.min(f.scaleX,f.scaleY),elapsedMs:elapsed,taughtClosed,taughtContourScore:taught.score,taughtHoleRatio:taughtHole.enclosedRatio,taughtSides:taught.sides,hollow,taughtInnerInk:tplInnerRaw,hollowInkMax,taughtCoverage:taught.coverage},bbox:clone(wb.original),tightened:!!wb.tightened,detections:created.map((c,i)=>({id:c.id,x:c.obj.x,y:c.obj.y,score:c.meta.confidence,stub:!!c.meta.suspectStub,ncc:c.meta.interiorNcc,ink:c.meta.interiorInk,innerRaw:innerRaws[i],hole:holes[i].h,sides:holes[i].s,coverage:holes[i].c,closedContourScore:c.meta.closedContourScore,closedContourSides:c.meta.closedContourSides,box:clone(c.meta.bbox)})),finishedAt:Date.now()};
      session.detectReport.summary.zonesRefreshed=zonesForNewcomers(created.length);   /* [229-1] */
      spRecordTeach(type,wb.original,created.length,'template');   /* [239-B] */
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

  /* PASS 218 [218-D] - THE SHEET AT FULL DETAIL.
     The workspace image is a 1x raster of a vector PDF: 7 px digits. When the
     level kept its source PDF (index.html fsPlanSrcAttach), the reader
     re-renders the sheet at up to 4x in 512-px tiles - grey, kept for the
     session - and the two crop functions read from those tiles instead. The
     'red' variant (red-printed labels) keeps the workspace image. A photo or
     a scan has no source and takes the old path unchanged. */
  let hires=null;
  function planSource(){try{const lv=(typeof levels!=='undefined'&&levels)?levels[Number(curLevel||0)]:null;const s=lv&&lv.src;return (s&&s.kind==='pdf'&&s.b64)?s:null;}catch(_){return null;}}
  /* [222-A] WHY IT DID NOT RUN, NOT JUST THAT IT DID NOT. Five separate ways to
     return null landed in the diagnostics as one bare `null`, and his V0.200 paste
     is exactly that: the whole of Pass 221 was inert on his machine and working out
     which of the five took a code read. The point of a diagnostics payload is that
     it does not. */
  let hiresWhy = '';   /* why the sheet was NOT re-rendered; '' when it was */
  function hiresOff(why){ hiresWhy=why; return null; }
  async function hiresOpen(){
    const src=planSource(); if(!src){hires=null;return hiresOff('no-source-pdf');}
    const live=livePlanImage(); if(!live) return hiresOff('no-plan-image');
    if(hires&&hires.src===src&&hires.live===live){hiresWhy='';return hires;}
    if(typeof ensurePdfJs!=='function') return hiresOff('no-pdfjs-loader');
    await ensurePdfJs(); if(!window.pdfjsLib) return hiresOff('pdfjs-did-not-load');
    const bin=atob(src.b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
    const pdf=await window.pdfjsLib.getDocument({data:u}).promise,page=await pdf.getPage(src.page||1);
    const w=live.naturalWidth||live.width,h=live.naturalHeight||live.height;
    let k=HIRES_K; while(k>1.5&&w*h*k*k>HIRES_MAX_PX)k-=0.5;
    hires={src,live,page,k,w,h,T:HIRES_TILE,cols:Math.ceil(w/HIRES_TILE),rows:Math.ceil(h/HIRES_TILE),tiles:new Map(),rendered:0,ms:0};
    hiresWhy='';   /* [222-A] */
    return hires;
  }
  async function hiresTile(tx,ty){
    const H=hires,key=ty*H.cols+tx; if(H.tiles.has(key)) return H.tiles.get(key);
    const T=H.T,k=H.k,x0=tx*T,y0=ty*T,tw=Math.min(T,H.w-x0),th=Math.min(T,H.h-y0),cw=Math.round(tw*k),ch=Math.round(th*k);
    const vp=H.page.getViewport({scale:(H.src.scale||1)*k,offsetX:-(H.src.dx+x0)*k,offsetY:-(H.src.dy+y0)*k});
    const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;const ctx=cv.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,ch);
    const t0=Date.now(); await H.page.render({canvasContext:ctx,viewport:vp}).promise; H.ms+=Date.now()-t0;
    const d=ctx.getImageData(0,0,cw,ch).data,g=new Uint8ClampedArray(cw*ch);
    for(let i=0,j=0;i<d.length;i+=4,j++)g[j]=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])|0;
    cv.width=cv.height=1;
    hiresInkGrow(g,cw,ch,HIRES_INK_GROW);
    const tile={g,w:cw,h:ch,x0,y0}; H.tiles.set(key,tile); H.rendered++; return tile;
  }
  /* a vector hairline is ONE anti-aliased pixel at any scale: 30 px digits with 1 px strokes, which
     the reader breaks into fragments. Grow the ink by a 3x3 minimum, n times (separable), so the
     strokes are the width a printed sheet would have. */
  function hiresInkGrow(g,w,h,n){
    if(!n)return;const t=new Uint8ClampedArray(g.length);
    for(let it=0;it<n;it++){
      for(let y=0;y<h;y++){const o=y*w;for(let x=0;x<w;x++){let m=g[o+x];if(x>0&&g[o+x-1]<m)m=g[o+x-1];if(x<w-1&&g[o+x+1]<m)m=g[o+x+1];t[o+x]=m;}}
      for(let y=0;y<h;y++){const o=y*w;for(let x=0;x<w;x++){let m=t[o+x];if(y>0&&t[o-w+x]<m)m=t[o-w+x];if(y<h-1&&t[o+w+x]<m)m=t[o+w+x];g[o+x]=m;}}
    }
  }
  async function hiresPrepare(cands,radiusX,radiusY,onTick){
    const H=await hiresOpen(); if(!H) return null;   /* [222-A] hiresOpen set the reason */
    const T=H.T,need=[];const seen=new Set();
    for(const c of cands){const cx=c.obj.x,cy=c.obj.y;
      const tx0=clamp(Math.floor((cx-radiusX)/T),0,H.cols-1),tx1=clamp(Math.floor((cx+radiusX)/T),0,H.cols-1),ty0=clamp(Math.floor((cy-radiusY)/T),0,H.rows-1),ty1=clamp(Math.floor((cy+radiusY)/T),0,H.rows-1);
      for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){const key=ty*H.cols+tx;if(!seen.has(key)){seen.add(key);need.push(key);}}}
    let i=0;for(const key of need){spThrowIfCancelled();if(!H.tiles.has(key)){if(onTick)onTick(i,need.length);await hiresTile(key%H.cols,Math.floor(key/H.cols));}i++;}
    return H;
  }
  function hiresReady(x0,y0,sw,sh){
    const H=hires; if(!H||!H.tiles.size) return false; const T=H.T;
    for(let ty=Math.floor(y0/T);ty<=Math.floor((y0+sh-1)/T);ty++)for(let tx=Math.floor(x0/T);tx<=Math.floor((x0+sw-1)/T);tx++){if(!H.tiles.has(ty*H.cols+tx))return false;}
    return true;
  }
  /* the grey of plan region [x0,x0+sw) x [y0,y0+sh) at k: Float32Array, (sw*k) x (sh*k) */
  function hiresGrey(x0,y0,sw,sh){
    const H=hires,k=H.k,T=H.T,W=Math.round(sw*k),Hh=Math.round(sh*k),out=new Float32Array(W*Hh).fill(255),gx0=Math.round(x0*k),gy0=Math.round(y0*k);
    for(let ty=Math.floor(y0/T);ty<=Math.floor((y0+sh-1)/T);ty++)for(let tx=Math.floor(x0/T);tx<=Math.floor((x0+sw-1)/T);tx++){
      const t=H.tiles.get(ty*H.cols+tx);if(!t)continue;const tgx=Math.round(t.x0*k),tgy=Math.round(t.y0*k);
      const ax=Math.max(gx0,tgx),ay=Math.max(gy0,tgy),bx=Math.min(gx0+W,tgx+t.w),by=Math.min(gy0+Hh,tgy+t.h);
      for(let y=ay;y<by;y++){const so=(y-tgy)*t.w,oo=(y-gy0)*W;for(let x=ax;x<bx;x++)out[oo+(x-gx0)]=t.g[so+(x-tgx)];}}
    return {g:out,w:W,h:Hh};
  }
  function hiresCanvas(x0,y0,sw,sh){
    const r=hiresGrey(x0,y0,sw,sh),cv=document.createElement('canvas');cv.width=r.w;cv.height=r.h;
    const ctx=cv.getContext('2d'),im=ctx.createImageData(r.w,r.h),o=im.data;
    for(let i=0,j=0;i<r.g.length;i++,j+=4){o[j]=o[j+1]=o[j+2]=r.g[i];o[j+3]=255;}
    ctx.putImageData(im,0,0);return cv;
  }
  /* This sheet's CAD font draws a 7 with a short hooked top; at 4x the reader calls it a 1. Width alone cannot tell
     them apart across fonts, the SHAPE can: a 7 is inked right across its top rows and narrow at its bottom rows
     (the stem's foot); a 1 is either a plain bar (top AND bottom as wide as the glyph) or a stem with a flag
     (top rows narrower than the glyph) or a stem with a foot (bottom rows as wide as the glyph). Measured on the
     Merriwa CAD font (7: top 1.0, bottom 0.32) and on the fixture's sans (1: top 0.62, bottom 1.0).
     Only on the sharp render, only 1 -> 7. */
  /* [221-A] THE 7 CHECK, WITHOUT A BLOB-PER-CHARACTER MATCH.

     V0.197 found the connected ink blobs in the crop and gave up unless they
     came to exactly one per character. 219-A kept that requirement and only
     tried harder to satisfy it - two filters instead of one - and 77 STILL read
     11 on his sheet. A real strip holds the symbol's box edge, the loop wire,
     part of a wall and sometimes the neighbour's digit; no filter makes that
     come out at one blob per character. The requirement is the fault.

     So: no correspondence. Find the row band the text sits in from the row
     profile, take that band's ink extent, split it into N equal columns, and
     ask of each column the same shape question as before. A 7 in this CAD font
     is inked right across its top and narrow at the bottom; a 1 is the same
     width top and bottom, and a 1 with a foot is WIDER at the bottom. If the
     split is off, or a wire sits in the column, the test simply fails and the
     digit is kept - identical to doing nothing. This can improve a read and it
     can never give up. */
  function hiresFixSevens(cv,t,diag){
    if(!/1/.test(t))return t;   /* (and the trailing-I rule below, which needs a 1 at the end) */
    const w=cv.width,h=cv.height,d=cv.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
    const ink=new Uint8Array(w*h);
    let any=0;
    for(let i=0,j=0;i<d.length;i+=4,j++){ink[j]=d[i]<128?1:0;any+=ink[j];}
    if(!any)return t;
    /* THE ONE THING BLOBS ARE STILL FOR: throwing the interlopers away. Nothing here
       counts them or matches them to characters. A blob goes if it TOUCHES THE CROP'S
       BORDER - the loop wire and the wall run in from outside - or if it STANDS WELL
       OUTSIDE THE TEXT BAND, which is what the symbol's box edge does: it is a tall
       thin line through a crop whose digits occupy a short band in the middle. (A digit
       the strip clipped touches the edge too, and it was unreadable anyway; 221-B
       widened the strip so that is rare.) */
    const blobs=[];
    {
      const seen=new Uint8Array(w*h),stack=[];
      for(let p0=0;p0<ink.length;p0++){
        if(!ink[p0]||seen[p0])continue;
        const px=[];let edge=0,by0=h,by1=-1;stack.push(p0);seen[p0]=1;
        while(stack.length){const q=stack.pop();const x=q%w,y=(q-x)/w;px.push(q);
          if(x===0||y===0||x===w-1||y===h-1)edge=1;
          if(y<by0)by0=y; if(y>by1)by1=y;
          if(x>0&&ink[q-1]&&!seen[q-1]){seen[q-1]=1;stack.push(q-1);}
          if(x<w-1&&ink[q+1]&&!seen[q+1]){seen[q+1]=1;stack.push(q+1);}
          if(y>0&&ink[q-w]&&!seen[q-w]){seen[q-w]=1;stack.push(q-w);}
          if(y<h-1&&ink[q+w]&&!seen[q+w]){seen[q+w]=1;stack.push(q+w);}}
        blobs.push({px:px,edge:edge,by0:by0,by1:by1,gone:0});
      }
    }
    const erase=(b)=>{if(b.gone)return;b.gone=1;for(const q of b.px){ink[q]=0;any--;}};
    for(const b of blobs)if(b.edge)erase(b);
    if(any<=0)return t;
    /* the row the text is densest on, then out to where the rows thin out */
    const band=()=>{
      const rows=new Int32Array(h);
      for(let y=0;y<h;y++){let n=0;const off=y*w;for(let x=0;x<w;x++)n+=ink[off+x];rows[y]=n;}
      let peak=0;for(let y=1;y<h;y++)if(rows[y]>rows[peak])peak=y;
      if(!rows[peak])return null;
      const rowFloor=Math.max(1,rows[peak]*FIX7_ROW_FLOOR);
      let a=peak,b=peak;
      while(a>0&&rows[a-1]>=rowFloor)a--;
      while(b<h-1&&rows[b+1]>=rowFloor)b++;
      return [a,b];
    };
    let bd=band();
    if(!bd)return t;
    {
      const m=Math.max(2,Math.round((bd[1]-bd[0]+1)*FIX7_BAND_MARGIN));
      for(const b of blobs)if(!b.gone&&(b.by0<bd[0]-m||b.by1>bd[1]+m))erase(b);
    }
    if(any<=0)return t;
    bd=band();
    if(!bd)return t;
    const y0=bd[0],y1=bd[1],bandH=y1-y0+1;
    if(bandH<FIX7_MIN_BAND)return t;
    /* THE TEXT'S OWN RUN OF COLUMNS, not simply the widest thing left standing. Inked
       columns are grouped where the gap between them is small against the band's height;
       a neighbour's digit sitting at the far side of the strip lands in its own group
       and is not part of the extent. The widest group is the number. */
    let gs=-1,ge=-1,prev=-2,bw=-1,x0=-1,x1=-1;
    const gapMax=Math.max(2,Math.round(bandH*FIX7_GAP));
    const close=()=>{if(gs>=0&&ge-gs+1>bw){bw=ge-gs+1;x0=gs;x1=ge;}};
    for(let x=0;x<w;x++){
      let hit=0;for(let y=y0;y<=y1;y++)if(ink[y*w+x]){hit=1;break;}
      if(!hit)continue;
      if(gs<0){gs=ge=x;}
      else if(x-prev-1>gapMax){close();gs=ge=x;}
      else ge=x;
      prev=x;
    }
    close();
    if(x0<0)return t;
    const bandW=x1-x0+1;
    if(bandW<t.length*FIX7_MIN_COL)return t;
    const colW=bandW/t.length;
    const spanIn=(cx0,cx1,ry0,ry1)=>{let a=-1,b=-1;
      for(let x=cx0;x<=cx1;x++){let hit=0;for(let y=ry0;y<=ry1;y++)if(ink[y*w+x]){hit=1;break;}
        if(hit){if(a<0)a=x;b=x;}}
      return b>=a&&a>=0?(b-a+1)/Math.max(1,cx1-cx0+1):0;};
    const topN=Math.max(1,Math.round(bandH*0.22)),botN=Math.max(1,Math.round(bandH*0.3));
    let out='';
    for(let i=0;i<t.length;i++){
      if(t[i]!=='1'){out+=t[i];continue;}
      const cx0=Math.round(x0+i*colW),cx1=Math.max(cx0,Math.round(x0+(i+1)*colW)-1);
      const top=spanIn(cx0,cx1,y0,y0+topN-1),bot=spanIn(cx0,cx1,y1-botN+1,y1);
      /* bot>0 IS NOT A TUNING KNOB. A 7 in this font has a stem that reaches the
         baseline, so a column with NO ink at all across its bottom is not a 7 - it is
         a piece of a wall, or the split landing beside the digits. Measured on the
         3-digit fixture's WIDE look: "117" came back "717" with top=1.00 bot=0.00 on
         the leading column, which is a horizontal stroke with nothing under it. */
      const seven=(top>=FIX7_TOP_SPAN&&bot<=FIX7_BOT_SPAN&&bot>=FIX7_BOT_MIN);
      out+=seven?'7':'1';
      if(diag)diag.push({i,top:Math.round(top*100)/100,bot:Math.round(bot*100)/100,seven});
    }
    /* "74 I": a trailing isolator mark the digit whitelist turned into a 1. An I with
       serifs is inked right across its top AND its bottom with a thin waist between. */
    if(out.length===3&&out[2]==='1'){
      const cx0=Math.round(x0+2*colW),cx1=x1;
      const midY0=y0+topN,midY1=y1-botN;
      const top=spanIn(cx0,cx1,y0,y0+topN-1),bot=spanIn(cx0,cx1,y1-botN+1,y1),
            mid=midY1>=midY0?spanIn(cx0,cx1,midY0,midY1):1;
      if(top>=0.85&&bot>=0.85&&mid<=0.55){out=out.slice(0,2);if(diag)diag.push({i:2,droppedI:true});}
    }
    return out;
  }

  function cropCanvas(cx,cy,radiusX,radiusY,upscale,variant) {
    const live=livePlanImage(); if(!live) throw new Error('No decoded Workspace plan is available.');
    const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height;
    const x0=Math.max(0,Math.floor(cx-radiusX)), y0=Math.max(0,Math.floor(cy-radiusY));
    const x1=Math.min(iw,Math.ceil(cx+radiusX)), y1=Math.min(ih,Math.ceil(cy+radiusY));
    const sw=Math.max(1,x1-x0), sh=Math.max(1,y1-y0);
    let scale=Math.max(1,Number(upscale)||2);
    const hi=variant!=='red'&&hiresReady(x0,y0,sw,sh);if(hi)scale=Math.max(scale,Math.min(hires.k,HIRES_OCR_UPSCALE));   /* [218-D] sharp source: read it larger */
    const cap=Math.min(maxCanvasPx(),OCR_CROP_MAX_PX);
    if(sw*sh*scale*scale>cap) scale=Math.max(1,Math.sqrt(cap/(sw*sh)));
    const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(sw*scale)); cv.height=Math.max(1,Math.round(sh*scale));
    const ctx=cv.getContext('2d',{willReadFrequently:variant==='red'});
    ctx.imageSmoothingEnabled=true; try{ctx.imageSmoothingQuality='high'}catch(_){}
    if(hi){const hc=hiresCanvas(x0,y0,sw,sh);ctx.drawImage(hc,0,0,hc.width,hc.height,0,0,cv.width,cv.height);}else ctx.drawImage(live,x0,y0,sw,sh,0,0,cv.width,cv.height);   /* [218-D] */
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
      if(c.meta&&(c.meta.noNumber||c.meta.devCleared))return;   /* [230-A] a symbol that carries no number never takes a label; [232-B] nor does a row whose number he took off */
      if(lab.only&&lab.only!==c.id)return;   /* [236-A] a learned label belongs to the symbol it was read beside */
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
      /* [240-A] between candidates of ONE type only: a hollow sounder's whole-patch NCC (0.97) and a thermal's
         dice (0.7) are not on one scale, and an unnumbered sounder took 86 and 62 off the thermals beside it */
      const rival=pairs.find(q=>q[2]===li&&q[3]!==ci&&!uc.has(q[3])&&q[0]<=centre+2*symW&&candidates[q[3]].obj.type===candidates[ci].obj.type&&conf(q[3])>=conf(ci)+0.15);
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
    const out=[];for(let i=0;i<candidates.length;i++)if(!pool.settledCandidates.has(i)&&!(candidates[i].meta&&(candidates[i].meta.noNumber||candidates[i].meta.devCleared)))out.push(i);return out;   /* [230-A] [232-B] */
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
  function cropStripCanvas(x0,y0,w,h,upscale,source){
    const live=livePlanImage(); if(!live) throw new Error('No decoded Workspace plan is available.');
    const iw=live.naturalWidth||live.width, ih=live.naturalHeight||live.height;
    const sx=clamp(Math.floor(x0),0,iw-1),sy=clamp(Math.floor(y0),0,ih-1),sw=Math.max(1,Math.min(iw-sx,Math.ceil(w))),sh=Math.max(1,Math.min(ih-sy,Math.ceil(h)));
    const pad=20,cw=Math.round(sw*upscale),ch=Math.round(sh*upscale);
    let big;
    if(source!=='live'&&hiresReady(sx,sy,sw,sh)){const r=hiresGrey(sx,sy,sw,sh);big=lanczosGrey(r.g,r.w,r.h,cw,ch);}   /* [218-D] the strip from the 4x render, not a 1x raster stretched 5-7x */
    else{
    const src=document.createElement('canvas');src.width=sw;src.height=sh;
    const sctx=src.getContext('2d',{willReadFrequently:true});sctx.drawImage(live,sx,sy,sw,sh,0,0,sw,sh);
    const d=sctx.getImageData(0,0,sw,sh).data,grey=new Float32Array(sw*sh);
    for(let i=0,j=0;i<d.length;i+=4,j++)grey[j]=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    big=lanczosGrey(grey,sw,sh,cw,ch);}
    let lo=255,hi=0;
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
    let crops=0,reads=0,readCandidates=0,clippedTotal=0,unconfirmedTotal=0,overSymbol=0;   /* [219-B] [221-B] [240-B] */
    const readDiag=[];   /* [221-D] */
    try{
      for(let n=0;n<indexes.length;n++){
        const i=indexes[n],c=candidates[i];spThrowIfCancelled();
        session.ocrStatus=`Reading numbers — ${n+1} / ${indexes.length}`;session.progress={done:n,total:indexes.length,phase:0,phases:1};spTick();
        const b=(c.meta&&Array.isArray(c.meta.bbox)&&c.meta.bbox.length===4)?c.meta.bbox:[Number(c.obj.x)-9,Number(c.obj.y)-9,18,18];
        const cx=b[0]+b[2]/2,cy=b[1]+b[3]/2,w=Math.max(6,b[2]),h=Math.max(6,b[3]);
        const seen=[];let clipped=0,unconfirmed=0;   /* [219-B] [221-B] */
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
          /* [218-D] the sharp render first (its own, smaller upscales - the digits are already 4x); the workspace image only if that read nothing */
          const hiresHere=hiresReady(Math.max(0,Math.floor(rx-rw)),Math.max(0,Math.floor(ry-rh)),Math.ceil(rw*3),Math.ceil(rh*3));
          const looksHi=HIRES_STRIP_UPSCALES.map(up=>[rx,ry,rw,rh,up]).concat(looks.slice(OCR_STRIP_UPSCALES.length));
          for(const source of (hiresHere?['hires','live']:['live'])){
          text=null;conf=0;
          for(const [lx,ly,lw,lh,up,kind] of (source==='hires'?looksHi:looks)){
            const cv=cropStripCanvas(lx,ly,lw,lh,up,source);crops++;
            const result=await worker.recognize(cv,{},{text:true});
            let t=String(result&&result.data&&result.data.text||'').replace(/\s+/g,'');
            let fixDiag=null;
            if(source==='hires'&&/^\d{1,3}$/.test(t)){fixDiag=[];const before=t;t=hiresFixSevens(cv,t,fixDiag);
              if(readDiag.length<OCR_DIAG_MAX)readDiag.push({id:c.id,dir:st.name,up,src:source,raw:before,fixed:t,cols:fixDiag});}   /* [218-D] [221-D] */
            const cf=Number(result&&result.data&&result.data.confidence)||0;
            if(kind==='near'){
              if(text!==null&&text[0]==='1'&&text.length===3&&t!==text)text=null;  /* 139 -> 39: the 1 was the wire */
              break;
            }
            if(!/^\d{1,3}$/.test(t)){text=null;break;}
            if(text===null){text=t;conf=cf;}else if(t!==text){text=null;break;}else conf=Math.min(conf,cf);
          }
          if(text!==null)break;}
          if(text===null)continue;
          /* [219-B] IS THE NUMBER WIDER THAN THE STRIP? The strips are 1.0-1.3 x the
             symbol box. "113" does not fit; V0.197 read "11" and ACCEPTED it, because
             the wire guard above only ever examined 3-character reads. Re-take a 2-digit
             read on a strip widened AWAY from the symbol (the label runs outward, the
             wire comes in from the symbol side). Two scales must agree here too. If the
             wide look finds a different number, the narrow one was clipped: drop it and
             let the row say so. He would rather type a number than correct a wrong one. */
          if(text.length===2){
            const g=OCR_STRIP_WIDEN,horiz=(st.name==='left'||st.name==='right');
            const wx=st.name==='left'?rx-rw*g:(horiz?rx:rx-rw*g/2),
                  wy=st.name==='up'?ry-rh*g:(horiz?ry-rh*g/2:ry),
                  ww=horiz?rw*(1+g):rw*(1+g),
                  wh=horiz?rh*(1+g):rh*(1+g);
            let wide=null;
            for(const up of (hiresHere?HIRES_STRIP_UPSCALES:OCR_STRIP_UPSCALES)){
              const wcv=cropStripCanvas(wx,wy,ww,wh,up,hiresHere?'hires':'live');crops++;
              const wres=await worker.recognize(wcv,{},{text:true});
              let wt=String(wres&&wres.data&&wres.data.text||'').replace(/\s+/g,'');
              let wDiag=null;
              if(hiresHere&&/^\d{1,3}$/.test(wt)){wDiag=[];const wb=wt;wt=hiresFixSevens(wcv,wt,wDiag);
                if(readDiag.length<OCR_DIAG_MAX)readDiag.push({id:c.id,dir:st.name,up,src:'wide',raw:wb,fixed:wt,cols:wDiag});}   /* [221-D] */
              if(!/^\d{2,3}$/.test(wt)){wide=null;break;}
              if(wide===null)wide=wt;else if(wt!==wide){wide=null;break;}
            }
            if(wide!==null&&wide!==text){
              /* the wide look read a DIFFERENT number and the narrow one is a tail or a
                 head of it: the narrow strip clipped a digit. Take the wide read. */
              if(/^\d{3}$/.test(wide)&&(wide.slice(1)===text||wide.slice(0,2)===text)){text=wide;}
              else {clipped++;text=null;continue;}
            } else if(wide===null){
              /* [221-B] the wide look could not be read at all. V0.199 kept the narrow
                 read here without a word, which is how 113 shipped as 11. Keep it - most
                 2-digit reads on this sheet are simply 2-digit numbers - but SAY SO. */
              unconfirmed++;
            }
          }
          if(text[0]==='0')continue;  /* a leading 0 is a clipped longer number */
          /* a lone "1" is a wall line or a wire far more often than device 1 */
          if(text.length<2&&(conf<OCR_STRIP_SINGLE_MIN_CONF||text==='1'))continue;
          /* [240-B] a number is printed beside a symbol, never over one: a window that holds another
             candidate's centre read that symbol (a thermal's dot and stem and the 77 beyond it read "14") */
          if(candidates.some(o=>o!==c&&bboxDistance([rx,ry,rw,rh],Number(o.obj.x),Number(o.obj.y))===0)){overSymbol++;continue;}
          const dev=String(parseInt(text,10));
          seen.push({dir:st.name,dev,confidence:conf});
          rawLabels.push({loop:'',dev,raw:text,text,confidence:conf,bbox:[rx,ry,rw,rh],votes:1,variant:'strip',psm:'7',phase:'strip',observedNear:c.id,offsetX:0,offsetY:0,upscale:OCR_STRIP_UPSCALE});
          reads++;
        }
        c.meta.stripReads=seen;
        clippedTotal+=clipped;unconfirmedTotal+=unconfirmed;   /* [219-B] [221-B] */
        if(unconfirmed&&seen.length&&seen.every(k=>String(k.dev).length===2))
          c.meta.ocrNote='The number read as two digits and a wider look could not confirm it. If it is a three-digit number, type it in.';
        if(clipped&&!seen.length)c.meta.ocrIssue="The printed number is wider than the reader's window - it is probably three digits. Type it in.";
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
    return {candidates:indexes.length,crops,reads,readCandidates,clipped:clippedTotal,unconfirmed:unconfirmedTotal,overSymbol,diag:readDiag,upscale:OCR_STRIP_UPSCALE};   /* [240-B] */
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

  /* ============================================================================
     [236-A] THE SHEET TEACHES ITS OWN DIGITS - the learned reader, for the numbers the
     strips could not read on a scan.

     On his scanned Merriwa sheet the digits are 6 px tall. Tesseract, at 6x, read 77 of
     191 with none wrong and could not read the rest - the glyphs are too small for it.
     But the 77 it did read are 133 labelled glyphs in the sheet's OWN font, at the
     sheet's OWN size and blur. Every other number on the sheet is written in that font.
     So: every confirmed read (vector or strip) hands over its glyphs - the dark
     components under the word, as grey patches - and each still-unread symbol's
     nearest word is read glyph by glyph by nearest neighbour against that library.
     Measured on his scan before a line of this was written (rig/knn236.py): 156 right,
     3 wrong (a wire through a 7 - the word is cut), 32 unread, of 191.

     Rules, each measured:
       - ink is darker than a threshold between the sheet's ink (its darkest 0.1 %) and
         its paper (its median): the sheet teaches that too - the fraction (LRN_INK_FRACS)
         at which the confirmed reads yield the MOST library glyphs wins. Measured: the
         library peaks at the same threshold where reading is best (100 of 255 on his scan
         as the app renders it, and on the raw JPEG with its other tone curve), and loses
         thin strokes below it and merges glyphs into grey room codes above it;
       - a glyph is an ink component 0.65-1.35 glyph heights
         tall (the glyph height is 0.45 x the sheet's square side), not inside the
         symbol's own square, not cut by the window edge (a wire);
       - glyphs on one baseline (bottoms within 0.3 h) with gaps under 0.7 h make a word;
         a word has at most LRN_WORD_MAX glyphs and its centre lies within
         VEC_LABEL_REACH x side of the symbol, nearest first;
       - a word with LOOSE INK beside it on its baseline is NOT read: a fragment-sized
         component within 0.8 h of either end that is not one of its glyphs (a broken
         glyph), or ink filling more than LRN_GAP_INK of the 0.8 h zone beside either end
         (a glyph merged into a wire - the 7 with a wire through it, three times on his
         sheet); either would make a truncated number. Measured: the zone rule costs 4
         right reads and removes every truncation;
       - a glyph reads when its LRN_K nearest library patches agree on one digit - LRN_AGREE
         of them, or every example the library holds of that digit when it holds fewer
         (never fewer than 2) - with the best correlation at least LRN_NCC; a glyph that
         does not read makes the WHOLE word unread - never a shortened number;
       - the library is every read the sheet has confirmed: the strips', the drawing's, and
         the numbers HE typed or the schedule matched - on a scan the strips cannot read at
         all, he types a handful and the rest read themselves;
       - the library must hold LRN_MIN_LIB glyphs, or nothing is read;
       - a word read for one symbol is claimed - the next symbol reads its next word - and a
         learned label may only ever be assigned to the symbol it was read beside (`only`):
         a label read 20 px from A is never handed to B because B happened to be nearer.
     ============================================================================ */
  const LRN_INK_FRACS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65], LRN_PW = 8, LRN_PH = 14, LRN_K = 5, LRN_AGREE = 4, LRN_NCC = 0.85, LRN_MIN_LIB = 30, LRN_WORD_MAX = 3, LRN_LOOSE = 0, LRN_GAP_INK = 0.25;
  const LRN_THIN = 0.85, LRN_THIN_MARGIN = 0.05, LRN_VERIFY_MARGIN = 0.1;   /* [240-D] a thin class reads on its two nearest; [240-C] the library doubts a strip read by this margin */

  function lrnGrey(live){
    const iw=live.naturalWidth||live.width,ih=live.naturalHeight||live.height,cv=document.createElement('canvas');cv.width=iw;cv.height=ih;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(live,0,0,iw,ih);
    const d=ctx.getImageData(0,0,iw,ih).data,g=new Uint8Array(iw*ih);
    const hist=new Uint32Array(256);
    for(let i=0,j=0;i<g.length;i++,j+=4){g[i]=(d[j]*299+d[j+1]*587+d[j+2]*114)/1000;hist[g[i]]++;}
    let acc=0,ink=0,paper=128;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=g.length*0.001){ink=v;break;}}   /* the darkest 0.1 %: the ink, on a sparse sheet as on a full one */
    acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=g.length*0.5){paper=v;break;}}
    return {g,w:iw,h:ih,dark:Math.round(ink+0.4*(paper-ink)),ink,paper};
  }
  function lrnSide(candidates){
    const s=candidates.map(c=>c.meta&&(c.meta.vectorSide>0?c.meta.vectorSide:(Array.isArray(c.meta.bbox)?Math.max(c.meta.bbox[2],c.meta.bbox[3]):0))).filter(x=>x>0).sort((a,b)=>a-b);
    return s.length?s[Math.floor(s.length/2)]:0;
  }
  /* 8-connected dark components inside a window [x0,y0,x1,y1) of the grey plan */
  function lrnComponents(G,x0,y0,x1,y1){
    const w=x1-x0,h=y1-y0,lab=new Int32Array(w*h),out=[];let n=0;const st=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(lab[i]||G.g[(y0+y)*G.w+x0+x]>=G.dark)continue;
      n++;lab[i]=n;st.length=0;st.push(i);let bx0=x,by0=y,bx1=x,by1=y,cnt=0;
      while(st.length){const k=st.pop();cnt++;const ky=(k/w)|0,kx=k-ky*w;if(kx<bx0)bx0=kx;if(kx>bx1)bx1=kx;if(ky<by0)by0=ky;if(ky>by1)by1=ky;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=kx+dx,ny=ky+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(lab[j]||G.g[(y0+ny)*G.w+x0+nx]>=G.dark)continue;lab[j]=n;st.push(j);}}
      out.push({x0:x0+bx0,y0:y0+by0,x1:x0+bx1+1,y1:y0+by1+1,n:cnt,edge:bx0===0||by0===0||bx1===w-1||by1===h-1});
    }
    return out;
  }
  /* the words beside one symbol at (cx,cy): glyph components grouped on a baseline, nearest first, with the loose-ink count */
  function lrnWordsFor(G,cx,cy,side){
    const gh=0.45*side,reach=Math.round(side*VEC_LABEL_REACH+side*0.6);
    const x0=Math.max(0,Math.round(cx-reach)),y0=Math.max(0,Math.round(cy-reach)),x1=Math.min(G.w,Math.round(cx+reach)),y1=Math.min(G.h,Math.round(cy+reach));
    if(x1-x0<4||y1-y0<4)return [];
    const all=lrnComponents(G,x0,y0,x1,y1).filter(c=>!(Math.abs((c.x0+c.x1)/2-cx)<side*0.55&&Math.abs((c.y0+c.y1)/2-cy)<side*0.55));
    const frag=all.filter(c=>c.y1-c.y0<=1.35*gh&&c.x1-c.x0<=1.35*gh);
    const glyphs=all.filter(c=>{const hh=c.y1-c.y0,ww=c.x1-c.x0;return hh>=0.65*gh&&hh<=1.35*gh&&ww<=0.98*gh&&ww>=1&&!c.edge;}).sort((a,b)=>a.x0-b.x0);
    const words=[];
    for(const g of glyphs){const h=g.y1-g.y0;let w=null;
      for(const x of words){if(Math.abs(x.bot-g.y1)<=h*0.3&&g.x0-x.x1<=h*0.7){w=x;break;}}
      if(w){w.g.push(g);w.x1=Math.max(w.x1,g.x1);w.top=Math.min(w.top,g.y0);}else words.push({g:[g],bot:g.y1,top:g.y0,x0:g.x0,x1:g.x1});}
    for(const w of words){
      w.d=Math.max(Math.abs((w.x0+w.x1)/2-cx),Math.abs((w.top+w.bot)/2-cy));
      const h=w.bot-w.top,gap=Math.round(0.8*h);w.loose=0;
      for(const f of frag){if(w.g.some(g=>g.x0===f.x0&&g.y0===f.y0&&g.x1===f.x1&&g.y1===f.y1))continue;if(f.y1<=w.top||f.y0>=w.bot)continue;
        if((f.x1>=w.x0-gap&&f.x1<=w.x0)||(f.x0>=w.x1&&f.x0<=w.x1+gap))w.loose++;}
      const zone=(xa,xb)=>{xa=Math.max(0,xa);xb=Math.min(G.w,xb);if(xb<=xa)return 0;let ink=0,n=0;for(let yy=Math.max(0,w.top);yy<Math.min(G.h,w.bot);yy++)for(let xx=xa;xx<xb;xx++){n++;if(G.g[yy*G.w+xx]<G.dark)ink++;}return n?ink/n:0;};
      w.inkL=zone(w.x0-gap,w.x0);w.inkR=zone(w.x1,w.x1+gap);if(Math.max(w.inkL,w.inkR)>LRN_GAP_INK)w.loose++;
    }
    return words.filter(w=>w.g.length<=LRN_WORD_MAX&&w.d<=side*VEC_LABEL_REACH).sort((a,b)=>a.d-b.d);
  }
  /* a glyph's grey patch: its box with a 1 px margin, resampled to LRN_PW x LRN_PH, zero mean unit variance */
  function lrnPatch(G,g){
    const x0=g.x0-1,y0=g.y0-1,bw=g.x1-g.x0+2,bh=g.y1-g.y0+2,p=new Float32Array(LRN_PW*LRN_PH);let s=0,ss=0;
    for(let py=0;py<LRN_PH;py++)for(let px=0;px<LRN_PW;px++){
      const fx=x0+(px+0.5)*bw/LRN_PW-0.5,fy=y0+(py+0.5)*bh/LRN_PH-0.5;const ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy;
      const v=(xx,yy)=>{xx=Math.min(G.w-1,Math.max(0,xx));yy=Math.min(G.h-1,Math.max(0,yy));return G.g[yy*G.w+xx];};
      const val=v(ix,iy)*(1-ax)*(1-ay)+v(ix+1,iy)*ax*(1-ay)+v(ix,iy+1)*(1-ax)*ay+v(ix+1,iy+1)*ax*ay;p[py*LRN_PW+px]=val;s+=val;ss+=val*val;}
    const n=p.length,m=s/n,sd=Math.sqrt(Math.max(1e-6,ss/n-m*m));for(let i=0;i<n;i++)p[i]=(p[i]-m)/sd;return p;
  }
  function lrnNcc(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s/a.length;}
  function lrnKnn(lib,p){
    const sc=lib.map(e=>({s:lrnNcc(p,e.p),d:e.d})).sort((a,b)=>b.s-a.s).slice(0,LRN_K);
    const votes={};for(const x of sc)votes[x.d]=(votes[x.d]||0)+1;let best='',n=0;for(const d in votes)if(votes[d]>n){n=votes[d];best=d;}
    const top=sc.length?sc[0].d:'';let other=0;for(const x of sc)if(x.d!==top&&x.s>other)other=x.s;   /* [240-D] */
    return {d:best,s:sc.length?sc[0].s:0,n,top,second:sc.length>1?sc[1].s:0,secondD:sc.length>1?sc[1].d:'',other};
  }
  /* the pass: the library from every assigned read, then the still-unread symbols */
  function learnedReadLabels(candidates,pool,unread,rawLabels){
    const t0=Date.now(),live=livePlanImage();
    if(!live)return {library:0,candidates:0,reads:0,ms:0,why:'no-plan-image'};
    const side=lrnSide(candidates);if(!(side>0))return {library:0,candidates:0,reads:0,ms:0,why:'no-square-side'};
    const G=lrnGrey(live),reads0=pool.assigned.assignments.filter(a=>!a.withheld&&/^\d{1,3}$/.test(String(a.label.dev||''))).map(a=>({candidate:a.candidate,dev:String(a.label.dev)}));
    const seen=new Set(reads0.map(r=>r.candidate.id));
    candidates.forEach(c=>{if(seen.has(c.id))return;const src=c.meta&&c.meta.devSource;if((src==='user'||src==='schedule')&&/^\d{1,3}$/.test(String(c.obj.dev||'')))reads0.push({candidate:c,dev:String(c.obj.dev)});});   /* his typed numbers teach too */
    /* the threshold: the fraction of the ink-to-paper range at which the confirmed reads yield the most glyphs */
    let lib=[],byDigit={},bestF=null;
    for(const f of LRN_INK_FRACS){
      G.dark=Math.min(200,Math.max(20,Math.round(G.ink+f*(G.paper-G.ink))));const L=[],B={};
      reads0.forEach(a=>{const c=a.candidate,dev=a.dev;const ws=lrnWordsFor(G,Number(c.obj.x),Number(c.obj.y),side).filter(w=>w.g.length===dev.length);if(!ws.length)return;
        ws[0].g.forEach((g,i)=>{L.push({p:lrnPatch(G,g),d:dev[i],id:c.id});B[dev[i]]=(B[dev[i]]||0)+1;});});   /* [240-C] whose glyph */
      if(L.length>lib.length){lib=L;byDigit=B;bestF=f;}
    }
    G.dark=bestF==null?G.dark:Math.min(200,Math.max(20,Math.round(G.ink+bestF*(G.paper-G.ink))));
    if(lib.length<LRN_MIN_LIB)return {library:lib.length,byDigit,candidates:unread.length,reads:0,words:0,dark:G.dark,frac:bestF,ink:G.ink,paper:G.paper,ms:Date.now()-t0,why:'library-too-small'};
    /* [240-C] THE SHEET'S OWN DIGITS CHECK THE STRIPS. Tesseract's confidence is no signal (right at 17,
       wrong at 89) and two scales agreeing is not enough on 7 px digits: 42 read 62, 98 read 38, 113 read 11.
       Each strip read, leave-one-out (its own glyphs are in the library and match themselves at 1.0): the
       nearest word of the read's length, glyph by glyph - doubted when another digit's best patch is at
       least LRN_NCC and beats the read digit's best by LRN_VERIFY_MARGIN, or when no word of that length
       is beside the symbol at all (merged glyphs, or three where the read has two). A doubted read is
       not applied: the row goes to Review with what was read and what the digits say. */
    const verify={checked:0,contradicted:0,unconfirmed:0};
    pool.assigned.assignments.forEach(a=>{const lab=a.label,c=a.candidate;if(a.withheld||lab.phase!=='strip'||!/^\d{1,3}$/.test(String(lab.dev||'')))return;verify.checked++;
      const dev=String(lab.dev),ws=lrnWordsFor(G,Number(c.obj.x),Number(c.obj.y),side).filter(w=>w.g.length===dev.length);
      let doubt='',said='';
      if(!ws.length)doubt='unconfirmed';
      else{const own=lib.filter(e=>e.id!==c.id);
        for(let i=0;i<dev.length;i++){const p=lrnPatch(G,ws[0].g[i]);
          let same=0,other=0,od='';for(const e of own){const v=lrnNcc(p,e.p);if(e.d===dev[i]){if(v>same)same=v;}else if(v>other){other=v;od=e.d;}}   /* the read digit's best patch anywhere in the library, not only among the five nearest: a thin class sits below them and is not thereby contradicted */
          said+=(other>same&&od)?od:dev[i];if(other>=LRN_NCC&&other-same>=LRN_VERIFY_MARGIN)doubt='contradict';}}
      if(!doubt)return;verify[doubt==='contradict'?'contradicted':'unconfirmed']++;
      rawLabels.forEach(l=>{if(l.phase==='strip'&&l.observedNear===lab.observedNear&&String(l.dev)===dev){l.doubt=doubt;l.said=doubt==='contradict'?said:'';}});
    });
    let reads=0,words=0;const claimed=new Set();
    for(const i of unread){
      const c=candidates[i];if(!c||!c.meta||c.meta.noNumber||c.meta.devCleared)continue;
      if(c.meta.devSource==='user'||c.meta.devSource==='schedule')continue;   /* a teacher is not read */
      const ws=lrnWordsFor(G,Number(c.obj.x),Number(c.obj.y),side);words+=ws.length;
      for(const w of ws){
        const key=w.x0+','+w.top+','+w.x1+','+w.bot;if(claimed.has(key))continue;
        /* [241-A] A PRINTED NUMBER BELONGS TO THE SYMBOL IT IS PRINTED BESIDE. `claimed` starts empty and
           knows nothing of the words the strip pass already used, and `unread` is walked in candidate
           order, so the FIRST symbol to reach a word took it: his 87 was read for the thermal beside its
           owner and landed on two rows. The block comment above already says a learned label belongs to
           the symbol it was read beside - that was enforced at assignment time only. Enforce it here:
           the word must be nearest to THIS candidate, on the same Chebyshev distance as `w.d`. */
        const wcx=(w.x0+w.x1)/2,wcy=(w.top+w.bot)/2;
        if(candidates.some(o=>o!==c&&o.decision!=='rejected'&&Math.max(Math.abs(Number(o.obj.x)-wcx),Math.abs(Number(o.obj.y)-wcy))<=w.d))continue;
        if(w.loose>LRN_LOOSE)continue;
        let text='',ok=true,conf=1;
        for(const g of w.g){const r=lrnKnn(lib,lrnPatch(G,g));const need=Math.max(2,Math.min(LRN_AGREE,byDigit[r.d]||0));let d='';
          if(r.s>=LRN_NCC&&r.n>=need&&r.top===r.d)d=r.d;   /* the vote - and the nearest patch agrees with it [240-D] (6 read 8 on a 6 at 0.89 over four 8s at 0.81) */
          else if(r.second>=LRN_THIN&&r.secondD===r.top&&r.s-r.other>=LRN_THIN_MARGIN)d=r.top;   /* [240-D] a thin class: the two nearest agree, clear of every other digit (four 6s in the library needed all four in the top five; one 7 could never read) */
          if(!d){ok=false;break;}text+=d;conf=Math.min(conf,r.s);}
        if(!ok||!text)continue;
        const dev=String(parseInt(text,10));
        rawLabels.push({loop:'',dev,raw:text,text,confidence:Math.round(conf*100),bbox:[w.x0,w.top,w.x1-w.x0,w.bot-w.top],votes:1,variant:'learned',psm:'',phase:'learned',observedNear:c.id,only:c.id,offsetX:0,offsetY:0,upscale:1});
        claimed.add(key);reads++;break;
      }
    }
    return {library:lib.length,byDigit,candidates:unread.length,reads,words,verify,dark:G.dark,frac:bestF,ink:G.ink,paper:G.paper,ms:Date.now()-t0,why:unread.length?'':'nothing-unread'};   /* [240-C] */
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
    let hi=null;   /* [218-D] */
    try{hi=await hiresPrepare(candidates,opts.radiusX+OCR_QUADRANT_W+OCR_QUADRANT_OFFSET_X,opts.radiusY+OCR_QUADRANT_H+OCR_QUADRANT_OFFSET_Y,(i,n)=>{session.ocrStatus=`Reading the sheet at full detail… ${i+1} of ${n}`;session.progress=null;spTick();});}
    catch(e){if(e&&e.cancelled)throw e;hi=null;hiresWhy='render-failed: '+((e&&e.message)||'unknown');}   /* [222-A] */
    try{
      /* AL4 fill discipline: every candidate gets one centred read. Only rows
         still unsafe/unassigned after global one-to-one assignment get retries.
         V1.6 proved the left-only D76 recovery matters, so all four 30 px cardinal
         retries are restored. Rows still unresolved then get four larger quadrant
         crops at the SAME 2x raster, raw pixels and PSM 6; no 4x upscaling. */
      const all=candidates.map((_,i)=>i).filter(i=>!(candidates[i].meta&&(candidates[i].meta.noNumber||candidates[i].meta.devCleared)));   /* [230-A] [232-B] */
      const phases={};
      let numbersOnly=false,centerAssigned0=0,afterOffset0=0;
      if(opts.mode==='auto'){
        /* WHICH KIND OF SHEET? A few wide L01.D40-style reads first: a strip
           would read "43" out of "L01.D43" and the loop would be lost. */
        const step=Math.max(1,Math.floor(all.length/OCR_STYLE_PROBE_N)),probe=all.filter((_,i)=>i%step===0).slice(0,OCR_STYLE_PROBE_N);
        session.ocrStatus='Checking how this sheet labels its symbols…';session.progress=null;spTick();
        phases.probe=await runOcrCandidatePass(worker,candidates,probe,opts,rawLabels,'center',[[0,0]],baseUpscale);
        if(rawLabels.some(l=>l.loop)){opts.mode='loop-device';phases.strip={candidates:0,crops:0,reads:0,readCandidates:0,adopted:false,skipped:'loop-device labels found'};}
        else{rawLabels.length=0;opts.mode='dev-only-try';}
      }
      if(opts.mode==='dev-only'||opts.mode==='dev-only-try'){
        const forced=opts.mode==='dev-only';
        /* [228-A] the drawing first: on a vector sheet the numbers are stroke-font glyphs beside
           each square, read by shape in well under a second. What that reads settles those
           candidates; the OCR strips run only on what is left. */
        session.ocrStatus='Reading the numbers off the drawing…';session.progress=null;spTick();
        phases.vector=vecReadLabels(candidates,rawLabels);
        let stripIdx=all;
        if(phases.vector.reads){const pv=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);stripIdx=unreadCandidateIndexes(pv,candidates);phases.vector.settled=candidates.length-stripIdx.length;}
        phases.strip=await runOcrStripPass(worker,candidates,stripIdx,rawLabels);
        numbersOnly=forced||(phases.strip.readCandidates+phases.vector.readCandidates)>=Math.max(1,Math.ceil(candidates.length*OCR_STRIP_ADOPT_RATIO));
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
      /* [236-A] what no pass could read, the sheet's own digits can: the library from every read so far, then the rest */
      {const pl=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx),un=unreadCandidateIndexes(pl,candidates);
      session.ocrStatus='Reading the rest with the sheet\u2019s own digits\u2026';session.progress=null;spTick();
      phases.learned=learnedReadLabels(candidates,pl,un,rawLabels);}   /* [240-C] always: the library checks the strips even when nothing is unread */
      let pool=poolOcrAssignments(rawLabels,candidates,opts.maxAssignmentPx);
      const centerAssigned=numbersOnly?pool.assigned.usedCandidates.size:centerAssigned0;const afterOffset=numbersOnly?centerAssigned:afterOffset0;

      const labels=pool.labels,assigned=pool.assigned,consistency=pool.consistency;
      let applied=0,withheld=0,mismatch=0;
      candidates.forEach(c=>{if(c.meta.devSource==='ocr'){c.obj.dev='';c.meta.devSource='';c.meta.devHow='';}if(c.meta.loopSource==='ocr'){c.obj.loop='';c.meta.loopSource='';}c.meta.ocrIssue='';c.meta.ocrDistance=null;c.meta.ocrConfidence=null;});
      candidates.forEach(c=>{if(numbersOnly&&Array.isArray(c.meta.stripConflict)&&c.meta.stripConflict.length>1){c.meta.ocrIssue=`Two numbers are printed next to it: ${c.meta.stripConflict.join(' and ')}. Pick one.`;c.decision='review';withheld++;}});
      assigned.assignments.forEach(a=>{
        const c=a.candidate,lab=a.label;c.meta.ocrDistance=Math.round(a.distance*10)/10;c.meta.ocrConfidence=lab.confidence;
        if(a.withheld){withheld++;c.meta.ocrIssue=a.withheld;c.decision='review';return;}
        if(lab.doubt){withheld++;c.meta.ocrIssue=lab.doubt==='contradict'?`Read as ${lab.dev}, but the sheet's own digits say ${lab.said} - check the drawing and type it.`:`Read as ${lab.dev}, but the sheet's own digits could not confirm it - check the drawing and type it.`;c.decision='review';return;}   /* [240-C] */
        const protectedDev=(c.meta.devSource==='user'||c.meta.devSource==='schedule')&&field(c.obj.dev);
        const protectedLoop=(c.meta.loopSource==='user'||c.meta.loopSource==='schedule')&&(field(c.obj.loop)||c.meta.loopCleared);   /* [232-B] a loop he took off is his too */
        if((protectedDev&&field(c.obj.dev)!==lab.dev)||(protectedLoop&&lab.loop&&field(c.obj.loop)!==lab.loop)){
          mismatch++;c.meta.ocrIssue=`Printed identity ${lab.loop?`L${lab.loop}.D`:''}${lab.dev} disagrees with the ${protectedDev||protectedLoop?'user/schedule':'existing'} identity.`;c.decision='review';return;
        }
        if(!protectedDev){c.obj.dev=lab.dev;c.meta.devSource='ocr';c.meta.devHow=lab.variant==='vector'?'vector':lab.variant==='learned'?'learned':'ocr';}   /* [228-A] read off the drawing, or read off the pixels; [236-A] or by the sheet's own digits */
        if(lab.loop&&!protectedLoop){c.obj.loop=lab.loop;c.meta.loopSource='ocr';}
        applied++;
      });
      if(session.schedule.length) reconcileSchedule(true);
      else refreshIssues();
      const finalAssigned=pool.assigned.usedCandidates.size;
      const report={summary:{labels:labels.length,assigned:assigned.assignments.length,applied,withheld,mismatch,unread:Math.max(0,candidates.length-finalAssigned),capPx:opts.maxAssignmentPx,
        centerAssigned,offsetRecovered:Math.max(0,afterOffset-centerAssigned),quadrantRecovered:Math.max(0,finalAssigned-afterOffset),baseUpscale,
        vector:phases.vector?{reads:phases.vector.reads,settled:phases.vector.settled||0,seen:phases.vector.seen,ms:phases.vector.ms,why:phases.vector.why||''}:null,   /* [228-A] */
        learned:phases.learned?{library:phases.learned.library,reads:phases.learned.reads,candidates:phases.learned.candidates,verify:phases.learned.verify||null,ms:phases.learned.ms,why:phases.learned.why||''}:null,   /* [236-A] [240-C] */
        retryDirections:OCR_RETRY_DIRECTIONS.map(d=>d.name),quadrantDirections:OCR_QUADRANTS.map(d=>d.name),quadrantWidth:OCR_QUADRANT_W,quadrantHeight:OCR_QUADRANT_H,quadrantOffsetX:OCR_QUADRANT_OFFSET_X,quadrantOffsetY:OCR_QUADRANT_OFFSET_Y,elapsedMs:Date.now()-started,hires:hi?{k:hi.k,tiles:hi.rendered,renderMs:hi.ms}:{off:hiresWhy||'unknown'}},   /* [222-A] */
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
#${MODAL_ID} .spRow{display:grid;grid-template-columns:48px minmax(80px,1fr) 62px 62px 62px 136px;gap:6px;align-items:center;padding:7px 4px;border-bottom:1px solid rgba(128,128,128,.18)}   /* [238-E] the handle, then two decision buttons */
#${MODAL_ID} .spRow input,#${MODAL_ID} .spRow select{min-width:0;width:100%;min-height:38px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-field,#15181c);color:var(--fs-fieldText,inherit);padding:6px}
#${MODAL_ID} .spRow .spIssue{grid-column:2/-1;font-size:10px;color:var(--fs-danger,#ffb3a7);line-height:1.35}
#${MODAL_ID} .spRow.spRowFocus{outline:2px solid #e040fb;outline-offset:-2px;border-radius:6px}
#${MODAL_ID} .spRow{cursor:pointer}
#${MODAL_ID} .spZoneBox{margin:8px 0 12px;padding:9px;border:1px solid var(--fs-border,#3a4047);border-radius:10px;background:var(--fs-tile,#292e34)}
#${MODAL_ID} .spFillList{display:flex;flex-direction:column;gap:1px;background:var(--fs-border,#3a4047);border:1px solid var(--fs-border,#3a4047);border-radius:8px;overflow:hidden;margin-top:8px}
#${MODAL_ID} .spFillHint{display:block;font-size:11.5px;color:var(--fs-sub2,#8a939c);font-weight:400;margin-top:2px}   /* [225-B] */
#${MODAL_ID} .spFillRow{display:grid;grid-template-columns:26px 1fr 92px;gap:10px;align-items:center;padding:8px 10px;background:var(--fs-panel,#22272c)}
#${MODAL_ID} .spSwatch{width:22px;height:22px;border-radius:5px;border:1px solid rgba(128,128,128,.55);display:block}
#${MODAL_ID} .spFillN{color:var(--fs-sub,#9aa2aa);font-size:13.5px}
@media(max-width:820px){#${MODAL_ID} .spFillRow{grid-template-columns:26px 1fr 78px}}
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
#${MODAL_ID} .spRuns{margin:8px 0 0;padding:8px 10px;border-radius:10px;border:1px solid var(--fs-border,#3a4047);background:var(--fs-card,#20242a);font-size:12.5px}
#${MODAL_ID} .spRunsHead{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:4px;color:var(--fs-sub,#9aa2aa)}
#${MODAL_ID} .spRunsHead b{color:inherit;font-size:13px}
#${MODAL_ID} .spRunsRow{display:flex;gap:10px;flex-wrap:wrap;padding:5px 0;border-top:1px solid var(--fs-border,#3a4047)}
#${MODAL_ID} .spRunsType{font-weight:700;min-width:120px}
#${MODAL_ID} .spRunsBits{color:var(--fs-sub,#9aa2aa)}
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
#${MODAL_ID} .spColHead{display:grid;grid-template-columns:48px minmax(80px,1fr) 62px 62px 62px 136px;gap:6px;font-size:10px;color:var(--fs-sub,#9aa2aa);padding:4px 4px 2px;text-transform:uppercase;letter-spacing:.04em}
#${MODAL_ID} .spRow .spCell{position:relative;min-width:0}#${MODAL_ID} .spRow .spCell input{width:100%;padding-right:22px}#${MODAL_ID} .spRow .spClr{position:absolute;right:1px;top:50%;transform:translateY(-50%);width:20px;height:26px;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.55;font-size:17px;line-height:1;padding:0;cursor:pointer}#${MODAL_ID} .spRow .spClr:hover{opacity:1;background:rgba(128,128,128,.18)}#${MODAL_ID} .spRow .spClr[hidden]{display:none}#${MODAL_ID} .spRow button.spClr{min-height:0;height:26px;width:20px}
#${MODAL_ID} .spTaught{margin:8px 0;border:1px solid var(--fs-border,#3a4047);border-radius:10px;padding:8px 10px}#${MODAL_ID} .spTaughtRow{display:flex;align-items:center;gap:10px;padding:4px 0}#${MODAL_ID} .spTaughtCrop{width:40px;height:40px;object-fit:contain;image-rendering:pixelated;background:#fff;border:1px solid var(--fs-border,#3a4047);border-radius:6px;flex:0 0 40px}#${MODAL_ID} .spTaughtText{font-size:13px}#${MODAL_ID} .spTaughtText span{color:var(--fs-sub,#9aa2aa)}   /* [239-B] the taught list */
#${MODAL_ID} .spGo{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;min-height:38px;height:38px;width:48px;padding:1px 0;border:1px solid var(--fs-border,#4b525c);border-radius:8px;background:var(--fs-field,#15181c);color:inherit;cursor:pointer}   /* [238-E] the tap handle: the issue badge and a target, in a button */
#${MODAL_ID} .spGo .spGoIco{font-size:13px;line-height:1;opacity:.85}#${MODAL_ID} .spGo .spBadge{padding:1px 6px;line-height:1.2}#${MODAL_ID} .spGo:hover{border-color:var(--fs-accent,#ff6a3d)}#${MODAL_ID} .spRowFocus .spGo{border-color:#e040fb}
#${MODAL_ID} .spDec{display:flex;gap:4px;min-width:0}#${MODAL_ID} .spDecBtn{flex:1 1 0;min-height:38px;padding:4px 2px;border-radius:7px;border:1px solid var(--fs-border,#4b525c);background:var(--fs-field,#15181c);color:inherit;font-size:12px;cursor:pointer}   /* [238-E] Accept / Reject, two buttons, no dropdown */
#${MODAL_ID} .spDecBtn.spDecOn{background:#1f8f4e;border-color:#1f8f4e;color:#fff}#${MODAL_ID} .spDecBtn.spDecOnNo{background:#b23b2e;border-color:#b23b2e;color:#fff}
#${MODAL_ID} .spDecHead{display:flex;gap:4px}#${MODAL_ID} .spMini{min-height:26px;padding:2px 6px;font-size:10px;border-radius:6px;border:1px solid var(--fs-border,#4b525c);background:transparent;color:inherit;text-transform:none;letter-spacing:0;cursor:pointer}
#${MODAL_ID} .spChips{margin:2px 0 8px}#${MODAL_ID} .spChipRow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}#${MODAL_ID} .spChipLab{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--fs-sub,#9aa2aa);min-width:34px}   /* [238-D] filter chips: type, zone */
#${MODAL_ID} .spChip{min-height:32px;padding:4px 10px;border-radius:999px;border:1px solid var(--fs-border,#4b525c);background:transparent;color:inherit;font-size:12px;cursor:pointer}#${MODAL_ID} .spChip b{font-weight:600;opacity:.8}#${MODAL_ID} .spChip.spChipOn{background:var(--fs-accent,#ff6a3d);border-color:var(--fs-accent,#ff6a3d);color:#fff}
#${MODAL_ID} .spShell.spWide{max-width:1400px}#${MODAL_ID} .spShell.spWide .spBody{grid-template-columns:minmax(340px,1.6fr) minmax(300px,.8fr)}   /* [238-E] Review gets the wider pane */
@media(max-width:600px){#${MODAL_ID} .spShell .spRow{grid-template-columns:48px 1fr 56px 56px 56px}#${MODAL_ID} .spShell .spRow .spDec{grid-column:2/-1}#${MODAL_ID} .spShell .spColHead{grid-template-columns:48px 1fr 56px 56px 56px}#${MODAL_ID} .spShell .spColHead .spDecHead{grid-column:1/-1}}   /* [238-E] a phone: the two buttons on their own line */#${MODAL_ID} .spActions .spBtnOn{background:var(--fs-accent,#ff6a3d);border-color:var(--fs-accent,#ff6a3d);color:#fff}#${MODAL_ID} .spActions .spBtnDone,#${MODAL_ID} .spActions .spBtnDone:disabled{background:#1f9d55;border-color:#1f9d55;color:#fff;opacity:1}   /* [234-A] the 233 selector said .spRow and the buttons are in .spActions - it never rendered */#${MODAL_ID} .spOrder{font-size:11px;opacity:.75;margin:6px 0 2px}   /* [233-A] the x sits inside its cell at EVERY width - this was inside the 820 px media query and his iPad is 1180 */
@media(max-width:820px){#${MODAL_ID} .spHead{flex-wrap:wrap}#${MODAL_ID} .spStep{flex:1 1 100%;order:9;text-align:left;border:0;padding:2px 0 0}#${MODAL_ID} .spColHead{grid-template-columns:48px 1fr 56px 56px 56px 118px}}
@media(max-width:820px){#${MODAL_ID} .spBody{display:block;overflow:auto}#${MODAL_ID} .spPane{overflow:visible}#${MODAL_ID} .spPane+ .spPane{border-left:0;border-top:1px solid var(--fs-border,#3a4047)}#${MODAL_ID} .spFoot{flex-wrap:wrap;row-gap:6px}#${MODAL_ID} .spFoot [data-sp="foot"]{flex:1 1 100%}#${MODAL_ID} .spFoot [data-sp="bar"]{flex:1 1 100%;width:auto!important}#${MODAL_ID} .spFoot .spGrow{display:none}#${MODAL_ID} .spFoot button{flex:1 1 auto}#${MODAL_ID} .spStats{grid-template-columns:repeat(3,1fr)}#${MODAL_ID} .spRow{grid-template-columns:48px 1fr 56px 56px 56px 118px}.spRow .spDecision{grid-column:2/-1}#${MODAL_ID} .spMini{padding:2px 4px}#${MODAL_ID} .spDetectGrid{grid-template-columns:1fr 1fr}#${MODAL_ID} .spDetectGrid button{grid-column:1/-1}#${MODAL_ID} .spZoneGrid{grid-template-columns:1fr 1fr}#${MODAL_ID} .spZoneGrid button{grid-column:1/-1}}
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
  const SP_STEPS=['Start','Teach one symbol','Find and read','Panel schedule','Zones','Review','Commit'];   /* [231-C] [238-C] teach, not show - his word */
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
  /* [223-B] "not even sure I got it all" is unanswerable when the thing is a wall of
     text in a small box, so the size goes where he can see it before and after. */
  function spDiagSize(t){
    const n=(t||'').length;
    return n>=1024?((n/1024).toFixed(1)+' KB'):(n+' characters');
  }
  function spReadDiag(){
    const r=session&&session.ocrReport;if(!r||!r.phases)return null;
    const p=r.phases,s=r.summary||{};const st=p.strip||{};
    /* [222-B] SAY IT, DO NOT OMIT IT. When the sheet WAS re-rendered this said so;
       when it was not it said nothing and the sentence simply started a word later.
       After a ten-minute pass, nothing on the line he reads told him the reader had
       been looking at screen pixels - which is the whole reason his V0.200 numbers
       went backwards. */
    const style=(s.hires&&s.hires.k?`sheet at ${s.hires.k}× detail, `
                 :`SCREEN RESOLUTION ONLY (${(s.hires&&s.hires.off)||'unknown'}) — far fewer numbers will be read, `)+(st.adopted?'bare numbers (strips)':(st.skipped?'L01.D40 labels (wide passes)':(p.probe?'no style adopted - fell back to the wide passes':'wide passes')));
    const looks=(st.crops||0)+((p.probe&&p.probe.crops)||0)+((p.center&&p.center.crops)||0)+((p.offset&&p.offset.crops)||0)+((p.quadrant&&p.quadrant.crops)||0);
    /* [242-B] one pixel of taught width was worth nine detectors on his scan and nothing said
       which box was used, so his run and a sandbox run were never comparable. */
    const dr=session&&session.detectReport&&session.detectReport.summary||null;
    const tb=session&&session.detectReport&&session.detectReport.bbox||null;
    const rnd=(b)=>b?`${Math.round(b[2])} \u00d7 ${Math.round(b[3])}`:'';
    /* no indefinite article: 'an 18' and 'a 19' are both right and neither rule is worth
       carrying, and 'an 19' shipped in the first cut of this. */
    const dw=(session&&session.taughtDrawn)||(dr&&dr.drawn)||null;
    const taught=tb?`Taught box: ${rnd(tb)}`
      +((dw&&rnd(dw)!==rnd(tb))?` (you drew ${rnd(dw)})`:'')+'.':'';
    return {taught,taughtBox:tb?tb.slice():null,drawnBox:dw?dw.slice():null,
      style,looks,agreed:st.reads||0,readCandidates:st.readCandidates||0,applied:s.applied||0,withheld:s.withheld||0,unread:s.unread||0,ms:s.elapsedMs||0,unconfirmed:st.unconfirmed||0,
      text:JSON.stringify({version:VERSION,ua:(typeof navigator!=='undefined'&&navigator.userAgent)||'',plan:currentDims(),candidates:session.candidates.length,summary:s,phases:p,
        taught:{used:tb,drawn:dw,tightened:!!(session.detectReport&&session.detectReport.tightened)},   /* [242-B] */
        zones:session.fillZones?{groups:session.fillZones.groups.map(g=>({hue:Math.round(g.hue),count:g.count,zone:g.zone,from:g.zoneFrom||'',names:g.zoneNames||[]})),plain:session.fillZones.plain,sampled:session.fillZones.sampled,labels:session.fillZones.labels||[],readMs:session.fillZones.readMs||null,readError:session.fillZones.readError||'',diag:zoneDiagOut(session.fillZones.diag),log:(session.zoneLog||[]).slice(-20)}:null,zoneLog:session.fillZones?undefined:(session.zoneLog||[]).slice(-20),drawing:{squares:session.vectorLast||null,shape:session.vectorShapeLast||null}},null,1)};   /* [230-B] the drawing's own finds ride in the paste */   /* [229-1] the zones step's own log rides in the paste */   /* [225-B] */   /* [221-D] */
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
    const txt=picking?'Drag a tight box around ONE symbol here. Pinch or scroll to zoom first; two fingers pan.':(pairing?'Now tap the matching point on THIS plan.':(session&&session.candidates.length?'Green = found. Amber = needs a look. Blue box = the one you taught. Pink ring = the row you are on.'   /* [242-A] the focused row is drawn #e040fb at r=14 and was the one colour the legend never named */:'The plan on screen. Pinch or scroll to zoom, drag to pan.'));
    return '<div class="spCaption'+((picking||pairing)?' on':'')+'" data-sp="caption">'+escapeHtml(txt)+'</div>';
  }
  function spStepHead(){
    const m=ensureModal(),el=m.querySelector('[data-sp="stepno"]');
    if(el)el.textContent=`Step ${uiStep} of ${SP_STEPS.length} · ${SP_STEPS[uiStep-1]}`;
  }
  /* PASS 216 [216-A] - what has been found, BY TYPE. "212 found" was a mixed
     total; he wants "how many of what". */
  function spTypeCounts(){const m=new Map();(session?session.candidates:[]).forEach(c=>{if(c.decision==='rejected')return;const k=field(c.obj&&c.obj.type)||'?';m.set(k,(m.get(k)||0)+1);});return Array.from(m,([type,n])=>({type,label:arcTypeLabel(type),n})).sort((a,b)=>b.n-a.n);}
  function spTypeLine(){return spTypeCounts().map(x=>`${x.n} ${x.label}`).join(' · ');}
  /* PASS 216 [216-C] - areas to leave out ("the legend and that schematic up the
     top") or to search only. Plan pixels, [x,y,w,h]. None drawn = the whole plan. */
  function spAreas(){if(!session)return {exclude:[],include:[]};if(!session.areas)session.areas={exclude:[],include:[]};return session.areas;}
  function spInBox(b,x,y){return x>=b[0]&&x<=b[0]+b[2]&&y>=b[1]&&y<=b[1]+b[3];}
  function spAreaExcluded(x,y){const a=spAreas();if(a.exclude.some(b=>spInBox(b,x,y)))return true;if(a.include.length&&!a.include.some(b=>spInBox(b,x,y)))return true;return false;}
  /* PASS 217 [217-A] - the running list of finds. One row per Find and read run; the total is live (rejected in Review drops out). */
  function spRuns(){if(!session)return [];if(!Array.isArray(session.runs))session.runs=[];return session.runs;}
  function spRunLog(d){if(!session||!d)return;spRuns().push({type:d.type||'?',kept:d.kept|0,read:(d.read===null||d.read===undefined)?null:(d.read|0),area:d.area|0,ms:d.ms|0,at:Date.now()});}
  function spRunSecs(ms){return ms>=1000?`${Math.round(ms/1000)} s`:(ms>0?'<1 s':'');}
  function spRunsHtml(){
    const runs=spRuns();if(!runs.length&&!(session&&(session.vectorLast||session.vectorShapeLast)))return '';   /* [226-B] the drawing's row stands on its own */   /* [230-B] */
    /* one row per TYPE: found and read are LIVE (the reader re-reads every candidate on each run; Review can reject), time and left-out are summed over that type's runs */
    const live=session.candidates.filter(c=>c.decision!=='rejected');
    const types=spTypeCounts().map(x=>x.type);runs.forEach(r=>{if(!types.includes(r.type))types.push(r.type);});
    const rows=types.map((type,i)=>{const mine=runs.filter(r=>r.type===type),of=live.filter(c=>(field(c.obj&&c.obj.type)||'?')===type);const found=of.length,read=of.filter(c=>c.meta&&c.meta.devSource==='ocr').length,ms=mine.reduce((a,r)=>a+r.ms,0),area=mine.reduce((a,r)=>a+r.area,0),anyRead=mine.some(r=>r.read!==null);
      const bits=[`<b>${found}</b> found`];if(anyRead)bits.push(`${read} number${read===1?'':'s'} read`);const secs=spRunSecs(ms);if(secs)bits.push(secs);if(area)bits.push(`${area} left out (excluded areas)`);
      return `<div class="spRunsRow" data-sp="run" data-run="${i}" data-type="${escapeHtml(type)}"><span class="spRunsType">${escapeHtml(arcTypeLabel(type))}</span><span class="spRunsBits">${bits.join(' · ')}</span></div>`;}).join('');
    const total=live.length;
    const vl=session.vectorLast;   /* [226-B] the squares no teach has claimed yet - not merely the ones that are not THIS symbol - so the ask 'show one of those next' means something on the third teach */
    const half=vl?Math.max(2,vl.side/2):0,left=vl?vl.misses.filter(m=>!live.some(c=>Math.abs(Number(c.obj.x)-m.x)<=half&&Math.abs(Number(c.obj.y)-m.y)<=half)).length:0;
    const vec=vl?`<div class="spRunsRow" data-sp="vector"><span class="spRunsType">Drawing</span><span class="spRunsBits">${vl.squares} squares this size on the drawing · ${vl.matched} look like ${escapeHtml(arcTypeLabel(vl.type))}${left?` · <b>${left} not matched by any teach yet</b> — teach one of those next`:' · every one is matched'}</span></div>`:'';
    const vsl=session.vectorShapeLast;   /* [230-B] a symbol that is not a square: its own row */
    const shape=vsl?`<div class="spRunsRow" data-sp="vector-shape"><span class="spRunsType">Drawing</span><span class="spRunsBits">${vsl.matched} drawn like ${escapeHtml(arcTypeLabel(vsl.type))} — its own shape, ${vsl.pieces} stroke${vsl.pieces===1?'':'s'}${vsl.partial?`, ${vsl.partial} with a stroke missing`:''}${vsl.otherSize?`, ${vsl.otherSize} at another size (${Object.keys(vsl.scales||{}).filter(k=>k!=='1').map(k=>k+'×').join(', ')})`:''}${vsl.numbered?'':' · no number beside most of them, so none are read'}</span></div>`:'';
    return `<div class="spRuns" data-sp="runs"><div class="spRunsHead"><b>Found so far</b><span data-sp="runs-total">${total} on the plan${types.length>1?` · ${escapeHtml(spTypeLine())}`:''}</span></div>${rows}${vec}${shape}</div>`;
  }
  function spAreasNote(){const a=spAreas();const parts=[];if(a.exclude.length)parts.push(`${a.exclude.length} area${a.exclude.length===1?'':'s'} left out (red)`);if(a.include.length)parts.push(`searching only ${a.include.length} area${a.include.length===1?'':'s'} (green)`);return parts.length?parts.join(' · ')+'.':'None drawn - the whole plan is searched.';}
  function spNav(left,opts){
    opts=opts||{};
    const nav=document.createElement('div');nav.className='spNav';
    const back=document.createElement('button');back.className='btn';back.setAttribute('data-sp','back');back.textContent=uiStep===1?'Close':((uiStep===2&&session&&session.candidates.length)?'Back to Review':'Back');   /* [216-B] */
    back.onclick=()=>{
      if(uiStep===1){if(spDiscardGuarded())spClose();return;}
      if(uiStep===2){if(session&&session.candidates.length){spGo(6);return;}   /* [216-B] never a discard by accident */
        if(spDiscardGuarded()){ensureModal().style.display='block';render();}return;}
      spGo(uiStep-1);
    };
    nav.appendChild(back);
    if(opts.next){const nx=document.createElement('button');nx.className='btn'+(opts.nextPrimary?' spPrimary':'');nx.setAttribute('data-sp','next');nx.textContent=opts.next;nx.disabled=!!opts.nextDisabled;nx.onclick=()=>spGo(opts.nextTo||(uiStep+1));nav.appendChild(nx);}
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

  /* [239-B] the record of every teach: one entry per type (a re-teach of a type replaces its candidates, so it replaces its entry), with a crop of the box he drew at 3x, capped at 96 px */
  function spRecordTeach(type,box,kept,method){
    if(!session)return;if(!Array.isArray(session.taught))session.taught=[];
    let crop='';try{const live=livePlanImage();if(live&&box){const [x,y,w,h]=box,k=Math.min(3,96/Math.max(1,w,h)),cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*k));cv.height=Math.max(1,Math.round(h*k));const cx=cv.getContext('2d');cx.imageSmoothingEnabled=false;cx.drawImage(live,x,y,w,h,0,0,cv.width,cv.height);crop=cv.toDataURL('image/png');}}catch(_){crop='';}
    session.taught=session.taught.filter(t=>t.type!==type);
    session.taught.push({type,box:box?box.slice():null,crop,kept,method,at:Date.now()});
  }
  function spTaughtHtml(){
    const list=(session&&Array.isArray(session.taught))?session.taught:[];if(!list.length)return '';
    return `<div class="spTaught" data-sp="taught"><div class="spCaption">Taught so far - ${list.length} symbol${list.length===1?'':'s'}</div>${list.map(t=>`<div class="spTaughtRow" data-taught="${escapeHtml(t.type)}">${t.crop?`<img class="spTaughtCrop" src="${t.crop}" alt="">`:'<span class="spTaughtCrop"></span>'}<span class="spTaughtText"><b>${escapeHtml(arcTypeLabel(t.type))}</b><span> ${t.kept} found${t.method==='vector'?' off the drawing':''}</span></span></div>`).join('')}</div>`;
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
    right.innerHTML='<div class="spPvHead"><div style="font-weight:700">The plan</div>'+pvToolbarHtml('main')+'</div><canvas data-sp="canvas" width="1400" height="965"></canvas>'+spCaptionHtml()+spRunsHtml()+(hasZone?'<div class="spSourceCanvas"><div class="spPvHead"><div style="font-weight:700">The zone plan</div>'+pvToolbarHtml('zone')+'</div><canvas data-sp="zone-canvas" width="1400" height="965"></canvas><div class="spCaption">Show hatching, draw zones and pick match points here. Pinch or scroll to zoom, drag to pan. This sheet is never written into the plan or the register.</div></div>':'');
    const cv=right.querySelector('[data-sp="canvas"]'),ctx=cv.getContext('2d');const dims=currentDims();
    const geometry=()=>{const sw=dims.w||cv.width,sh=dims.h||cv.height;return pvGeometry(cv,pvMain,sw,sh);};
    const LW=cv.width/900;   /* line weights were tuned on a 900-wide canvas */
    const drawAll=()=>{ctx.clearRect(0,0,cv.width,cv.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);const live=livePlanImage(),g=geometry();if(live){try{ctx.drawImage(live,g.ox,g.oy,g.sw*g.scale,g.sh*g.scale)}catch(_){}}
      session.zones.forEach(zc=>{if(zc.decision==='rejected')return;const z=zc.obj,pts=z.pts||[];if(pts.length<3)return;ctx.save();ctx.strokeStyle=zc.decision==='accepted'?'#7e57c2':'#ffb300';ctx.lineWidth=2*LW;ctx.beginPath();pts.forEach((p,i)=>{const x=g.ox+p.x*g.scale,y=g.oy+p.y*g.scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.stroke();ctx.restore();});
      /* [216-C] areas: red = left out, green = only here */const A=spAreas();A.exclude.forEach(b=>{ctx.save();ctx.fillStyle='rgba(229,57,53,.16)';ctx.strokeStyle='#e53935';ctx.setLineDash([8*LW,5*LW]);ctx.lineWidth=2*LW;const x=g.ox+b[0]*g.scale,y=g.oy+b[1]*g.scale,w=b[2]*g.scale,h=b[3]*g.scale;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();});A.include.forEach(b=>{ctx.save();ctx.fillStyle='rgba(0,166,90,.12)';ctx.strokeStyle='#00a65a';ctx.setLineDash([8*LW,5*LW]);ctx.lineWidth=2*LW;const x=g.ox+b[0]*g.scale,y=g.oy+b[1]*g.scale,w=b[2]*g.scale,h=b[3]*g.scale;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.restore();});
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
      onDrawEnd:c=>{if(session.boxDrag){finishHandle();return;}if(!session.templatePick||!session.templatePick.start)return;session.templatePick.end=c;const p=clone(session.templatePick),g=geometry();session.templatePick=null;if(p.mode==='exclude'||p.mode==='include'){/* [216-C] an AREA, not a symbol */const ax0=(Math.min(p.start.x,p.end.x)-g.ox)/g.scale,ay0=(Math.min(p.start.y,p.end.y)-g.oy)/g.scale,ax1=(Math.max(p.start.x,p.end.x)-g.ox)/g.scale,ay1=(Math.max(p.start.y,p.end.y)-g.oy)/g.scale;const ab=[clamp(ax0,0,g.sw),clamp(ay0,0,g.sh),clamp(ax1,0,g.sw)-clamp(ax0,0,g.sw),clamp(ay1,0,g.sh)-clamp(ay0,0,g.sh)];if(ab[2]>=6&&ab[3]>=6)spAreas()[p.mode].push(ab);uiStep=2;render();return;}const x0=(Math.min(p.start.x,p.end.x)-g.ox)/g.scale,y0=(Math.min(p.start.y,p.end.y)-g.oy)/g.scale,x1=(Math.max(p.start.x,p.end.x)-g.ox)/g.scale,y1=(Math.max(p.start.y,p.end.y)-g.oy)/g.scale,bbox=[clamp(x0,0,g.sw),clamp(y0,0,g.sh),clamp(x1,0,g.sw)-clamp(x0,0,g.sw),clamp(y1,0,g.sh)-clamp(y0,0,g.sh)];/* [206-B] the box is RECORDED here; step 3's one button runs detect + read. A box under 6 px is a tap, not a box. */if(bbox[2]<6||bbox[3]<6){session.templatePick={active:true,type:p.type,signal:p.signal,threshold:p.threshold,includeMirrors:p.includeMirrors,start:null,end:null};render();alert('Drag a box around the symbol — that was a tap. Zoom in first if it is small.');return;}let snapped=false;const drawnBox=bbox.slice();   /* [242-B] before [211-B] splices the tightened box over it */
    try{const tb=tightenTemplateBox(bbox,p.signal);if(tb.tightened){bbox.splice(0,4,...tb.bbox);snapped=true;}}catch(_){}  /* [211-B] */session.teach={type:p.type,signal:p.signal,threshold:p.threshold,includeMirrors:p.includeMirrors,bbox};session.taughtBox=bbox;session.taughtDrawn=drawnBox;   /* [242-B] */session.boxSnapped=snapped;session.findDone=null;uiStep=2;render();}  /* [210-A] stay here: handles first, Next when he is happy */,
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
      left.innerHTML=`<div class="spScreen"><h3>Smart Plan reads the plan that is on screen.</h3><p>Current sheet: <b data-sp="sheet">${escapeHtml(spSheetName())}</b></p><p>It finds every symbol on it - detectors, sounders, anything drawn the same way - reads the printed numbers and lets you check the lot before anything is saved.</p><button class="btn spPrimary spBig" data-sp="use" ${live?'':'disabled'}>Use this plan</button><button class="btn spQuiet" data-sp="importplan">Import a different plan…</button><p class="spHint">PDF or photo — both work. Nothing is written to the register until you press Commit at the end.</p></div>`;
      left.querySelector('[data-sp="use"]').onclick=()=>{try{uiStep=2;start({name:candidateLevelName()});}catch(e){uiStep=1;alert(e.message||String(e));}};
      left.querySelector('[data-sp="importplan"]').onclick=()=>importPlanThenReturn();
      spNav(left);
      previewNoSession();commitBtn.disabled=true;foot.textContent='Nothing has been started yet.';foot.title='';const d0=m.querySelector('[data-sp="discard"]');if(d0)d0.style.display='none';return;
    }
    /* a programmatic stage() with candidates (the harness door that stays) lands on Review */
    if(!session.uiFlow&&!session.uiSeen&&session.candidates.length){session.uiSeen=true;uiStep=6;}
    if(session.committed)uiStep=7;
    {const sh=m.querySelector('.spShell');if(sh)sh.classList.toggle('spWide',uiStep===6);}   /* [238-E] */
    spStepHead();{const d1=m.querySelector('[data-sp="discard"]');if(d1)d1.style.display='';}
    refreshIssues();const s=summary();let types=[];try{types=Object.keys(TYPE_MAP||{})}catch(_){types=['smoke','thermal']};
    const teach=session.teach||{};
    const typeOptions=types.filter(Boolean).map(t=>`<option value="${escapeHtml(t)}"${teach.type===t?' selected':''}>${escapeHtml(arcTypeLabel(t))}</option>`).join('');
    const busy=!!(session.detectBusy||session.ocrBusy);
    let html='';
    if(uiStep===2){
      const picking=!!(session.templatePick&&session.templatePick.active);
      html=`<div class="spScreen"><h3>Teach one symbol</h3><p>Drag a box around <b>ONE</b> symbol on the plan - a detector, a sounder, whatever you want found. Smart Plan finds every other one that looks like it.</p>${SP_PICTURE}<div class="spField spTypeRow"><label>Type of item</label><select data-sp="dtype">${typeOptions}</select></div><button class="btn spPrimary spBig" data-sp="teach" ${picking||busy?'disabled':''}>${picking?(session.templatePick.mode?'Now drag the area on the plan →':'Now drag the box on the plan →'):(session.teach?'Draw the box again':'Draw the box on the plan')}</button>${(session.teach&&!picking)?`<div class="spDone">${session.boxSnapped?'Box snapped to the symbol - the printed number stays outside it, where the reader looks. ':'Box drawn. '}Drag a corner on the plan to adjust it, draw it again, or press Next.</div>`:''}${picking?(session.templatePick.mode?'<div class="spWarn">Drag a box over the area to '+(session.templatePick.mode==='exclude'?'leave out - the legend, a block diagram, a title block.':'search - everything outside it is ignored.')+'</div>':'<div class="spWarn">Zoom in on the plan first (pinch, scroll, or the + button), then drag from one corner of the symbol to the opposite corner. Keep the box tight.</div>'):''}${session.candidates.length?`<div class="spDone">${s.total} already found: ${spTypeLine()}. Teaching another symbol adds to them.</div>`:''}${spTaughtHtml()}${(session.taught&&session.taught.length&&!picking)?`<button class="btn spBig" data-sp="teach-another" ${busy?'disabled':''}>Teach another symbol</button>`:''}<div class="spField spTypeRow" style="margin-top:10px"><label>Leave out</label><span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-sp="area-ex" ${picking||busy?'disabled':''}>Exclude an area</button><button class="btn" data-sp="area-in" ${picking||busy?'disabled':''}>Search only an area</button>${(spAreas().exclude.length||spAreas().include.length)?`<button class="btn" data-sp="area-clear">Clear areas</button>`:''}</span></div><div class="spCaption" data-sp="areas-note">${spAreasNote()} Drag a box over the legend or a diagram so it is not searched.</div><details data-sp="advanced"><summary>Advanced (usually not needed)</summary><div class="spField"><label>Signal</label><select data-sp="signal"><option value="auto">Auto</option><option value="red">Red ink</option><option value="ink">Dark / colour ink</option></select></div><div class="spField"><label>Sensitivity (0.35–0.95)</label><input data-sp="threshold" type="number" min="0.35" max="0.95" step="0.01" value="${DETECT_DEFAULT_THRESHOLD}"></div><label class="spCheck" style="min-height:36px"><input data-sp="mirrors" type="checkbox"> Also look for mirrored copies</label></details></div>`;
    }else if(uiStep===3){
      const t=session.teach;const done=session.findDone;
      const status=session.detectBusy?(session.detectStatus||'Detecting symbols…'):(session.ocrBusy?(session.ocrStatus||'Reading printed identities…'):'');
      const reader=ocrOk===false?'<div class="spWarn" data-sp="noocr">This app does not include the label reader — the numbers are typed in at Review.</div>':'';
      const btnLabel=ocrOk===false?'Find the rest':'Find the rest and read their numbers';
      html=`<div class="spScreen"><h3>Find and read</h3>${spTaughtHtml()}<p>Smart Plan will find every symbol like the one you taught it${ocrOk===false?'':', then read the number printed next to each'}. This can take a few minutes on a big sheet — Cancel is in the footer.</p>${(ocrOk===false||planSource())?'':'<div class="spWarn" data-sp="nosrc"><b>This plan has no PDF behind it, so numbers will be read at screen resolution</b> — on a big sheet that is roughly half as many read, and it is the single biggest thing you can change here. Replace the plan with the PDF once (Workspace › the plan › Replace) and the reader works at full detail. Imported before V0.197, brought in from a photo, or brought in from a project file all land here.</div>'}${reader}${t?'':'<div class="spWarn">Teach one symbol first (Back).</div>'}<button class="btn spPrimary spBig" data-sp="findread" ${(!t||busy||session.committed)?'disabled':''}>${btnLabel}</button>${status?`<div class="spWarn" data-sp="status">${escapeHtml(status)}</div>`:''}${done?`<div class="spDone" data-sp="found">Found <b>${done.kept}</b> ${done.type?escapeHtml(arcTypeLabel(done.type)):'symbol'}${done.kept===1?'':'s'}${done.read!=null?` · read <b>${done.read}</b> number${done.read===1?'':'s'}`:''}${done.area?` · ${done.area} left out (excluded areas)`:''}.${(()=>{const d=spReadDiag();return d&&d.taught?` ${d.taught}`:'';})()}${spTypeCounts().length>1?` All runs: ${spTypeLine()}.`:''}${done.kept?'':' Try a tighter box, or a different symbol, under Teach one symbol.'}${(()=>{const d=spReadDiag();if(!d||done.read==null)return '';return ` Reader: ${escapeHtml(d.style)}, ${d.looks} looks, ${d.agreed} agreed read${d.agreed===1?'':'s'} on ${d.readCandidates} symbol${d.readCandidates===1?'':'s'}, ${d.applied} applied, ${d.withheld} held for Review${d.unconfirmed?`, ${d.unconfirmed} two-digit read${d.unconfirmed===1?'':'s'} a wider look could not confirm`:''}, ${Math.round(d.ms/1000)} s.<details data-sp="diag"><summary>Diagnostics \u00b7 ${spDiagSize(d.text)} (send this to Claude if the numbers look wrong)</summary><button class="btn spQuiet spBig" data-sp="diagcopy" style="width:100%;margin:6px 0">Copy the diagnostics</button><div class="spCaption" data-sp="diagsaid">One tap. Nothing to select, and it tells you the size so you know the whole lot went.</div><textarea readonly data-sp="diagtext" style="width:100%;min-height:120px;font-size:11px">${escapeHtml(d.text)}</textarea></details>`;})()}</div>`:''}<button class="btn spQuiet" data-sp="another" ${busy?'disabled':''}>Teach a different symbol type</button></div>`;
    }else if(uiStep===4){
      html=`<div class="spScreen"><h3>Panel schedule <span class="spHint">(optional)</span></h3><p>Have the panel's device list? Load it and Smart Plan checks every number against it.</p><button class="btn spPrimary spBig" data-sp="schedule">${session.schedule.length?'Load a different list…':'Load the device list…'}</button><p class="spHint">CSV, TSV, TXT, JSON or XLSX — the same file the Annuals tool takes.</p><div data-sp="recon"></div>${session.schedule.length?'<button class="btn spQuiet" data-sp="reconcile">Check again</button>':''}</div>`;
    }else if(uiStep===5){
      const z=session.zoneSource;
      html=`<div class="spScreen"><h3>Zones <span class="spHint">(optional)</span></h3><p>Are the zones coloured areas on <b>this</b> plan? Smart Plan reads the colour around each symbol and groups them.</p><button class="btn ${session.fillZones?'':'spPrimary'} spBig" data-sp="fillfind">${session.fillZones?'Read the colours again':'Find the zones by colour'}</button>${fillZoneRowsHtml()}${session.zoneStatus?`<div class="spCaption" data-sp="zonestatus">${escapeHtml(session.zoneStatus)}</div>`:''}<h3 style="margin-top:18px">On a separate sheet <span class="spHint">(optional)</span></h3><p>Zones drawn on their own drawing? Load it and Smart Plan carries the zones across onto this plan.</p><button class="btn ${z?'':'spPrimary'} spBig" data-sp="zone-source">${z?'Load a different zone plan…':'Load the zone plan…'}</button>${z?`<div class="spZoneWork"><div class="spHint" style="margin-bottom:6px">1 · Tell Smart Plan what each zone looks like — type the zone number, then either show it a patch of that zone's hatching or draw the zone by hand.</div><div class="spZoneGrid"><input data-sp="zone-no" placeholder="Zone" maxlength="5" inputmode="numeric"><input data-sp="zone-window" type="number" min="5" step="2" placeholder="Window"><input data-sp="zone-threshold" type="number" min="0.001" max="0.2" step="0.001" placeholder="Density: Auto"><button class="btn" data-sp="zone-sample">Show a patch of hatching</button><button class="btn" data-sp="zone-poly">Draw the zone by hand</button><button class="btn" data-sp="zone-finish">Finish the drawn zone</button><button class="btn" data-sp="zone-detect">Find the coloured zones</button></div><div class="spHint" style="margin:10px 0 6px">2 · Match three points that appear on BOTH plans (a corner, a door, a column) so the zones land in the right place.</div><div class="spActions"><button class="btn" data-sp="zone-pair">Match a point on both plans</button><button class="btn" data-sp="zone-undo-pair">Undo last match</button></div><div class="spHint" style="margin:10px 0 6px">3 · Bring the kept zones across. They arrive at Review.</div><button class="btn spPrimary spBig" data-sp="zone-transfer">Bring the zones across</button><div data-sp="zone-work-status"></div><div data-sp="zone-regions"></div></div>`:''}<div data-sp="zones"></div></div>`;
    }else if(uiStep===6){
      html=`<div class="spScreen"><h3>Review</h3><p>Every row is a symbol Smart Plan found. Fix a number, change a type, or reject a row. Rows with a flag need a look.</p><div class="spStats"><div class="spStat"><strong>${s.total}</strong><span>found</span></div><div class="spStat"><strong>${s.accepted}</strong><span>accepted</span></div><div class="spStat"><strong>${s.review}</strong><span>to check</span></div><div class="spStat"><strong>${s.rejected}</strong><span>rejected</span></div><div class="spStat"><strong>${s.numbered}</strong><span>numbered</span></div></div><div class="spCaption" data-sp="bytype">${spTypeLine()||'Nothing found yet.'}</div><div class="spActions">${(()=>{const n=session.candidates.filter(c=>c.decision==='review'&&!c.issues.length).length,left=session.candidates.filter(c=>c.decision==='review').length,kept=session.candidates.filter(c=>c.decision!=='rejected').length,done=kept>0&&!left;return `<button class="btn${done?' spBtnDone':''}" data-sp="safe" ${n?'':'disabled'}>${done?`\u2713 All ${kept} accepted`:n?`Accept the ${n} without issues`:'Nothing to accept yet'}</button>${n||done?'':'<span class="spHint" data-sp="safe-why">Every row still has an issue - most need a number. Read them, or tap a row and type it.</span>'}`;})()}${(()=>{const m=session.candidates.filter(c=>c.decision==='review').length;return `<button class="btn" data-sp="acceptall" ${m?'':'disabled'} title="Every row still at Review, flagged or not">Accept all ${m}</button>`;})()}${(()=>{const fl=spFlaggedLeft(),done=!fl&&session.candidates.length>0;if(!fl)session.rowsFilter='all';const on=session.rowsFilter==='flagged';return `<button class="btn${on?' spBtnOn':done?' spBtnDone':''}" data-sp="review" ${fl?'':'disabled'}>${done?'\u2713 No flags left':`Show flagged only${fl?` (${fl})`:''}`}</button><button class="btn${on?'':' spBtnOn'}" data-sp="all">Show all ${session.candidates.length}</button>`;})()}${ocrOk===false?'':'<button class="btn" data-sp="ocr">Read printed numbers</button>'}</div><div class="spChips" data-sp="chips">${spChipsHtml()}</div><div data-sp="zones"></div><p class="spHint" data-sp="legend">Issues: a tick means nothing to fix; a number is how many things to check - they are listed under the row. Tap the button at the left of a row to see that symbol on the plan. The \u00d7 in a field takes that label off the row and keeps it off - a later find or read never puts it back; type a value to put one back.</p><div class="spColHead"><span>Issues</span><span>Type</span><span>Zone</span><span>Loop</span><span>Device</span><span class="spDecHead"><button type="button" class="spMini" data-sp="dec-all-accept" title="Accept every row listed below">Accept all</button><button type="button" class="spMini" data-sp="dec-all-reject" title="Reject every row listed below">Reject all</button></span></div><div data-sp="rows"></div></div>`;   /* [238-E] the column head decides for every row listed */   /* [235-A] the legend says what the x does - a title tooltip never shows on an iPad */
    }else{
      const blockers=session.candidates.filter(c=>c.decision==='accepted'&&c.issues.some(x=>x.level==='error')).length;
      html=`<div class="spScreen"><h3>Commit</h3>${session.committed?`<div class="spDone">Committed. ${s.total} candidate(s) were reviewed. The devices are on the plan - Close Smart Plan, or start another plan.</div>`:`<p><b>${s.accepted}</b> symbol${s.accepted===1?'':'s'}${s.zoneAccepted?` and <b>${s.zoneAccepted}</b> zone${s.zoneAccepted===1?'':'s'}`:''} will be added to the plan.${s.review?` <b>${s.review}</b> still at Review will be left out.`:''}${s.rejected?` ${s.rejected} rejected.`:''}</p>${blockers?`<div class="spWarn">${blockers} accepted row${blockers===1?' has':'s have'} a blocking issue — go Back to Review and fix or reject ${blockers===1?'it':'them'}.</div>`:''}${s.zoneReview?`<div class="spWarn">${s.zoneReview} zone${s.zoneReview===1?' is':'s are'} still at Review — accept or reject ${s.zoneReview===1?'it':'them'} on the Zones step.</div>`:''}<p>Nothing has been written yet. Commit adds them in one step — one Undo takes the lot back out.</p><button class="btn spPrimary spBig" data-sp="commitbig">Commit to Workspace</button>`}</div>`;
    }
    left.innerHTML=html;
    /* ---- wiring, by step ---- */
    const q=sel=>left.querySelector(sel);
    if(uiStep===2){
      const dt=q('[data-sp="dtype"]');const pickType=session.templatePick&&session.templatePick.type;if(dt&&(pickType||teach.type))dt.value=pickType||teach.type;  /* [213-B] the pick's own type wins over the last taught one */
      if(dt)dt.onchange=()=>{if(session&&session.templatePick)session.templatePick.type=dt.value;if(session&&session.teach)session.teach.type=dt.value;};
      {const ta=q('[data-sp="teach-another"]');if(ta)ta.onclick=()=>{session.teach=null;session.boxSnapped=false;session.taughtBox=null;render();const b=left.querySelector('[data-sp="teach"]');if(b&&!b.disabled)b.click();};}   /* [239-B] a fresh box for the next symbol; what was found stays */
      q('[data-sp="teach"]').onclick=()=>{const type=dt.value,signal=(q('[data-sp="signal"]')||{}).value||'auto',threshold=Number((q('[data-sp="threshold"]')||{}).value)||DETECT_DEFAULT_THRESHOLD,includeMirrors=!!(q('[data-sp="mirrors"]')||{}).checked;session.templatePick={active:true,type,signal,threshold,includeMirrors,start:null,end:null};render();try{if(window.innerWidth<=820){const rp=m.querySelector('[data-sp="right"]');if(rp&&rp.scrollIntoView)rp.scrollIntoView({behavior:'smooth',block:'start'});}}catch(_){}};
      const sg=q('[data-sp="signal"]');if(sg&&teach.signal)sg.value=teach.signal;const th=q('[data-sp="threshold"]');if(th&&teach.threshold)th.value=teach.threshold;const mr=q('[data-sp="mirrors"]');if(mr)mr.checked=!!teach.includeMirrors;
            const areaPick=mode=>{session.templatePick={active:true,mode,type:dt?dt.value:'',signal:'auto',threshold:DETECT_DEFAULT_THRESHOLD,includeMirrors:false,start:null,end:null};render();};
      const ax=q('[data-sp="area-ex"]');if(ax)ax.onclick=()=>areaPick('exclude');const ai=q('[data-sp="area-in"]');if(ai)ai.onclick=()=>areaPick('include');const ac=q('[data-sp="area-clear"]');if(ac)ac.onclick=()=>{session.areas={exclude:[],include:[]};render();};
      spNav(left,{next:session.teach?'Next: Find and read':(session.candidates.length?'Skip to Review':'Next: Find and read'),nextDisabled:!session.teach&&!session.candidates.length,nextPrimary:!!session.teach,nextTo:(!session.teach&&session.candidates.length)?6:null});
    }else if(uiStep===3){
      q('[data-sp="findread"]').onclick=async()=>{
        const t=session.teach;if(!t)return;session.uiFlow=true;session.findDone=null;
        try{
          const r=await detectTemplate({type:t.type,signal:t.signal,threshold:t.threshold,includeMirrors:t.includeMirrors,bbox:t.bbox});
          if(!session||r===null)return;                       /* cancelled: nothing was added */
          const kept=r&&r.summary?r.summary.kept:0,area=r&&r.summary?(r.summary.skippedByArea||0):0;let read=null,ms=r&&r.summary?(r.summary.elapsedMs||0):0;
          if(ocrOk!==false&&session.candidates.some(c=>c.decision!=='rejected')){
            const o=await recognisePrintedIdentities();
            if(!session)return;
            if(o===null){session.findDone={kept,read:null,area,type:t.type,ms};spRunLog(session.findDone);render();return;}
            /* [219-C] `applied` is SESSION-wide - the reader re-reads every candidate on
               every run - while `kept` is this run's. V0.197 printed them side by side:
               "Found 81 Thermal Detectors - read 117 numbers", more numbers than
               detectors. Count the numbers THIS run's detections are carrying. */
            const rid=r&&r.summary?r.summary.runId:null;
            read=rid?session.candidates.filter(c=>c.decision!=='rejected'&&c.meta&&c.meta.detectorRun===rid&&c.meta.devSource==='ocr').length
                    :(o&&o.summary?(o.summary.applied||0):0);
            ms+=o&&o.summary?(o.summary.elapsedMs||0):0;
          }
          if(session){session.findDone={kept,read,area,type:t.type,ms};spRunLog(session.findDone);render();}
        }catch(e){if(session){session.detectBusy=false;session.ocrBusy=false;session.detectStatus='';session.ocrStatus='';render();}alert(e.message||String(e));}
      };
      /* [223-A] ONE TAP. Select-All inside a readonly textarea on iPadOS is a
         long-press, a loupe, a menu and a scroll to the bottom to check you got the
         end - for a payload that is meant for me and not for him. The async clipboard
         API needs a user gesture and this is one; select()+execCommand is the fallback
         for older Safari, and it needs the textarea VISIBLE, which inside an open
         <details> it is. Either way the button says what happened, with the size, so a
         short paste is obvious to both of us. */
      const dc=q('[data-sp="diagcopy"]');
      if(dc)dc.onclick=()=>{
        const ta=q('[data-sp="diagtext"]'),said=q('[data-sp="diagsaid"]');
        const txt=ta?ta.value:'';
        const done=ok=>{ if(!said)return;
          said.textContent=ok?('Copied \u2713 \u00b7 '+spDiagSize(txt)+' \u00b7 paste it to Claude')
                             :('Could not reach the clipboard \u2014 tap inside the box below, Select All, Copy (' + spDiagSize(txt) + ')');
          if(dc)dc.textContent=ok?'Copy again':'Copy the diagnostics'; };
        if(!txt){done(false);return;}
        try{
          if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(txt).then(()=>done(true)).catch(()=>{
              try{ta.focus();ta.setSelectionRange(0,txt.length);done(!!document.execCommand('copy'));}catch(_){done(false);}});
            return;
          }
          ta.focus();ta.setSelectionRange(0,txt.length);done(!!document.execCommand('copy'));
        }catch(_){done(false);}
      };
      q('[data-sp="another"]').onclick=()=>spGo(2);
      spNav(left,{next:session.findDone?'Next: Panel schedule':'Skip to Review',nextPrimary:!!session.findDone,nextDisabled:busy});
      if(!session.findDone){const nx=left.querySelector('[data-sp="next"]');if(nx)nx.onclick=()=>spGo(6);}
    }else if(uiStep===4){
      q('[data-sp="schedule"]').onclick=()=>m.querySelector(`#${SCHEDULE_FILE_ID}`).click();
      const rc=q('[data-sp="reconcile"]');if(rc)rc.onclick=()=>{try{reconcileSchedule(true);render();}catch(e){alert(e.message||String(e));}};
      renderReconciliation();
      spNav(left,{next:session.schedule.length?'Next: Zones':'Skip',nextPrimary:!!session.schedule.length});
    }else if(uiStep===5){
      q('[data-sp="fillfind"]').onclick=()=>{zoneLog('press-find');try{sampleFillZones();readZoneNames().catch(()=>{});}catch(e){zoneLog('press-find-failed',{error:(e&&e.message)||String(e)});alert(e.message||String(e));}};   /* [225-A] [229-1] */
      Array.prototype.forEach.call(left.querySelectorAll('[data-sp="fillzone"]'),el=>{
        el.onchange=()=>{try{el.value=setFillZone(el.getAttribute('data-gid'),el.value);}catch(e){alert(e.message||String(e));}};});
      const fa=q('[data-sp="fillapply"]');if(fa)fa.onclick=()=>{zoneLog('press-apply');try{applyFillZones();}catch(e){zoneLog('press-apply-failed',{error:(e&&e.message)||String(e)});alert(e.message||String(e));}};   /* [229-1] */
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
      spNav(left,{next:(session.zoneSource||session.fillZones)?'Next: Review':'Skip',nextPrimary:!!(session.zoneSource||session.fillZones)});
    }else if(uiStep===6){
      q('[data-sp="safe"]').onclick=()=>{session.candidates.forEach(c=>{if(!c.issues.length)c.decision='accepted'});render();};const qa=q('[data-sp="acceptall"]');if(qa)qa.onclick=()=>{session.candidates.forEach(c=>{if(c.decision!=='rejected')c.decision='accepted'});render();};q('[data-sp="review"]').onclick=()=>{session.rowsFilter='flagged';render();};q('[data-sp="all"]').onclick=()=>{session.rowsFilter='all';render();};   /* [233-D] the choice survives every render */
      left.querySelectorAll('[data-chip]').forEach(b=>{b.onclick=()=>{if(b.dataset.chip==='type')session.rowsType=b.dataset.v;else session.rowsZone=b.dataset.v;render();};});   /* [238-D] */
      {const da=q('[data-sp="dec-all-accept"]'),dr=q('[data-sp="dec-all-reject"]');if(da)da.onclick=()=>{spListRows(session.rowsFilter==='flagged').forEach(c=>c.decision='accepted');refreshIssues();render();};if(dr)dr.onclick=()=>{spListRows(session.rowsFilter==='flagged').forEach(c=>c.decision='rejected');refreshIssues();render();};}   /* [238-E] every row listed - the filters decide which */
      const ob=q('[data-sp="ocr"]');
      if(ob){ob.onclick=async()=>{try{await recognisePrintedIdentities();}catch(e){if(session){session.ocrBusy=false;session.ocrStatus='';render();}alert(e.message||String(e));}};ob.disabled=session.ocrBusy||session.detectBusy||session.committed||!session.candidates.length;
        /* PASS 205 [205-D] - same probe as Arc's own scan button: no ./ocr/, no OCR. EverDue never ships it. */
        if(typeof fsOcrProbe==='function'){fsOcrProbe().then(ok=>{if(!ok){const b2=left.querySelector('[data-sp="ocr"]');if(b2){b2.disabled=true;b2.title='This app does not include the label reader';}}}).catch(()=>{});}}
      renderZones();renderRows(session.rowsFilter==='flagged');   /* [233-D] */
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
    const ocr=s.ocr?` • OCR ${s.ocr.applied||0}/${s.total} applied, +${(s.ocr.offsetRecovered||0)+(s.ocr.quadrantRecovered||0)} retry, cap ${s.ocr.capPx||60}px${s.ocr.learned?`, ${s.ocr.learned.reads} by the sheet's own digits (library ${s.ocr.learned.library})`:''}`:'';   /* [236-A] */const det=s.detection?` • detect ${s.detection.kept||0} kept / ${s.detection.stubFlags||0} stub flags / ${(s.detection.workPixels/1e6).toFixed(1)} MP`:'';const zf=s.zoneSource&&s.zoneSource.rmse!=null?` • zone fit ${Number(s.zoneSource.rmse).toFixed(1)}px`:'';
    /* [206-B] the footer says it in plain words; the numbers a developer wants are the tooltip */
    foot.title=`zones ${s.zoneAccepted}/${s.zones} accepted${s.zoneReview?` (${s.zoneReview} review)`:''} • ${s.errors} blocking issue(s) • ${s.warnings} review flag(s)${det}${ocr}${zf}${rec}`;
    foot.textContent=session.committed?`Committed. ${s.total} candidate(s) were reviewed.`:(session.detectBusy?(session.detectStatus||'Detecting symbols…'):(session.ocrBusy?(session.ocrStatus||'Reading printed identities…'):`Candidates stay temporary until Commit. ${s.total} found${spTypeCounts().length>1?` (${spTypeLine()})`:''} · ${s.accepted} accepted · ${s.review} to check${s.rejected?` · ${s.rejected} rejected`:''}${s.zones?` · ${s.zoneAccepted}/${s.zones} zones`:''}${s.errors?` · ${s.errors} blocking`:''}`));
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

  function spFlaggedLeft(){return session?session.candidates.filter(c=>c.decision==='review'&&c.issues.length).length:0;}   /* [234-A] a flagged row he has accepted or rejected is dealt with */
  function renderRows(reviewOnly) {
    if(!session)return; const m=ensureModal(),box=m.querySelector('[data-sp="rows"]'); if(!box)return;
    box.innerHTML=''; const list=spListRows(reviewOnly);   /* [233-D] flagged means a flag; [234-A] still at Review; [233-E] zone, then device; [238-D] then the chips */
    const chipped=!!(session.rowsType||(session.rowsZone!=null&&session.rowsZone!==''));
    if(list.length){const o=document.createElement('div');o.className='spOrder';o.textContent=(reviewOnly?`${list.length} flagged row${list.length===1?'':'s'} left to check - `:'')+(chipped?`${list.length} of ${session.candidates.length} shown - `:'')+'In zone, then device order; rows without a number last in their zone.';box.appendChild(o);}
    list.forEach(c=>{
      const row=document.createElement('div'); row.className='spRow';
      const cls=c.issues.some(x=>x.level==='error')?'bad':c.issues.length?'rev':'ok';
      row.innerHTML=`<button type="button" class="spGo" title="See this symbol on the plan" aria-label="See this symbol on the plan"><span class="spBadge ${cls}" title="${escapeHtml(c.id)}">${c.issues.length||'✓'}</span><span class="spGoIco">\u25ce</span></button>
        <select data-k="type"></select>${['zone','loop','dev'].map(k=>`<span class="spCell"><input data-k="${k}" maxlength="5" placeholder="${k==='dev'?'Device':k[0].toUpperCase()+k.slice(1)}"><button type="button" class="spClr" data-clr="${k}" title="Take the ${k==='dev'?'device number':k} off this row" aria-label="Take the ${k==='dev'?'device number':k} off">\u00d7</button></span>`).join('')}<span class="spDec"><button type="button" class="spDecBtn${c.decision==='accepted'?' spDecOn':''}" data-dec="accepted" aria-pressed="${c.decision==='accepted'}">Accept</button><button type="button" class="spDecBtn${c.decision==='rejected'?' spDecOnNo':''}" data-dec="rejected" aria-pressed="${c.decision==='rejected'}">Reject</button></span><div class="spIssue"></div>`;   /* [238-E] two buttons, no dropdown (W237-6); tapping the one that is on puts the row back to Review */
      const typeSel=row.querySelector('[data-k="type"]');
      let types=[]; try{types=Object.keys(TYPE_MAP||{})}catch(_){types=[c.obj.type]}
      if(!types.includes(c.obj.type))types.unshift(c.obj.type);
      typeSel.innerHTML=types.filter(Boolean).map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(arcTypeLabel(t))}</option>`).join(''); typeSel.value=c.obj.type;
      ['zone','loop','dev'].forEach(k=>{row.querySelector(`[data-k="${k}"]`).value=field(c.obj[k]);const b=row.querySelector(`[data-clr="${k}"]`);if(b)b.hidden=!field(c.obj[k]);});   /* [232-A] the x shows only where there is something to take off */
      row.querySelectorAll('[data-dec]').forEach(b=>{b.onclick=e=>{e.stopPropagation();const d=b.dataset.dec;c.decision=c.decision===d?'review':d;refreshIssues();render();};});   /* [238-E] */
      {const go=row.querySelector('.spGo');if(go)go.onclick=e=>{e.stopPropagation();session.focusId=c.id;box.querySelectorAll('.spRowFocus').forEach(r=>r.classList.remove('spRowFocus'));row.classList.add('spRowFocus');if(spCenterMain)spCenterMain(Number(c.obj.x),Number(c.obj.y));};}   /* [238-E] the handle */
      row.querySelectorAll('[data-clr]').forEach(b=>{b.onclick=e=>{e.stopPropagation();const k=b.dataset.clr;c.obj[k]='';if(!c.meta)c.meta={};c.meta[`${k}Source`]='user';c.meta[`${k}Cleared`]=true;refreshIssues();render();};});   /* [232-A] one tap takes the label off - and it stays off (232-B) */
      row.querySelector('.spIssue').textContent=c.issues.map(x=>x.text).join(' · ');
      if(session.focusId===c.id)row.classList.add('spRowFocus');
      row.onclick=e=>{const tag=e.target&&e.target.tagName;if(/^(INPUT|SELECT|OPTION|BUTTON)$/.test(tag||''))return;session.focusId=c.id;box.querySelectorAll('.spRowFocus').forEach(r=>r.classList.remove('spRowFocus'));row.classList.add('spRowFocus');if(spCenterMain)spCenterMain(Number(c.obj.x),Number(c.obj.y));};
      row.onchange=e=>{const k=e.target&&e.target.dataset&&e.target.dataset.k;if(!k)return;if(k==='decision')c.decision=e.target.value;else{c.obj[k]=field(e.target.value);if(c.meta){c.meta[`${k}Source`]='user';c.meta[`${k}Cleared`]=!field(e.target.value);}}refreshIssues();render();};   /* [232-A] emptied by hand counts as taken off too */
      box.appendChild(row);
    });
    if(!list.length)box.innerHTML=reviewOnly?'<div class="spHint" style="padding:12px">No flagged row is left to check.</div>':(chipped?'<div class="spHint" style="padding:12px">No row matches the filter.</div>':'<div class="spHint" style="padding:12px">Nothing requires review.</div>');
  }
  /* [238-D] the rows listed: flagged-only first, then the type and zone chips; '-' as the zone chip means rows without a zone */
  function spListRows(reviewOnly){
    const t=session.rowsType||'',z=session.rowsZone==null?'':session.rowsZone;
    return spOrderRows(session.candidates.filter(c=>!reviewOnly||(c.issues.length&&c.decision==='review')).filter(c=>{if(t&&field(c.obj.type)!==t)return false;if(z==='-')return !field(c.obj.zone);if(z)return field(c.obj.zone)===z;return true;}));
  }
  function spChipsHtml(){
    if(!session)return '';const tm=new Map(),zc=new Map();session.candidates.forEach(c=>{const k=field(c.obj.type)||'?';tm.set(k,(tm.get(k)||0)+1);const zz=field(c.obj.zone);zc.set(zz,(zc.get(zz)||0)+1);});const tc=Array.from(tm,([type,n])=>({type,label:arcTypeLabel(type),n}));   /* every row, rejected too - a filter must not vanish under a decision */
    const zs=Array.from(zc.keys()).sort((a,b)=>{if(a==='')return 1;if(b==='')return -1;const na=Number(a),nb=Number(b);if(Number.isFinite(na)&&Number.isFinite(nb))return na-nb;return a.localeCompare(b);});
    const t=session.rowsType||'',z=session.rowsZone==null?'':session.rowsZone;
    const chip=(k,v,lab,n,on)=>`<button type="button" class="spChip${on?' spChipOn':''}" data-chip="${k}" data-v="${escapeHtml(v)}" aria-pressed="${on}">${escapeHtml(lab)}${n==null?'':` <b>${n}</b>`}</button>`;
    let h='';
    if(tc.length>1||t)h+=`<div class="spChipRow" data-sp="chips-type"><span class="spChipLab">Type</span>${chip('type','','All',null,!t)}${tc.map(x=>chip('type',x.type,x.label,x.n,t===x.type)).join('')}</div>`;
    if(zs.length>1||z)h+=`<div class="spChipRow" data-sp="chips-zone"><span class="spChipLab">Zone</span>${chip('zone','','All',null,!z)}${zs.map(zz=>chip('zone',zz===''?'-':zz,zz===''?'No zone':`Zone ${zz}`,zc.get(zz),z===(zz===''?'-':zz))).join('')}</div>`;
    return h;
  }
  function spOrderRows(list){
    /* [233-E] zone, then device number - numerically, so 2 comes before 10; no number last in its zone; no zone last of all; then by position */
    const key=(v)=>{const s=field(v);if(!s)return [1,0,''];const m=s.match(/^\s*([A-Za-z]*)\s*0*(\d+)\s*([A-Za-z]*)\s*$/);return m?[0,Number(m[2]),m[1].toUpperCase()+m[3].toUpperCase()]:[0,Number.MAX_SAFE_INTEGER,s.toUpperCase()];};
    const cmp=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]<b[i])return -1;if(a[i]>b[i])return 1;}return 0;};
    return list.slice().sort((a,b)=>cmp(key(a.obj.zone),key(b.obj.zone))||cmp(key(a.obj.dev),key(b.obj.dev))||(Number(a.obj.y)-Number(b.obj.y))||(Number(a.obj.x)-Number(b.obj.x)));
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
  const MODULE_VERSION = "V0.222 beta";
  const api={version:VERSION,build:MODULE_VERSION,open,start,stage,cancel:cancelActiveOperation,summary,reconciliation,importScheduleRows,importScheduleFile,importZoneSourceFile,sampleFillZones,setFillZone,applyFillZones,readZoneNames,teachZoneHatch,detectZoneSourceRegions,addManualZoneRegion,addZoneAlignmentPair,transferZoneRegions,detectTemplate,recognisePrintedIdentities,commit,discard,maxCanvasPx,_normalisePayload:normalisePayload,_dedupeLabels:dedupeLabels,_assignLabels:assignLabels,_fitZoneAlignment:fitZoneAlignment,_estimatePolyOverlap:estimatePolyOverlap,_clipPolygonRect:clipPolygonRect,_sourceRegionOverlapWarnings:sourceRegionOverlapWarnings,tightenTemplateBox,_cropStripCanvas:cropStripCanvas,_taughtBox:()=>session&&session.taughtBox?session.taughtBox.slice():null,_hires:()=>hires?{k:hires.k,tiles:hires.tiles.size,rendered:hires.rendered}:null,_fixSevens:(cv,t)=>hiresFixSevens(cv,String(t)),   /* [219-A] */_fillZones:()=>session&&session.fillZones?clone(session.fillZones):null,_zoneLabelsFromWords:zoneLabelsFromWords,_zoneLeaderAnchor:zoneLeaderAnchor,_zoneMasks:zoneMasks,_zoneCleanCanvas:zoneCleanCanvas,_zoneLabelWords:zoneLabelWords,_zoneDigitRead:async(w)=>{const live=livePlanImage(),iw=live.naturalWidth||live.width,ih=live.naturalHeight||live.height,cv=document.createElement('canvas');cv.width=iw;cv.height=ih;const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(live,0,0,iw,ih);const id=ctx.getImageData(0,0,iw,ih);return zoneDigitRead(await ensureOcrWorker(),zoneCleanCanvas(id,zoneMasks(id.data,iw,ih)),w);},   /* [225-A] */_clusterHues:(hs)=>clusterHues((hs||[]).map((h,i)=>({id:'u'+i,h:Number(h),s:1,v:1}))).map(g=>g.map(x=>x.h)),   /* [220-A] */_planSource:()=>!!planSource(),_zoneLog:()=>session&&session.zoneLog?clone(session.zoneLog):[],   /* [229-1] */_vectorSquares:vectorSquares,_vectorLast:()=>session&&session.vectorLast?clone(session.vectorLast):null,_vectorShapeLast:()=>session&&session.vectorShapeLast?clone(session.vectorShapeLast):null,_vecShapeFor:(box)=>session&&session.vector&&session.vector.shapes?vecShapeFor(box,session.vector.shapes):null,_readDiag:()=>{const d=spReadDiag();return d?d.text:'';},_orderRows:(l)=>spOrderRows(l),_rowsFilter:()=>session?session.rowsFilter||'all':null,_flaggedLeft:spFlaggedLeft,   /* [234-A] */_vecSameInside:vecSameInside,   /* [233] */_vecLabelScale:vecLabelScale,   /* [234-B] */_lrnWordsFor:(x,y,side,frac)=>{const live=livePlanImage();if(!live)return null;const G=lrnGrey(live);if(frac!=null)G.dark=Math.round(G.ink+frac*(G.paper-G.ink));return lrnWordsFor(G,x,y,side).map(w=>({d:w.d,loose:w.loose,g:w.g.map(g=>[g.x0,g.y0,g.x1-g.x0,g.y1-g.y0])}));},   /* [236-A] */_vecShownSide:(box)=>session&&session.vector&&session.vector.squares?vectorSideFor(session.vector.squares,{original:box}):null,   /* [230-A] */_vecLabelsFor:(x,y,s)=>session&&session.vector&&session.vector.pieces?vecLabelsFor(x,y,s,session.vector.pieces):null,   /* [228-A] */   /* [226-A] */_stripReads:()=>session?session.candidates.map(c=>({id:c.id,type:c.obj.type,x:c.obj.x,y:c.obj.y,dev:c.obj.dev,zone:c.obj.zone,zoneSource:c.meta.zoneSource,   /* [220-A] */reads:c.meta.stripReads||null,conflict:c.meta.stripConflict||null,interiorNcc:c.meta.interiorNcc,interiorInk:c.meta.interiorInk,shape:!!c.meta.vectorShape,partial:!!c.meta.vectorPartial,noNumber:!!c.meta.noNumber,scale:c.meta.vectorScale==null?1:c.meta.vectorScale,cleared:['zone','loop','dev'].filter(k=>c.meta[`${k}Cleared`]),sources:{zone:c.meta.zoneSource||'',loop:c.meta.loopSource||'',dev:c.meta.devSource||''},how:c.meta.devHow||'',   /* [236-A] */issues:(c.issues||[]).map(x=>x.code)})):null};   /* [230-A] */
  Object.freeze(api); Object.defineProperty(window,'ArcSmartPlan',{value:api,configurable:true});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{installButton();ensureModal();},{once:true});else{installButton();ensureModal();}
})();
