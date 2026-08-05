$ErrorActionPreference = "Stop"
$src = "C:\Users\Tks_Toledo\clawd\projects\rork-medieval-3d-chess\web\src"
$files = Get-ChildItem -Path $src -Recurse -File -Include *.ts,*.tsx

function Grep($pattern, $label) {
  Write-Output ""
  Write-Output ("=== " + $label + " ===")
  $hits = $files | Select-String -Pattern $pattern
  if ($hits.Count -eq 0) { Write-Output "(none)" }
  foreach ($h in $hits) { Write-Output ($h.Filename + " L" + $h.LineNumber + ": " + $h.Line.Trim()) }
}

Grep "URLSearchParams|location\.search" "query params / debug hooks"
Grep "AmbientLight" "AmbientLight usage (the law)"
Grep "window\.__|\(window as unknown" "window globals exposed"
Grep "normalMap|roughnessMap|aoMap|bumpMap" "material map channels in use"

Write-Output ""
Write-Output "=== counts ==="
$mr = ($files | Select-String -Pattern "Math\.random").Count
Write-Output ("Math.random total: " + $mr)
$msm = ($files | Select-String -Pattern "MeshStandardMaterial").Count
Write-Output ("MeshStandardMaterial: " + $msm)
$mpm = ($files | Select-String -Pattern "MeshPhysicalMaterial").Count
Write-Output ("MeshPhysicalMaterial: " + $mpm)
$mbm = ($files | Select-String -Pattern "MeshBasicMaterial").Count
Write-Output ("MeshBasicMaterial: " + $mbm)
