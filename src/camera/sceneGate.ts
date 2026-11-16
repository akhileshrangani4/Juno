// Decides when the view is worth describing without being asked. An unchanged view costs nothing: a description
// is asked for only on entering, or when the coarse brightness signature or the people in view have changed
// meaningfully since the last one, once the phone has settled, never while something is being spoken or another
// description is on its way, and at most once every minUnpromptedMs. Pure, so it is unit tested.

export const SCENE = {
  minUnpromptedMs: 8000,
  // Steady for this long before describing, so a swing of the phone isn't described halfway.
  settleMs: 1000,
  // Mean difference of the 8x8 brightness signature (0 to 1) that counts as a new scene, and the frame-to-frame
  // difference under which the view counts as still.
  changeThreshold: 0.08,
  stillThreshold: 0.03,
};

export type SceneInput = { signature: number[]; people: number; motion: number; now: number; busy: boolean; inflight: boolean };

export type GateState = {
  described: { signature: number[]; people: number } | null;
  lastAt: number;
  previous: number[] | null;
  stillSince: number | null;
};

export const initialGate = (): GateState => ({ described: null, lastAt: -Infinity, previous: null, stillSince: null });

export function signatureDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 1;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

export function sceneChanged(described: GateState['described'], input: Pick<SceneInput, 'signature' | 'people'>): boolean {
  if (!described) return true;
  return input.people !== described.people || signatureDistance(described.signature, input.signature) >= SCENE.changeThreshold;
}

export function gateScene(previous: GateState, input: SceneInput): { state: GateState; describe: boolean } {
  const still = previous.previous !== null && signatureDistance(previous.previous, input.signature) < SCENE.stillThreshold && input.motion < SCENE.stillThreshold;
  const state: GateState = { ...previous, previous: input.signature, stillSince: still ? (previous.stillSince ?? input.now) : null };
  const settled = state.stillSince !== null && input.now - state.stillSince >= SCENE.settleMs;
  const due = previous.described === null || input.now - previous.lastAt >= SCENE.minUnpromptedMs;
  if (input.busy || input.inflight || !settled || !due || !sceneChanged(previous.described, input)) return { state, describe: false };
  return { state: markDescribed(state, input), describe: true };
}

// Also called when the user asks, so an asked description resets the clock and the reference scene.
export function markDescribed(state: GateState, input: Pick<SceneInput, 'signature' | 'people' | 'now'>): GateState {
  return { ...state, described: { signature: input.signature, people: input.people }, lastAt: input.now };
}
