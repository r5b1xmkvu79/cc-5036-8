// Closed-loop packaging solver.
//
// Two folding assumptions are compared on the same planar net:
//
//   tree     Hierarchical articulation: every hinge angle is an independent
//            input, poses are propagated down the tree, and packaging seams
//            are only *measured*. Fast, but a seam gap can remain open.
//
//   closed   The hinge tree is still the kinematic skeleton, but packaging
//            seams become equality constraints. The solver finds hinge angles
//            closest to the requested angles that satisfy every seam. This
//            costs repeated fold evaluations and can fail; failures and
//            residual gaps are reported, never replaced by defaults.
//
// Scope of the closed-loop model (all of it is checked, not assumed):
//   - seams join two *free* panel edges of equal length;
//   - each seam states its endpoint pairing explicitly (flip: true/false);
//   - hinges must still form a single tree (validation.js);
//   - panels are zero-thickness rigid polygons, so seam closure is geometric,
//     not a material/sealability claim;
//   - interference is checked on the solved pose and reported separately.
//
// The solver is deterministic: the returned work counters (fold builds,
// residual evaluations, iterations) are the evidence for its cost.

import { buildFold } from './engine.js';
import { dist, edgeLengths2 } from './math.js';
import { collisionDiagnostics, detectCollisions } from './collision.js';
import { validateModel } from './validation.js';

const DEFAULT_TOLERANCE = 1e-6;
// Selects the least-changed closing pose; small enough never to hold a seam
// open once the residual is near zero.
const PRIOR_WEIGHT = 1e-3;
const ANGLE_LIMIT = Math.PI;

function edgeEndpoints(panel, edgeIndex) {
  return [panel.vertices[edgeIndex], panel.vertices[(edgeIndex + 1) % panel.vertices.length]];
}

function slotKey(panelId, edgeIndex) {
  return `${panelId}\u0000${edgeIndex}`;
}

// Structural seam validation. Every rejection is explicit; no seam is dropped
// or silently re-oriented.
export function validateSeams(model) {
  const diagnostics = [];
  const push = (code, message, refs = {}) =>
    diagnostics.push({ level: 'error', code, message, refs });

  const seams = model.seams ?? [];
  if (!Array.isArray(seams)) {
    push('SEAM_STRUCTURE', 'model.seams must be an array when present');
    return { ok: false, diagnostics };
  }
  if (seams.length === 0) return { ok: true, diagnostics };

  const panelById = new Map((model.panels ?? []).map((p) => [p.id, p]));
  const usedSlots = new Map();
  for (const edge of model.edges ?? []) {
    for (const [panelId, slot] of [[edge.a, edge.aEdge], [edge.b, edge.bEdge]]) {
      usedSlots.set(slotKey(panelId, slot), `hinge ${edge.id ?? ''}`.trim());
    }
  }
  const seamIds = new Set();

  for (const [idx, seam] of seams.entries()) {
    const ref = { seamIndex: idx, seamId: seam?.id };
    if (!seam || typeof seam.id !== 'string' || seam.id === '') {
      push('SEAM_ID', `seam #${idx} needs a string id`, ref);
      continue;
    }
    if (seamIds.has(seam.id)) {
      push('SEAM_ID', `duplicate seam id "${seam.id}"`, ref);
      continue;
    }
    seamIds.add(seam.id);
    if (seam.a === seam.b) {
      push('SEAM_SELF', `seam "${seam.id}" joins panel "${seam.a}" to itself`, ref);
      continue;
    }
    const pa = panelById.get(seam.a);
    const pb = panelById.get(seam.b);
    if (!pa || !pb) {
      push('SEAM_REFERENCE', `seam "${seam.id}" references an unknown panel`, ref);
      continue;
    }
    if (!Number.isInteger(seam.aEdge) || seam.aEdge < 0 || seam.aEdge >= pa.vertices.length ||
        !Number.isInteger(seam.bEdge) || seam.bEdge < 0 || seam.bEdge >= pb.vertices.length) {
      push('SEAM_EDGE_INDEX', `seam "${seam.id}" has an out-of-range edge index`, ref);
      continue;
    }
    if (typeof seam.flip !== 'boolean') {
      push('SEAM_ORIENTATION',
        `seam "${seam.id}" must declare flip (boolean): endpoint pairing is explicit, not guessed`, ref);
      continue;
    }
    const la = edgeLengths2(pa.vertices)[seam.aEdge];
    const lb = edgeLengths2(pb.vertices)[seam.bEdge];
    if (Math.abs(la - lb) > 1e-6) {
      push('SEAM_LENGTH_MISMATCH',
        `seam "${seam.id}": edge lengths ${la.toFixed(6)} != ${lb.toFixed(6)}; a seam cannot rescale a panel`,
        { ...ref, lengthA: la, lengthB: lb });
      continue;
    }
    for (const [panelId, slot, other] of [
      [seam.a, seam.aEdge, seam.b],
      [seam.b, seam.bEdge, seam.a],
    ]) {
      const key = slotKey(panelId, slot);
      const owner = usedSlots.get(key);
      if (owner) {
        push('SEAM_SLOT_REUSE',
          `seam "${seam.id}" uses ${panelId} edge ${slot}, already used by ${owner}`, { ...ref, slot: key });
      } else {
        usedSlots.set(key, `seam ${seam.id}→${other}`);
      }
    }
  }
  return { ok: !diagnostics.some((d) => d.level === 'error'), diagnostics };
}

