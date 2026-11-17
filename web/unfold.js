// Unfold/refold interpolation shared by the UI. The target angles are the
// folded pose the user asked for; t=0 is the exact flat net, t=1 the target.
// This is a view of the same hinge parameters, not a separate animation model,
// so every intermediate step is evaluated by the folding kernel.

export function clampUnit(t) {
  if (!Number.isFinite(t)) throw new Error('unfold fraction must be finite');
  return Math.min(1, Math.max(0, t));
}

export function interpolateAngles(targetAngles, t) {
  const s = clampUnit(t);
  return targetAngles.map((a) => {
    if (!Number.isFinite(a)) throw new Error('fold angle must be finite');
    return a * s;
  });
}

// Applies an unfold fraction in place and returns the angles that were set.
export function applyUnfold(model, targetAngles, t) {
  if (model.edges.length !== targetAngles.length) {
    throw new Error('target angle count does not match the model hinge count');
  }
  const angles = interpolateAngles(targetAngles, t);
  angles.forEach((a, i) => { model.edges[i].angle = a; });
  return angles;
}
