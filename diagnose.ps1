$ErrorActionPreference = "SilentlyContinue"
$out = New-Object System.Text.StringBuilder
function W($line = "") { [void]$out.AppendLine($line); Write-Host $line }

W "======================================"
W " SHAKE ADJ - DIAGNOSTIC REPORT"
W " $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
W "======================================"
W ""

# ---- 1. Find AE installs ----
W "[1] AFTER EFFECTS INSTALLATIONS"
$aeExes = Get-ChildItem "C:\Program Files\Adobe" -Filter "AfterFX.exe" -Recurse -ErrorAction SilentlyContinue
if (-not $aeExes) {
    W "  None found under C:\Program Files\Adobe"
} else {
    foreach ($exe in $aeExes) {
        $verInfo = $exe.VersionInfo
        W "  Path:    $($exe.FullName)"
        W "  Version: $($verInfo.ProductVersion)"
        W ""
    }
}

# ---- 2. Extension install check ----
W "[2] SHAKE ADJ INSTALL CHECK"
$extDir = "$env:APPDATA\Adobe\CEP\extensions\com.sora.shakeadj"
$installed = Test-Path $extDir
W "  Folder exists: $installed"
W "  Path: $extDir"

$missing = @()
if ($installed) {
    $manifest = Join-Path $extDir "CSXS\manifest.xml"
    if (Test-Path $manifest) {
        [xml]$xml = Get-Content $manifest
        $bundleVer = $xml.ExtensionManifest.ExtensionBundleVersion
        $hostVer   = $xml.ExtensionManifest.ExecutionEnvironment.HostList.Host.Version
        $csxsVer   = $xml.ExtensionManifest.ExecutionEnvironment.RequiredRuntimeList.RequiredRuntime.Version
        W "  manifest.xml found"
        W "  Bundle version:      $bundleVer"
        W "  Host version range:  $hostVer"
        W "  Required CSXS:       $csxsVer"
    } else {
        W "  ! manifest.xml MISSING"
    }

    $required = @(
        "index.html","css\style.css","js\main.js","js\CSInterface.js",
        "jsx\main.jsx","CSXS\manifest.xml","presets\DS1.ffx"
    )
    foreach ($f in $required) {
        if (-not (Test-Path (Join-Path $extDir $f))) { $missing += $f }
    }
    if ($missing.Count -gt 0) {
        W "  ! MISSING FILES: $($missing -join ', ')"
    } else {
        W "  All required files present"
    }
} else {
    W "  ! Extension was never copied to the CEP extensions folder."
    W "    This means install.bat did not finish, or was blocked."
}
W ""

# ---- 3. CEP debug mode registry ----
W "[3] CEP DEBUG MODE (PlayerDebugMode)"
$debugFound = @{}
foreach ($ver in @("6","7","8","9","10","11","12","13")) {
    $key = "HKCU:\SOFTWARE\Adobe\CSXS.$ver"
    if (Test-Path $key) {
        $val = (Get-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction SilentlyContinue).PlayerDebugMode
        $debugFound[$ver] = $val
        W "  CSXS.$ver : PlayerDebugMode = $val"
    } else {
        $debugFound[$ver] = $null
        W "  CSXS.$ver : registry key missing"
    }
}
W ""

# ---- 4. Other installed CEP extensions (sanity check CEP itself works) ----
W "[4] OTHER INSTALLED CEP EXTENSIONS"
$allExtDir = "$env:APPDATA\Adobe\CEP\extensions"
if (Test-Path $allExtDir) {
    $others = Get-ChildItem $allExtDir -Directory | Select-Object -ExpandProperty Name
    if ($others) {
        $others | ForEach-Object { W "  - $_" }
    } else {
        W "  (none found)"
    }
} else {
    W "  CEP extensions folder does not exist at all: $allExtDir"
}
W ""

# ---- 5. Boris FX Sapphire check ----
W "[5] BORIS FX SAPPHIRE (required for Add Shakes to actually work)"
$sapphireHits = Get-ChildItem "C:\Program Files\Adobe\Common\Plug-ins" -Recurse -Filter "*Sapphire*" -ErrorAction SilentlyContinue
if ($sapphireHits) {
    W "  Found:"
    $sapphireHits | Select-Object -First 5 | ForEach-Object { W "  - $($_.FullName)" }
} else {
    W "  ! Not found under Common\Plug-ins. If not installed, the panel"
    W "    will load but 'Add Shakes' will fail with an error."
}
W ""

# ---- 6. Execution policy ----
W "[6] POWERSHELL EXECUTION POLICY"
Get-ExecutionPolicy -List | ForEach-Object { W "  $($_.Scope): $($_.ExecutionPolicy)" }
W ""

# ---- 7. Mark-of-the-web check on install folder ----
W "[7] DOWNLOAD BLOCK CHECK"
if ($installed) {
    $indexHtml = Join-Path $extDir "index.html"
    $zone = Get-Item -Path $indexHtml -Stream Zone.Identifier -ErrorAction SilentlyContinue
    if ($zone) {
        W "  ! Installed files are still marked as downloaded-from-internet (blocked)."
    } else {
        W "  OK - no download block detected."
    }
} else {
    W "  (skipped - extension not installed)"
}
W ""

# ---- SUMMARY ----
W "======================================"
W " SUMMARY"
W "======================================"
$flags = @()
if (-not $installed) {
    $flags += "Extension folder was never created -> install.bat did not run/finish."
} else {
    if ($missing.Count -gt 0) { $flags += "Extension is missing files: $($missing -join ', ')" }
    $anyDebugOn = $debugFound.Values | Where-Object { $_ -eq "1" }
    if (-not $anyDebugOn) {
        $flags += "No CSXS.x PlayerDebugMode key is set to 1 -> unsigned extension will not load."
    }
}
if (-not $sapphireHits) {
    $flags += "Boris FX Sapphire not detected -> panel would load but the shake effect will fail."
}
if ($flags.Count -eq 0) {
    W "  No issues detected by this script. If it still doesn't show up,"
    W "  send this whole report anyway."
} else {
    $flags | ForEach-Object { W "  ! $_" }
}
W ""
W "======================================"
W " Copy everything above and send it back."
W "======================================"

try {
    $out.ToString() | Set-Clipboard
    Write-Host ""
    Write-Host "(Report copied to clipboard automatically - just paste it)" -ForegroundColor Green
} catch {}

$reportPath = Join-Path $env:USERPROFILE "Desktop\shakeadj-diagnostic.txt"
$out.ToString() | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host "(Also saved to $reportPath)" -ForegroundColor Green