function withAngles(model, anglesRad) {
  return {
    ...model,
    edges: model.edges.map((edge, i) => ({
      ...edge,
      angle: (anglesRad[i] * 180) / Math.PI,
    })),
  };
}

function endpointsFor(result, panelId, edgeIndex) {
  const panel = result.panels.get(panelId);
  const i0 = edgeIndex;
  const i1 = (edgeIndex + 1) % panel.worldVertices.length;
  return [panel.worldVertices[i0], panel.worldVertices[i1]];
}

// A seam is satisfied when the two named edges coincide. `flip: true` pairs
// a[0] with b[1] and a[1] with b[0]; false pairs a[0]-b[0], a[1]-b[1].
export function seamDistances(model, result) {
  return (model.seams ?? []).map((seam) => {
    const [a0, a1] = endpointsFor(result, seam.a, seam.aEdge);
    const [b0, b1] = endpointsFor(result, seam.b, seam.bEdge);
    const pairA = seam.flip ? [a0, b1] : [a0, b0];
    const pairB = seam.flip ? [a1, b0] : [a1, b1];
    const g0 = dist(pairA[0], pairA[1]);
    const g1 = dist(pairB[0], pairB[1]);
    return {
      id: seam.id,
      gap: (g0 + g1) / 2,
      endpointGaps: [g0, g1],
      midpointGap: dist(
        [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2],
        [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2, (b0[2] + b1[2]) / 2],
      ),
    };
  });
}

export function summarizeSeams(distances) {
  if (!distances.length) {
    return { seamCount: 0, maxGap: null, totalGap: null, closed: null, seams: [] };
  }
  const maxGap = Math.max(...distances.map((d) => d.gap));
  const totalGap = distances.reduce((s, d) => s + d.gap, 0);
  return {
    seamCount: distances.length,
    maxGap,
    totalGap,
    closed: maxGap <= DEFAULT_TOLERANCE,
    seams: distances,
  };
}

function seamResiduals(pairs) {
  const out = [];
  for (const seam of pairs) {
    for (const pair of seam.pairs) {
      out.push(pair[0][0] - pair[1][0], pair[0][1] - pair[1][1], pair[0][2] - pair[1][2]);
    }
  }
  return out;
}

function seamPairs(model, result) {
  return (model.seams ?? []).map((seam) => {
    const [a0, a1] = endpointsFor(result, seam.a, seam.aEdge);
    const [b0, b1] = endpointsFor(result, seam.b, seam.bEdge);
    return seam.flip
      ? { id: seam.id, pairs: [[a0, b1], [a1, b0]] }
      : { id: seam.id, pairs: [[a0, b0], [a1, b1]] };
  });
}

