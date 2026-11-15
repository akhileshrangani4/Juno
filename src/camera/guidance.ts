// Framing guidance from the on-device measurements (modules/juno-camera). Pure, so every rule is unit tested.
//
// Coordinates: boxes are fractions of the camera's true, un-mirrored image, origin top left. With the back camera
// the user looks through the phone, so the image's right is their right. The front camera faces them, so the
// image's right is their left (the preview mirrors it like a mirror). Directions are always where to move the
// phone: towards the side the subject is on, as the user feels it.

export type Box = { x: number; y: number; width: number; height: number };

export type Analysis = { faces: Box[]; salient: Box | null; sharpness: number; brightness: number; motion: number; signature: number[]; at: number };

export type Facing = 'back' | 'front';

export type CueKind = 'left' | 'right' | 'up' | 'down' | 'closer' | 'farther' | 'steady' | 'ready' | 'noSubject' | 'dark';

// key: worth speaking during a voice call, where speech is slower and the haptic ticks carry the fine guidance.
export type Cue = { kind: CueKind; text: string; key: boolean };

export const GUIDANCE = {
  // Inside this distance from the center (a fraction of the frame) the subject counts as centered; it stops
  // counting only past leaveTolerance, so a subject on the line doesn't flip between cues.
  centerTolerance: 0.1,
  leaveTolerance: 0.15,
  // A face is too small below this share of the frame's height, too big above the larger one.
  faceMin: 0.18,
  faceMax: 0.6,
  objectMinArea: 0.04,
  objectMaxArea: 0.8,
  // Variance of the Laplacian below which a frame is blurred, and frame-to-frame change above which the phone is
  // moving. Measured on the bundled test frames; tune on a physical phone.
  sharpnessMin: 40,
  motionMax: 0.04,
  darkBrightness: 0.12,
  // Centered, the right size and steady for this long before "take the picture now".
  readyHoldMs: 800,
  // No subject for this long before saying so.
  noSubjectMs: 1500,
  // A new cue must hold this long, so a single noisy frame never speaks.
  settleMs: 300,
  // At most one cue every gapMs, and the same cue again only after repeatMs: silence means keep going.
  gapMs: 1500,
  repeatMs: 4000,
};

export type Subject = { kind: 'face' | 'object'; box: Box };

export type Assessment = {
  subject: Subject | null;
  // Where the subject is from the center, as the user feels it: dx > 0 is to their right, dy > 0 is below.
  dx: number;
  dy: number;
  distance: number | null;
  centered: boolean;
  size: 'small' | 'large' | 'ok';
  steady: boolean;
  dark: boolean;
};

export type GuidanceState = {
  centered: boolean;
  candidate: CueKind | null;
  candidateSince: number;
  readySince: number | null;
  readyAnnounced: boolean;
  noSubjectSince: number | null;
  noSubjectAnnounced: boolean;
  lastSpokenAt: number;
  spokenAt: Partial<Record<CueKind, number>>;
};

export const initialGuidance = (): GuidanceState => ({
  centered: false,
  candidate: null,
  candidateSince: 0,
  readySince: null,
  readyAnnounced: false,
  noSubjectSince: null,
  noSubjectAnnounced: false,
  lastSpokenAt: -Infinity,
  spokenAt: {},
});

const area = (box: Box) => box.width * box.height;

export function pickSubject(analysis: Analysis): Subject | null {
  const face = [...analysis.faces].sort((a, b) => area(b) - area(a))[0];
  if (face) return { kind: 'face', box: face };
  return analysis.salient ? { kind: 'object', box: analysis.salient } : null;
}

export function assess(analysis: Analysis, facing: Facing, wasCentered: boolean): Assessment {
  const subject = pickSubject(analysis);
  const steady = analysis.motion <= GUIDANCE.motionMax && analysis.sharpness >= GUIDANCE.sharpnessMin;
  const dark = analysis.brightness < GUIDANCE.darkBrightness;
  if (!subject) return { subject, dx: 0, dy: 0, distance: null, centered: false, size: 'ok', steady, dark };
  const { box } = subject;
  const imageDx = box.x + box.width / 2 - 0.5;
  const dx = facing === 'back' ? imageDx : -imageDx;
  const dy = box.y + box.height / 2 - 0.5;
  const tolerance = wasCentered ? GUIDANCE.leaveTolerance : GUIDANCE.centerTolerance;
  const centered = Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance;
  const size =
    subject.kind === 'face'
      ? box.height < GUIDANCE.faceMin
        ? 'small'
        : box.height > GUIDANCE.faceMax
          ? 'large'
          : 'ok'
      : area(box) < GUIDANCE.objectMinArea
        ? 'small'
        : area(box) > GUIDANCE.objectMaxArea
          ? 'large'
          : 'ok';
  return { subject, dx, dy, distance: Math.hypot(dx, dy), centered, size, steady, dark };
}

