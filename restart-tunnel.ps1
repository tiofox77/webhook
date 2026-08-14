$ErrorActionPreference = 'Continue'
$cfg = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
$logOut = 'C:\superloja\data\logs\cloudflared.log'
$logErr = 'C:\superloja\data\logs\cloudflared.log.err'
$exe = 'C:\superloja\webhook-server\cloudflared.exe'

# Kill old
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  killed old cloudflared PID $($_.Id)"
}
Start-Sleep -Seconds 2

# Start fresh
$p = Start-Process -FilePath $exe `
    -ArgumentList @('--config', $cfg, 'tunnel', 'run') `
    -WorkingDirectory 'C:\superloja\webhook-server' `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -WindowStyle Hidden -PassThru
Write-Host "  started new cloudflared PID $($p.Id)"

# Wait for tunnel handshake
Start-Sleep -Seconds 8

# Test
try {
    $r = Invoke-WebRequest -Uri 'https://superloja.cc/dashboard' -UseBasicParsing -TimeoutSec 10
    Write-Host "  [OK] public tunnel -> HTTP $($r.StatusCode)"
} catch {
    Write-Host "  [FAIL] public tunnel -> $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Cloudflared process:"
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Select-Object Id, StartTime | Format-Table | Out-String | Write-Host