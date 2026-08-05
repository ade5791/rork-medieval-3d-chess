param([string]$Script = "scripts/tf_capture.mjs", [string]$Label = "run")
$ErrorActionPreference = "Stop"
$root = "C:\Users\Tks_Toledo\clawd\projects\rork-medieval-3d-chess\web"
Set-Location $root
$out = Join-Path $root ("reports\" + $Label + ".log")
$err = Join-Path $root ("reports\" + $Label + ".err.log")
if (Test-Path $out) { Remove-Item $out -Force }
if (Test-Path $err) { Remove-Item $err -Force }
# WindowStyle Hidden + no -NoNewWindow so the child is fully detached from this
# shell and survives the caller being killed by the tool timeout.
$p = Start-Process -FilePath "node" -ArgumentList $Script, $Label `
  -WorkingDirectory $root -RedirectStandardOutput $out -RedirectStandardError $err `
  -WindowStyle Hidden -PassThru
Write-Output ("PID=" + $p.Id)
