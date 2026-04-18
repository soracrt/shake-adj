var csInterface = new CSInterface();

document.getElementById("btnAdd").addEventListener("click", function () {
  var btn = this;
  btn.disabled = true;

  var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
  var args = JSON.stringify({
    propMode: "auto",
    presetPath: extPath + "/presets/DS1.ffx"
  });

  csInterface.evalScript('addShakes(' + JSON.stringify(args) + ')', function () {
    btn.disabled = false;
  });
});
