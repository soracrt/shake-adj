var csInterface = new CSInterface();

var store = null;

function getActivePreset() {
  if (!store) return ShakeAdjPresets.BUILTIN_DEFAULT;
  for (var i = 0; i < store.presets.length; i++) {
    if (store.presets[i].name === store.activePreset) return store.presets[i];
  }
  return store.presets[0];
}

function hydrateSliders(preset) {
  for (var i = 0; i < ShakeAdjPresets.PARAM_DEFS.length; i++) {
    var def = ShakeAdjPresets.PARAM_DEFS[i];
    var value = preset.params[def.key];
    if (value === undefined || value === null) value = def.default;
    var range = document.getElementById("range-" + def.key);
    var readout = document.getElementById("val-" + def.key);
    if (range) range.value = value;
    if (readout) readout.textContent = value;
  }
}

function readSliders() {
  var params = {};
  for (var i = 0; i < ShakeAdjPresets.PARAM_DEFS.length; i++) {
    var def = ShakeAdjPresets.PARAM_DEFS[i];
    var range = document.getElementById("range-" + def.key);
    params[def.key] = range ? Number(range.value) : def.default;
  }
  return params;
}

function refreshPresetSelect() {
  var select = document.getElementById("presetSelect");
  select.innerHTML = "";
  for (var i = 0; i < store.presets.length; i++) {
    var preset = store.presets[i];
    var option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    if (preset.name === store.activePreset) option.selected = true;
    select.appendChild(option);
  }
  updateDeleteButtonState();
}

function updateDeleteButtonState() {
  var btnDeletePreset = document.getElementById("btnDeletePreset");
  var active = getActivePreset();
  btnDeletePreset.disabled = !!(active && active.builtin);
}

document.addEventListener("DOMContentLoaded", function () {
  ShakeAdjPresets.loadStore(csInterface, function (loadedStore) {
    store = loadedStore;
    refreshPresetSelect();
    hydrateSliders(getActivePreset());
  });
});

document.getElementById("btnSettings").addEventListener("click", function () {
  document.getElementById("viewSettings").classList.remove("hidden");
  document.getElementById("viewMain").classList.add("hidden");
});

document.getElementById("btnBack").addEventListener("click", function () {
  var active = getActivePreset();
  active.params = readSliders();
  ShakeAdjPresets.saveStore(csInterface, store, function () {
    document.getElementById("viewSettings").classList.add("hidden");
    document.getElementById("viewMain").classList.remove("hidden");
    refreshPresetSelect();
  });
});

for (var pi = 0; pi < 4; pi++) {
  (function (def) {
    var range = document.getElementById("range-" + def.key);
    if (!range) return;
    range.addEventListener("input", function () {
      document.getElementById("val-" + def.key).textContent = range.value;
      getActivePreset().params[def.key] = Number(range.value);
    });
  })(ShakeAdjPresets.PARAM_DEFS[pi]);
}

document.getElementById("btnDice").addEventListener("click", function () {
  var seed = ShakeAdjPresets.randomSeed();
  var range = document.getElementById("range-seed");
  range.value = seed;
  document.getElementById("val-seed").textContent = seed;
  getActivePreset().params.seed = seed;
});

document.getElementById("btnSavePreset").addEventListener("click", function () {
  var nameInput = document.getElementById("presetName");
  var name = nameInput.value.trim();
  if (!name) name = "Custom";

  var params = readSliders();
  var existing = null;
  for (var i = 0; i < store.presets.length; i++) {
    if (store.presets[i].name === name) { existing = store.presets[i]; break; }
  }

  if (existing) {
    existing.params = params;
  } else {
    store.presets.push({ name: name, builtin: false, params: params });
  }

  store.activePreset = name;
  ShakeAdjPresets.saveStore(csInterface, store, function () {
    refreshPresetSelect();
    nameInput.value = "";
  });
});

document.getElementById("btnDeletePreset").addEventListener("click", function () {
  var active = getActivePreset();
  if (!active || active.builtin) return;

  var remaining = [];
  for (var i = 0; i < store.presets.length; i++) {
    if (store.presets[i].name !== active.name) remaining.push(store.presets[i]);
  }
  store.presets = remaining;
  store.activePreset = "Default";

  ShakeAdjPresets.saveStore(csInterface, store, function () {
    refreshPresetSelect();
    hydrateSliders(getActivePreset());
  });
});

document.getElementById("presetSelect").addEventListener("change", function () {
  store.activePreset = this.value;
  ShakeAdjPresets.saveStore(csInterface, store, function () {
    updateDeleteButtonState();
    hydrateSliders(getActivePreset());
  });
});

document.getElementById("btnAdd").addEventListener("click", function () {
  var btn = this;
  btn.disabled = true;

  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  var args = JSON.stringify({
    propMode: "auto",
    presetPath: extPath + "/presets/DS1.ffx",
    params: getActivePreset().params
  });

  csInterface.evalScript('addShakes(' + JSON.stringify(args) + ')', function () {
    btn.disabled = false;
  });
});
