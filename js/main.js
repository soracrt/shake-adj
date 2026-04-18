var csInterface = new CSInterface();

function setStatus(msg, type) {
  var el = document.getElementById("status");
  el.textContent = msg;
  el.className = type || "";
}

document.getElementById("btnAdd").addEventListener("click", function () {
  var btn = this;
  btn.disabled = true;
  setStatus("Working...", "running");

  var propMode = document.getElementById("propMode").value;
  var presetName = document.getElementById("presetName").value;
  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);

  var args = JSON.stringify({
    propMode: propMode,
    presetPath: extPath + "/presets/" + presetName + ".ffx"
  });

  csInterface.evalScript('addShakes(' + JSON.stringify(args) + ')', function (result) {
    btn.disabled = false;
    if (!result || result === "undefined" || result === "EvalScript error.") {
      setStatus("Script error — check AE console.", "error");
      return;
    }
    try {
      var res = JSON.parse(result);
      if (res.error) {
        setStatus(res.error, "error");
      } else {
        setStatus(res.message, "success");
      }
    } catch (e) {
      setStatus(result, "error");
    }
  });
});