const TEXT: Record<Exclude<CueKind, 'up' | 'down' | 'ready'>, string> = {
  left: 'Move left.',
  right: 'Move right.',
  closer: 'Move closer.',
  farther: 'Move farther away.',
  steady: 'Hold steady.',
  noSubject: "I can't find anything to frame. Move the phone slowly.",
  dark: "It's very dark. Find more light.",
};

export function cueText(kind: CueKind, facing: Facing, subject: Subject['kind'] | null): string {
  switch (kind) {
    case 'up':
      return facing === 'back' ? 'Tilt up.' : 'Move up.';
    case 'down':
      return facing === 'back' ? 'Tilt down.' : 'Move down.';
    case 'ready':
      return subject === 'face' ? 'The face is centered. Take the picture now.' : "It's centered. Take the picture now.";
    default:
      return TEXT[kind];
  }
}

const KEY = new Set<CueKind>(['ready', 'noSubject', 'dark', 'closer', 'farther']);

// What the user should hear about this frame if nothing stopped it, ignoring timing.
function candidateFor(a: Assessment, state: GuidanceState, now: number): CueKind | null {
  if (a.dark) return 'dark';
  if (!a.subject) return state.noSubjectSince !== null && now - state.noSubjectSince >= GUIDANCE.noSubjectMs ? 'noSubject' : null;
  if (!a.centered) return Math.abs(a.dx) >= Math.abs(a.dy) ? (a.dx > 0 ? 'right' : 'left') : a.dy < 0 ? 'up' : 'down';
  if (a.size === 'small') return 'closer';
  if (a.size === 'large') return 'farther';
  if (!a.steady) return 'steady';
  return state.readySince !== null && now - state.readySince >= GUIDANCE.readyHoldMs ? 'ready' : null;
}

// One frame in, at most one cue out. busy: something is being spoken, so nothing new starts. keyOnly: during a
// voice call only the key cues are spoken; the others are left to the haptic ticks and don't use up the timing.
export function guide(
  previous: GuidanceState,
  analysis: Analysis,
  { facing, now, busy, keyOnly }: { facing: Facing; now: number; busy: boolean; keyOnly: boolean },
): { state: GuidanceState; cue: Cue | null; assessment: Assessment } {
  const assessment = assess(analysis, facing, previous.centered);
  const ready = assessment.subject !== null && assessment.centered && assessment.size === 'ok' && assessment.steady && !assessment.dark;
  const state: GuidanceState = {
    ...previous,
    centered: assessment.centered,
    readySince: ready ? (previous.readySince ?? now) : null,
    readyAnnounced: ready && previous.readyAnnounced,
    noSubjectSince: assessment.subject ? null : (previous.noSubjectSince ?? now),
    noSubjectAnnounced: !assessment.subject && previous.noSubjectAnnounced,
  };
  const kind = candidateFor(assessment, state, now);
  if (kind !== previous.candidate) {
    state.candidate = kind;
    state.candidateSince = now;
  }
  const silent = { state, cue: null, assessment };
  if (!kind || busy) return silent;
  if (keyOnly && !KEY.has(kind)) return silent;
  if (kind !== 'ready' && kind !== 'noSubject' && now - state.candidateSince < GUIDANCE.settleMs) return silent;
  if ((kind === 'ready' && state.readyAnnounced) || (kind === 'noSubject' && state.noSubjectAnnounced)) return silent;
  if (now - state.lastSpokenAt < GUIDANCE.gapMs) return silent;
  if (now - (state.spokenAt[kind] ?? -Infinity) < GUIDANCE.repeatMs) return silent;
  return {
    state: {
      ...state,
      lastSpokenAt: now,
      spokenAt: { ...state.spokenAt, [kind]: now },
      readyAnnounced: state.readyAnnounced || kind === 'ready',
      noSubjectAnnounced: state.noSubjectAnnounced || kind === 'noSubject',
    },
    cue: { kind, text: cueText(kind, facing, assessment.subject?.kind ?? null), key: KEY.has(kind) },
    assessment,
  };
}

export const TICKS = { fastestMs: 90, slowestMs: 700, farDistance: 0.5 };

// Time between haptic ticks: slow when the subject is far from the center, smoothly faster as it nears, and no
// ticks at all once it is centered and steady (or when there is no subject to aim at).
export function tickIntervalMs(assessment: Pick<Assessment, 'distance' | 'centered' | 'steady'>): number | null {
  if (assessment.distance === null) return null;
  if (assessment.centered && assessment.steady) return null;
  const t = Math.min(1, Math.max(0, assessment.distance / TICKS.farDistance));
  const eased = t * t * (3 - 2 * t);
  return Math.round(TICKS.fastestMs + (TICKS.slowestMs - TICKS.fastestMs) * eased);
}