function maxSeamGap(model, result) {
  const d = seamDistances(model, result);
  return d.length ? Math.max(...d.map((x) => x.gap)) : 0;
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (Math.abs(f) < 1e-18) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// Levenberg–Marquardt on hinge angles. The objective is
//   sum(seam endpoint residual^2) + PRIOR_WEIGHT^2 * sum((theta - target)^2)
// so among all closing poses it prefers the smallest change from the requested
// angles. Residuals are in length units; angles are radians internally.
//
// A flat net is an exact stationary point of the seam residual (all seams meet
// trivially in-plane), so a single local solve from 0° cannot leave it. The
// deterministic multi-start below is therefore part of the method, not a
// workaround: requested angles first, then uniform seeds. Every attempt's fold
// builds are counted in `work`.
const SEED_ANGLES_DEG = [90, -90, 45, -45, 135, -135];

export function solveClosedLoop(model, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? 80;
  const roots = options.rootId ? { rootId: options.rootId } : undefined;
  const requestedDeg = options.requestedAngles
    ? options.requestedAngles.slice()
    : model.edges.map((e) => e.angle);
  const requested = requestedDeg.map((a) => (a * Math.PI) / 180);
  const work = {
    foldBuilds: 0,
    residualEvaluations: 0,
    jacobianRows: 0,
    iterations: 0,
    rejectedSteps: 0,
    restarts: 0,
    seedsTried: 0,
    variables: model.edges.length,
    seamConstraints: (model.seams ?? []).length,
    residualCount: 6 * (model.seams ?? []).length + model.edges.length,
  };

  const clamp = (x) => Math.max(-ANGLE_LIMIT, Math.min(ANGLE_LIMIT, x));

  const pose = (x) => {
    work.foldBuilds += 1;
    const built = buildFold(withAngles(model, x), roots);
    return built.ok ? built : null;
  };

  const evalResidual = (x, built) => {
    const result = built ?? pose(x);
    work.residualEvaluations += 1;
    if (!result) return { result: null, residuals: null, maxGap: Infinity };
    const seamPart = seamResiduals(seamPairs(model, result));
    const priorPart = x.map((v, i) => PRIOR_WEIGHT * (v - requested[i]));
    return {
      result,
      residuals: [...seamPart, ...priorPart],
      maxGap: maxSeamGap(model, result),
    };
  };

  const cost = (vals) => (vals ? vals.reduce((s, v) => s + v * v, 0) : Infinity);

  const runLM = (startDeg) => {
    const label = startDeg.length === 0 ? 'requested' : `uniform ${startDeg[0]}°`;
    work.seedsTried += 1;
    let x = startDeg.map((a) => clamp((a * Math.PI) / 180));
    let current = evalResidual(x, pose(x));
    if (!current.residuals) {
      return { x, current, converged: false, invalid: true, label };
    }
    let mu = 1e-3;
    let converged = current.maxGap <= tolerance;
    let stuck = null;

    for (let iter = 0; iter < maxIterations && !converged; iter++) {
      work.iterations += 1;
      const n = x.length;
      const r = current.residuals;
      const J = Array.from({ length: r.length }, () => new Array(n).fill(0));
      const h = 1e-6;
      for (let k = 0; k < n; k++) {
        // One-sided difference when the central stencil would leave [-π, π];
        // otherwise the probe pose is invalid and would fabricate a zero row.
        const forward = x[k] + h <= ANGLE_LIMIT;
        const xp = x.slice();
        const xm = x.slice();
        if (forward) { xp[k] += h; xm[k] -= h; } else { xp[k] -= h; xm[k] -= 2 * h; }
        const rpEval = evalResidual(xp);
        const rmEval = evalResidual(xm);
        if (!rpEval.residuals || !rmEval.residuals) {
          work.rejectedSteps += 1;
          continue;
        }
        work.jacobianRows += 2;
        for (let i = 0; i < r.length; i++) {
          J[i][k] = (rpEval.residuals[i] - rmEval.residuals[i]) / (forward ? 2 * h : h);
        }
      }

      let accepted = false;
      for (let trial = 0; trial < 8 && !accepted; trial++) {
        const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
        const Atb = new Array(n).fill(0);
        for (let i = 0; i < r.length; i++) {
          for (let a = 0; a < n; a++) {
            Atb[a] += J[i][a] * r[i];
            for (let b = 0; b < n; b++) AtA[a][b] += J[i][a] * J[i][b];
          }
        }
        for (let a = 0; a < n; a++) AtA[a][a] += mu;
        const step = solveLinear(AtA, Atb.map((v) => -v));
        if (!step || step.some((v) => !Number.isFinite(v))) {
          mu *= 10;
          continue;
        }
        const candidate = x.map((v, i) => clamp(v + step[i]));
        const candidateEval = evalResidual(candidate, pose(candidate));
        if (cost(candidateEval.residuals) < cost(r)) {
          x = candidate;
          current = candidateEval;
          mu = Math.max(mu / 3, 1e-9);
          accepted = true;
          if (current.maxGap <= tolerance) converged = true;
        } else {
          work.rejectedSteps += 1;
          mu *= 10;
        }
      }

      if (!accepted) {
        stuck = { iteration: iter, maxGap: current.maxGap };
        break;
      }
    }
    return { x, current, converged, invalid: false, stuck, label };
  };

  const starts = [requestedDeg];
  if (model.edges.length > 0) {
    for (const seed of SEED_ANGLES_DEG) starts.push(model.edges.map(() => seed));
  }
  const attempts = [];
  let best = null;
  for (let i = 0; i < starts.length; i++) {
    if (i > 0) work.restarts += 1;
    const attempt = runLM(starts[i]);
    attempts.push({
      label: attempt.label,
      converged: attempt.converged,
      maxGap: attempt.current.maxGap,
      foldBuildsAtEnd: work.foldBuilds,
    });
    if (!attempt.invalid && (!best || attempt.current.maxGap < best.current.maxGap)) {
      best = attempt;
    }
    if (attempt.converged) break;
  }

  // Keep the best attempt even when it failed: the caller must see the actual
  // residual and diagnostics rather than a fabricated "closed" default.
  const chosen = best ?? {
    x: requested.map(clamp),
    current: { result: null, maxGap: Infinity },
    converged: false,
    invalid: true,
    label: 'none',
  };

  const diagnostics = [];
  if (!chosen.current.result) {
    diagnostics.push({
      level: 'error',
      code: 'INVALID_START_POSE',
      message: 'requested hinge angles do not produce a valid rigid fold; no closed-loop solve was attempted',
      refs: { requestedAnglesDeg: requestedDeg },
    });
  } else if (!chosen.converged) {
    diagnostics.push({
      level: 'error',
      code: 'CLOSURE_NOT_SATISFIED',
      message: `seam closure not reached after ${work.seedsTried} deterministic starts: best max gap ${chosen.current.maxGap.toFixed(9)} > tolerance ${tolerance}`,
      refs: { maxGap: chosen.current.maxGap, tolerance, attempts },
    });
  }

  const summary = chosen.current.result
    ? summarizeSeams(seamDistances(model, chosen.current.result))
    : { seamCount: (model.seams ?? []).length, maxGap: null, totalGap: null, closed: false, seams: [] };
  return {
    ok: chosen.converged,
    converged: chosen.converged,
    diagnostics,
    result: chosen.current.result,
    anglesDeg: chosen.x.map((v) => (v * 180) / Math.PI),
    requestedAnglesDeg: requestedDeg,
    maxAngleChange: Math.max(0, ...chosen.x.map((v, i) => Math.abs(v - requested[i]))) * (180 / Math.PI),
    seamReport: summary,
    tolerance,
    work,
    attempts,
    solvedFrom: chosen.label,
  };
}

// Evaluates both assumptions on the same net. Tree mode is exactly the legacy
// articulation; closed mode adds seam constraints. Interference is computed for
// both and never suppressed when it is inconvenient.
export function evaluatePackaging(model, options = {}) {
  const mode = options.mode ?? 'tree';
  const base = validateModel(model);
  if (!base.ok) {
    return {
      mode, ok: false, diagnostics: base.diagnostics,
      result: null, tree: null, closed: null, collisions: [], collisionStats: null,
    };
  }
  const seams = validateSeams(model);
  if (!seams.ok) {
    return {
      mode, ok: false, diagnostics: seams.diagnostics,
      result: null, tree: null, closed: null, collisions: [], collisionStats: null,
    };
  }

  const roots = options.rootId ? { rootId: options.rootId } : undefined;
  const requestedAngles = model.edges.map((e) => e.angle);
  const treeBuilt = buildFold(model, roots);
  if (treeBuilt.panels.size !== model.panels.length) {
    // e.g. an unknown root id: never continue with a partially built pose.
    return {
      mode, ok: false,
      diagnostics: treeBuilt.diagnostics.length
        ? treeBuilt.diagnostics
        : [{ level: 'error', code: 'INCOMPLETE_POSE', message: 'fold did not evaluate every panel' }],
      result: null, tree: null, closed: null, collisions: [], collisionStats: null,
    };
  }
  const treeStats = {};
  const treeCollisions = detectCollisions(model, treeBuilt, { stats: treeStats });
  const treeSummary = summarizeSeams(seamDistances(model, treeBuilt));

  const tree = {
    ok: treeBuilt.ok,
    result: treeBuilt,
    seamReport: treeSummary,
    collisions: treeCollisions,
    collisionStats: treeStats,
    work: { foldBuilds: 1, iterations: 0, residualEvaluations: 0, jacobianRows: 0 },
  };

  if (mode === 'tree') {
    const diagnostics = [...treeBuilt.diagnostics, ...collisionDiagnostics(treeCollisions)];
    if (treeSummary.seamCount > 0 && !treeSummary.closed) {
      diagnostics.push({
        level: 'warn',
        code: 'SEAM_OPEN_TREE',
        message: `hierarchical articulation leaves seams open: max gap ${treeSummary.maxGap.toFixed(6)} (no closure constraint applied)`,
        refs: { maxGap: treeSummary.maxGap },
      });
    }
    return {
      mode, ok: treeBuilt.ok && treeCollisions.length === 0,
      diagnostics, result: treeBuilt, tree, closed: null,
      collisions: treeCollisions, collisionStats: treeStats,
    };
  }

  if (mode !== 'closed') {
    return {
      mode, ok: false,
      diagnostics: [{ level: 'error', code: 'PACKAGING_MODE', message: `unknown packaging mode "${mode}"` }],
      result: null, tree: null, closed: null, collisions: [], collisionStats: null,
    };
  }
  if (seams.diagnostics.length === 0 && (model.seams ?? []).length === 0) {
    return {
      mode, ok: false,
      diagnostics: [{
        level: 'error',
        code: 'NO_SEAMS',
        message: 'closed-loop mode needs at least one declared seam; refusing to fall back to tree articulation',
      }],
      result: null, tree, closed: null, collisions: [], collisionStats: null,
    };
  }

  const closed = solveClosedLoop(model, {
    ...options,
    requestedAngles,
  });
  const closedStats = {};
  const closedCollisions = closed.result
    ? detectCollisions(model, closed.result, { stats: closedStats })
    : [];
  const diagnostics = [
    ...treeBuilt.diagnostics,
    ...closed.diagnostics,
    ...collisionDiagnostics(closedCollisions),
  ];
  if (treeSummary.seamCount > 0 && !treeSummary.closed && closed.result) {
    diagnostics.push({
      level: 'info',
      code: 'TREE_SEAM_GAP',
      message: `tree pose seam gap ${treeSummary.maxGap.toFixed(6)} was reduced to ${closed.seamReport.maxGap.toFixed(6)} by the closed-loop solve`,
      refs: { treeGap: treeSummary.maxGap, closedGap: closed.seamReport.maxGap },
    });
  }
  return {
    mode,
    ok: closed.ok && closedCollisions.length === 0,
    diagnostics,
    result: closed.result,
    tree,
    closed: { ...closed, collisions: closedCollisions, collisionStats: closedStats },
    collisions: closedCollisions,
    collisionStats: closedStats,
    comparison: closed.result ? {
      treeMaxGap: treeSummary.maxGap,
      solvedMaxGap: closed.seamReport.maxGap,
      maxAngleChange: closed.maxAngleChange,
      requestedAngles,
      solvedAngles: closed.anglesDeg,
      treeWork: tree.work,
      closedWork: closed.work,
    } : null,
  };
}
