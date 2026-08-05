# Launches the Vite dev server detached so it survives the tool call window.
Set-Location "C:\Users\Tks_Toledo\clawd\projects\rork-medieval-3d-chess\web"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c npx vite --port 8080 --host 127.0.0.1 > dev-mp.log 2>&1"
$psi.WorkingDirectory = "C:\Users\Tks_Toledo\clawd\projects\rork-medieval-3d-chess\web"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
Write-Output "DEV_PID=$($p.Id)"
