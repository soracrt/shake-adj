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

// Move a single keyframe on a property to a new time, preserving its value
// and interpolation types.
function moveKeyframe(prop, keyIndex, newTime) {
  var val       = prop.keyValue(keyIndex);
  var inType    = prop.keyInInterpolationType(keyIndex);
  var outType   = prop.keyOutInterpolationType(keyIndex);
  var inEase    = prop.keyInTemporalEase(keyIndex);
  var outEase   = prop.keyOutTemporalEase(keyIndex);

  prop.removeKey(keyIndex);
  prop.setValueAtTime(newTime, val);

  // After removal, indices shift — find the new index by time proximity.
  var newIdx = 1;
  var minDiff = Math.abs(prop.keyTime(1) - newTime);
  for (var i = 2; i <= prop.numKeys; i++) {
    var diff = Math.abs(prop.keyTime(i) - newTime);
    if (diff < minDiff) { minDiff = diff; newIdx = i; }
  }

  try {
    prop.setInterpolationTypeAtKey(newIdx, inType, outType);
    prop.setTemporalEaseAtKey(newIdx, inEase, outEase);
  } catch (e) { /* some props don't support easing */ }
}

// Retime the 3 preset keyframes so:
//   KF1 → nullStartTime
//   KF2 → peakTime
//   KF3 → nullEndTime
// Works on ALL animated sub-properties of the effect.
function retimeEffectKeyframes(effect, nullStartTime, peakTime, nullEndTime) {
  for (var p = 1; p <= effect.numProperties; p++) {
    var prop = effect.property(p);
    if (!prop || prop.numKeys < 3) continue;

    // Grab original times before any modification
    var t1 = prop.keyTime(1);
    var t2 = prop.keyTime(2);
    var t3 = prop.keyTime(3);

    // Only retime if the preset actually has 3 keyframes in order
    if (t1 >= t2 || t2 >= t3) continue;

    // Move KF3 first (highest index — doesn't affect lower indices)
    moveKeyframe(prop, 3, nullEndTime);
    // Move KF1 first is risky if nullStartTime > t2; move KF2 next
    // Re-find indices after KF3 move
    // Simplest: after removing KF3, KF2 is still index 2, KF1 is still 1
    moveKeyframe(prop, 2, peakTime);
    moveKeyframe(prop, 1, nullStartTime);
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

      // Set in/out to match null's keyframe span (optional but clean)
      adjLayer.inPoint  = nullStartTime;
      adjLayer.outPoint = nullEndTime;

      // Apply preset at the null's start time
      comp.time = nullStartTime;
      adjLayer.applyPreset(presetFile);

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
