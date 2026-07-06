// Pure data-access layer for Shake Adj presets. No DOM manipulation here —
// see js/main.js for wiring this up to the UI.

var PARAM_DEFS = [
  { key: "amplitude", label: "Amplitude",        min: 0, max: 200,   step: 1, default: 100 },
  { key: "frequency", label: "Frequency",        min: 0, max: 200,   step: 1, default: 100 },
  { key: "tilt",      label: "Rotation / Tilt",  min: 0, max: 200,   step: 1, default: 100 },
  { key: "seed",      label: "Seed",             min: 0, max: 99999, step: 1, default: 12345 }
];

var BUILTIN_DEFAULT = {
  name: "Default",
  builtin: true,
  params: { amplitude: 100, frequency: 100, tilt: 100, seed: 12345 }
};

function randomSeed() {
  return Math.floor(Math.random() * 100000);
}

function defaultStore() {
  return { version: 1, activePreset: "Default", presets: [BUILTIN_DEFAULT] };
}

function loadStore(csInterface, cb) {
  csInterface.evalScript("sa_readPresets()", function (result) {
    var envelope;
    try {
      envelope = JSON.parse(result);
    } catch (e) {
      console.error("ShakeAdjPresets: could not parse sa_readPresets() envelope", e);
      var fallback = defaultStore();
      saveStore(csInterface, fallback, function () { cb(fallback); });
      return;
    }

    if (envelope.error) {
      console.error("ShakeAdjPresets: sa_readPresets() error", envelope.error);
      var fallbackErr = defaultStore();
      saveStore(csInterface, fallbackErr, function () { cb(fallbackErr); });
      return;
    }

    var contents = envelope.message;
    if (!contents) {
      var fresh = defaultStore();
      saveStore(csInterface, fresh, function () { cb(fresh); });
      return;
    }

    var store;
    try {
      store = JSON.parse(contents);
    } catch (e2) {
      console.error("ShakeAdjPresets: could not parse presets.json contents", e2);
      var fallback2 = defaultStore();
      saveStore(csInterface, fallback2, function () { cb(fallback2); });
      return;
    }

    cb(store);
  });
}

function saveStore(csInterface, store, cb) {
  csInterface.evalScript(
    "sa_writePresets(" + JSON.stringify(JSON.stringify(store)) + ")",
    cb
  );
}

window.ShakeAdjPresets = {
  PARAM_DEFS: PARAM_DEFS,
  BUILTIN_DEFAULT: BUILTIN_DEFAULT,
  randomSeed: randomSeed,
  loadStore: loadStore,
  saveStore: saveStore
};
