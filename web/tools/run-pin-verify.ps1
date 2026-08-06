# Serve the staged dist on 8199 (detached) then run the quality-pin gate
# detached too, so neither is killed by the tool window. Logs prove the run.
Set-Location $PSScriptRoot\..
if (-not (Test-Path tools\out)) { New-Item -ItemType Directory -Path tools\out | Out-Null }
Start-Process -FilePath "node" `
  -ArgumentList @("tools/s6-serve.mjs", "8199", "/kings-gambit-medieval-chess/", "dist") `
  -RedirectStandardOutput "tools\out\pin-serve.log" `
  -RedirectStandardError "tools\out\pin-serve.err" `
  -WindowStyle Hidden
Start-Sleep -Seconds 3
Start-Process -FilePath "node" `
  -ArgumentList @("tools/verify-quality-pin.mjs") `
  -RedirectStandardOutput "tools\out\pin-verify.log" `
  -RedirectStandardError "tools\out\pin-verify.err" `
  -WindowStyle Hidden
Write-Output "launched"
