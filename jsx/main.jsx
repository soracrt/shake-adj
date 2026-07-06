// @target aftereffects

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(msg)  { return JSON.stringify({ message: msg }); }
function err(msg) { return JSON.stringify({ error: msg }); }

// ─── Preset storage (outside the extension bundle — install.ps1 wipes it) ───

// Read the user's saved presets file. Returns ok("") if it doesn't exist yet.
function sa_readPresets() {
  try {
    var folder = new Folder(Folder.userData.fsName + "/ShakeAdj");
    var file = new File(folder.fsName + "/presets.json");
    if (!file.exists) return ok("");
    file.encoding = "UTF-8";
    file.open("r");
    var contents = file.read();
    file.close();
    return ok(contents);
  } catch (e) {
    return err("Error reading presets: " + e.toString());
  }
}

// Write the user's presets file, creating the ShakeAdj folder if needed.
function sa_writePresets(jsonStr) {
  try {
    var folder = new Folder(Folder.userData.fsName + "/ShakeAdj");
    if (!folder.exists) folder.create();
    var file = new File(folder.fsName + "/presets.json");
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jsonStr);
    file.close();
    return ok("Presets saved.");
  } catch (e) {
    return err("Error writing presets: " + e.toString());
  }
}

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

// Scale an ease array's speeds by a factor (to maintain curve shape at new timing).
function scaleEase(easeArr, factor) {
  var out = [];
  for (var i = 0; i < easeArr.length; i++)
    out.push(new KeyframeEase(easeArr[i].speed * factor, easeArr[i].influence));
  return out;
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

// Retime the 3 preset keyframes to nullStartTime / peakTime / nullEndTime.
// Preserves the preset's original ease shape by scaling speeds proportionally
// to the new segment durations — no custom ease values are injected.
function retimeEffectKeyframes(effect, nullStartTime, peakTime, nullEndTime) {
  for (var p = 1; p <= effect.numProperties; p++) {
    var prop = effect.property(p);
    if (!prop || prop.numKeys < 3) continue;

    var t1 = prop.keyTime(1);
    var t2 = prop.keyTime(2);
    var t3 = prop.keyTime(3);
    if (t1 >= t2 || t2 >= t3) continue;

    // Original segment durations
    var origT12 = t2 - t1;
    var origT23 = t3 - t2;

    // New segment durations
    var newT12 = peakTime - nullStartTime;
    var newT23 = nullEndTime - peakTime;
    if (newT12 < 0.001) newT12 = 0.001;
    if (newT23 < 0.001) newT23 = 0.001;

    // Speed scale factors: old/new keeps the normalized curve shape identical
    var scale12 = origT12 / newT12;
    var scale23 = origT23 / newT23;

    // Snapshot everything before touching keyframes
    var v1 = prop.keyValue(1), v2 = prop.keyValue(2), v3 = prop.keyValue(3);
    var it1i = prop.keyInInterpolationType(1),  it1o = prop.keyOutInterpolationType(1);
    var it2i = prop.keyInInterpolationType(2),  it2o = prop.keyOutInterpolationType(2);
    var it3i = prop.keyInInterpolationType(3),  it3o = prop.keyOutInterpolationType(3);
    var e1o  = prop.keyOutTemporalEase(1);
    var e2i  = prop.keyInTemporalEase(2),  e2o = prop.keyOutTemporalEase(2);
    var e3i  = prop.keyInTemporalEase(3);

    // Remove all, re-add at new times
    prop.removeKey(3); prop.removeKey(2); prop.removeKey(1);
    prop.setValueAtTime(nullStartTime, v1);
    prop.setValueAtTime(peakTime,      v2);
    prop.setValueAtTime(nullEndTime,   v3);

    try {
      prop.setInterpolationTypeAtKey(1, it1i, it1o);
      prop.setInterpolationTypeAtKey(2, it2i, it2o);
      prop.setInterpolationTypeAtKey(3, it3i, it3o);
      prop.setTemporalEaseAtKey(1, scaleEase(e1o, scale12), scaleEase(e1o, scale12));
      prop.setTemporalEaseAtKey(2, scaleEase(e2i, scale12), scaleEase(e2o, scale23));
      prop.setTemporalEaseAtKey(3, scaleEase(e3i, scale23), scaleEase(e3i, scale23));
    } catch(e) {}
  }
}

// Find the S_DissolveShake effect on an effects group by name/matchName
// (falls back to the first effect if Sapphire's naming differs, preserving
// the previous "first effect" behavior). Returns null if there are no effects.
function findEffectByName(effectsGroup) {
  var numFx = effectsGroup.numProperties;
  if (numFx === 0) return null;

  var fallback = null;
  for (var i = 1; i <= numFx; i++) {
    var effect = effectsGroup.property(i);
    if (!effect) continue;
    if (!fallback) fallback = effect;

    var nm = (effect.name || "").toLowerCase();
    var mn = (effect.matchName || "").toLowerCase();
    if (nm.indexOf("dissolveshake") !== -1 || mn.indexOf("dissolveshake") !== -1) {
      return effect;
    }
  }
  return fallback;
}

// Recursively search an effect/group's properties for one whose display
// name exactly matches. Returns null if not found or on any traversal error.
function findPropByName(group, name) {
  try {
    if (!group || !group.numProperties) return null;
    for (var i = 1; i <= group.numProperties; i++) {
      var prop = group.property(i);
      if (!prop) continue;
      if (prop.name === name) return prop;

      var isGroup = false;
      try {
        isGroup = (prop.propertyType === PropertyType.INDEXED_GROUP ||
                   prop.propertyType === PropertyType.NAMED_GROUP);
      } catch (eg) {
        isGroup = false;
      }
      if (isGroup) {
        var found = findPropByName(prop, name);
        if (found) return found;
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Apply the 4 user-facing shake params to the Sapphire effect's native
// properties. amplitude/frequency/tilt are percentages (100 = baked
// default), seed is an absolute integer. Returns {applied, skipped} counts.
function applyParams(effect, params) {
  var applied = 0, skipped = 0;

  function setScaled(propName, k) {
    try {
      var prop = findPropByName(effect, propName);
      if (!prop) { skipped++; return; }
      if (prop.numKeys === 0) {
        prop.setValue(prop.value * k);
      } else {
        for (var i = 1; i <= prop.numKeys; i++) {
          prop.setValueAtTime(prop.keyTime(i), prop.keyValue(i) * k);
        }
      }
      applied++;
    } catch (e) {
      skipped++;
    }
  }

  if (params.amplitude !== undefined && params.amplitude !== null) {
    var kAmp = params.amplitude / 100;
    setScaled("X Shake", kAmp);
    setScaled("Y Shake", kAmp);
    setScaled("Z Shake", kAmp);
  }

  if (params.frequency !== undefined && params.frequency !== null) {
    var kFreq = params.frequency / 100;
    setScaled("Frequency", kFreq);
    setScaled("X Wave Freq", kFreq);
    setScaled("Y Wave Freq", kFreq);
    setScaled("Z Wave Freq", kFreq);
    setScaled("X Rand Freq", kFreq);
    setScaled("Y Rand Freq", kFreq);
    setScaled("Z Rand Freq", kFreq);
  }

  if (params.tilt !== undefined && params.tilt !== null) {
    var kTilt = params.tilt / 100;
    setScaled("Tilt Shake", kTilt);
  }

  if (params.seed !== undefined && params.seed !== null) {
    try {
      var seedProp = findPropByName(effect, "Seed");
      if (seedProp) {
        seedProp.setValue(Math.round(params.seed));
        applied++;
      } else {
        skipped++;
      }
    } catch (e) {
      skipped++;
    }
  }

  return { applied: applied, skipped: skipped };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function addShakes(argsJson) {
  try {
    var args     = JSON.parse(argsJson);
    var propMode = args.propMode;
    var presetPath = args.presetPath;
    var params = args.params ? args.params : null;

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
    var sapphireMissing = 0;
    var paramsApplied = 0, paramsSkipped = 0;
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

      // Find the S_DissolveShake effect by name (or whatever the preset added)
      var effect = findEffectByName(adjLayer.Effects);
      if (!effect) { sapphireMissing++; continue; }

      if (params) {
        var res = applyParams(effect, params);
        paramsApplied += res.applied;
        paramsSkipped += res.skipped;
      }

      if (effect.numProperties > 0) {
        retimeEffectKeyframes(effect, nullStartTime, peakTime, nullEndTime);
      }

      count++;
    }

    app.endUndoGroup();

    if (count === 0 && sapphireMissing > 0) {
      return err("Boris FX Sapphire (S_DissolveShake) not found on the applied preset. Install Sapphire and try again.");
    }
    if (count === 0) return err("No valid null layers found (need ≥2 keyframes).");

    var msg = "Added shake layers for " + count + " null layer" + (count > 1 ? "s" : "") + ".";
    if (params && paramsSkipped > 0) {
      msg += " (" + paramsSkipped + " param" + (paramsSkipped > 1 ? "s" : "") + " not applied)";
    }
    return ok(msg);

  } catch (e) {
    try { app.endUndoGroup(); } catch(x) {}
    return err("Error: " + e.toString());
  }
}
