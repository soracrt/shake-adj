// @target aftereffects

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(msg)  { return JSON.stringify({ message: msg }); }
function err(msg) { return JSON.stringify({ error: msg }); }

// Compute magnitude of a property value relative to a rest value.
// Handles multi-dimensional (arrays) and scalar values.
function magnitude(val, rest) {
  if (val instanceof Array) {
    var sum = 0;
    for (var i = 0; i < val.length; i++) {
      var d = val[i] - rest[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }
  return Math.abs(val - rest);
}

// Return the rest value for a property (value at first keyframe).
function restValue(prop) {
  return prop.keyValue(1);
}

// Find which property on the null layer has keyframes and best represents
// the motion. propMode: "auto"|"position"|"scale"|"rotation"
function findAnimatedProp(layer, propMode) {
  var props = [];

  if (propMode === "auto" || propMode === "position") {
    var p = layer.property("Transform").property("Position");
    if (p && p.numKeys >= 2) props.push(p);
  }
  if (propMode === "auto" || propMode === "scale") {
    var s = layer.property("Transform").property("Scale");
    if (s && s.numKeys >= 2) props.push(s);
  }
  if (propMode === "auto" || propMode === "rotation") {
    var r = layer.property("Transform").property("Rotation");
    if (r && r.numKeys >= 2) props.push(r);
  }

  if (props.length === 0) return null;

  // Pick the one with the highest peak velocity
  var best = null, bestMag = -1;
  for (var i = 0; i < props.length; i++) {
    var p = props[i];
    var comp = layer.containingComp;
    var fps  = comp.frameRate;
    var frameLen = 1 / fps;
    var startTime = p.keyTime(1);
    var endTime   = p.keyTime(p.numKeys);
    var t = startTime;
    while (t <= endTime - frameLen) {
      var m = magnitude(p.valueAtTime(t + frameLen, false), p.valueAtTime(t, false));
      if (m > bestMag) { bestMag = m; best = p; }
      t += frameLen;
    }
  }
  return best;
}

// Sample the property frame-by-frame and return the time of peak velocity
// (fastest rate of change), which is the steepest point on the graph curve.
function findPeakTime(prop, comp) {
  var fps       = comp.frameRate;
  var frameLen  = 1 / fps;
  var startTime = prop.keyTime(1);
  var endTime   = prop.keyTime(prop.numKeys);
  var peakTime  = startTime;
  var peakMag   = -1;

  var t = startTime;
  while (t <= endTime - frameLen) {
    var v1 = prop.valueAtTime(t, false);
    var v2 = prop.valueAtTime(t + frameLen, false);
    var m  = magnitude(v2, v1);
    if (m > peakMag) { peakMag = m; peakTime = t; }
    t += frameLen;
  }
  return peakTime;
}

// Move a single keyframe to a new time, preserving value and interpolation type.
// Ease is handled separately after all keyframes are placed.
function moveKeyframe(prop, keyIndex, newTime) {
  var val     = prop.keyValue(keyIndex);
  var inType  = prop.keyInInterpolationType(keyIndex);
  var outType = prop.keyOutInterpolationType(keyIndex);

  prop.removeKey(keyIndex);
  prop.setValueAtTime(newTime, val);

  var newIdx = 1;
  var minDiff = Math.abs(prop.keyTime(1) - newTime);
  for (var i = 2; i <= prop.numKeys; i++) {
    var diff = Math.abs(prop.keyTime(i) - newTime);
    if (diff < minDiff) { minDiff = diff; newIdx = i; }
  }

  try { prop.setInterpolationTypeAtKey(newIdx, inType, outType); } catch(e) {}
}

// Vector magnitude helper for multi-dim or scalar values.
function vecMag(a, b) {
  if (a instanceof Array) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }
  return Math.abs(a - b);
}

// Retime the 3 preset keyframes and apply the exact cubic bezier easing:
//   KF1 → KF2 : cubicBezier(0.52, 0.00, 0.74, 0.00)  — ease-in to peak
//   KF2 → KF3 : cubicBezier(0.26, 1.00, 0.48, 1.00)  — ease-out from peak
//
// Cubic bezier → AE temporal ease conversion:
//   slope at segment start  = y1/x1
//   slope at segment end    = (1-y2)/(1-x2)
//   AE speed = normalized_slope * (valueRange / segmentDuration)
//   AE influence (%) = x-distance of the closer handle * 100
function retimeEffectKeyframes(effect, nullStartTime, peakTime, nullEndTime) {
  var T12 = peakTime - nullStartTime;
  var T23 = nullEndTime - peakTime;
  if (T12 < 0.001) T12 = 0.001;
  if (T23 < 0.001) T23 = 0.001;

  for (var p = 1; p <= effect.numProperties; p++) {
    var prop = effect.property(p);
    if (!prop || prop.numKeys < 3) continue;

    var t1 = prop.keyTime(1);
    var t2 = prop.keyTime(2);
    var t3 = prop.keyTime(3);
    if (t1 >= t2 || t2 >= t3) continue;

    var v1 = prop.keyValue(1);
    var v2 = prop.keyValue(2);
    var v3 = prop.keyValue(3);

    // cubicBezier(0.52, 0.00, 0.74, 0.00) → KF1 out inf=52, KF2 in  inf=26
    // cubicBezier(0.26, 1.00, 0.48, 1.00) → KF2 out inf=26, KF3 in inf=52
    // speed=0 at KF2 keeps handles within the value range (non-zero speed
    // causes AE to draw the outgoing handle above the peak for decreasing
    // segments). Asymmetry comes entirely from the influence percentages.
    var easeKF1Out = [new KeyframeEase(0, 52)];
    var easeKF2In  = [new KeyframeEase(0, 26)];
    var easeKF2Out = [new KeyframeEase(0, 26)];
    var easeKF3In  = [new KeyframeEase(0, 52)];

    moveKeyframe(prop, 3, nullEndTime);
    moveKeyframe(prop, 2, peakTime);
    moveKeyframe(prop, 1, nullStartTime);

    try {
      prop.setTemporalEaseAtKey(1, easeKF1Out, easeKF1Out);
      prop.setTemporalEaseAtKey(2, easeKF2In,  easeKF2Out);
      prop.setTemporalEaseAtKey(3, easeKF3In,  easeKF3In);
    } catch(e) {}
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function addShakes(argsJson) {
  try {
    var args     = JSON.parse(argsJson);
    var propMode = args.propMode;
    var presetPath = args.presetPath;

    var presetFile = new File(presetPath);
    if (!presetFile.exists) {
      return err("Preset not found: " + presetPath);
    }

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return err("No active composition.");
    }

    var selected = comp.selectedLayers;
    if (!selected || selected.length === 0) {
      return err("Select at least one null layer.");
    }

    // Filter to null layers (or any layer with keyframes if not null)
    var nullLayers = [];
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].nullLayer) nullLayers.push(selected[i]);
    }
    if (nullLayers.length === 0) {
      return err("No null layers in selection.");
    }

    app.beginUndoGroup("Add Shakes");

    var count = 0;
    for (var n = 0; n < nullLayers.length; n++) {
      var nullLayer = nullLayers[n];

      // Find the animated property and its key range
      var animProp = findAnimatedProp(nullLayer, propMode);
      if (!animProp) continue;

      var nullStartTime = animProp.keyTime(1);
      var nullEndTime   = animProp.keyTime(animProp.numKeys);
      if (nullStartTime >= nullEndTime) continue;

      var peakTime = findPeakTime(animProp, comp);

      // Clamp peak so it's strictly between start and end
      var frameLen = 1 / comp.frameRate;
      if (peakTime <= nullStartTime) peakTime = nullStartTime + frameLen;
      if (peakTime >= nullEndTime)   peakTime = nullEndTime   - frameLen;

      // Create adjustment layer above the null layer
      var adjLayer = comp.layers.addSolid(
        [0, 0, 0], "Shake - " + nullLayer.name,
        comp.width, comp.height, comp.pixelAspect,
        comp.duration
      );
      adjLayer.adjustmentLayer = true;
      adjLayer.moveBefore(nullLayer);

      // Apply preset at the null's start time
      comp.time = nullStartTime;
      adjLayer.applyPreset(presetFile);

      // Set in/out AFTER preset (applyPreset can reset layer bounds)
      adjLayer.inPoint  = nullStartTime;
      adjLayer.outPoint = nullEndTime;

      // Find the S_DissolveShake effect (or whatever the preset added)
      var effect = null;
      for (var e = 1; e <= adjLayer.Effects.numProperties; e++) {
        effect = adjLayer.Effects.property(e);
        if (effect) break;
      }

      if (effect && effect.numProperties > 0) {
        retimeEffectKeyframes(effect, nullStartTime, peakTime, nullEndTime);
      }

      count++;
    }

    app.endUndoGroup();

    if (count === 0) return err("No valid null layers found (need ≥2 keyframes).");
    return ok("Added shake layers for " + count + " null layer" + (count > 1 ? "s" : "") + ".");

  } catch (e) {
    try { app.endUndoGroup(); } catch(x) {}
    return err("Error: " + e.toString());
  }
}
