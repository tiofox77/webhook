# services-start.ps1 - arranque idempotente dos servicos SuperLoja.
# NAO mata nada saudavel: o supervisor.js e quem gere (health-check + respawn).
# Servicos geridos pelo supervisor: dashboard(3333), chatbot(3335),
# intelligence(3336), reverse-proxy(8080) e cloudflared (tunnel superloja.cc).
# Pode correr quantas vezes se quiser - lockfile do supervisor impede duplicados.
$ErrorActionPreference = 'Continue'
$wd = 'C:\superloja\webhook-server'
$logDir = 'C:\superloja\data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 1) Garantir supervisor vivo (ele levanta o resto)
$supAlive = $false
$supPid = 0
$lock = 'C:\superloja\data\supervisor.lock'
if (Test-Path $lock) {
    $supPid = [int](Get-Content $lock -ErrorAction SilentlyContinue)
    if ($supPid -and (Get-Process -Id $supPid -ErrorAction SilentlyContinue)) { $supAlive = $true }
}
if ($supAlive) {
    Write-Host "  supervisor ja vivo (PID $supPid)"
} else {
    Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList "$wd\supervisor.js" `
        -WorkingDirectory $wd -WindowStyle Hidden
    Write-Host "  supervisor iniciado"
}

# 2) Aguardar o primeiro ciclo do supervisor
Start-Sleep -Seconds 15

# 3) Health checks
Write-Host "`n--- HTTP health checks ---"
$tests = @(
    @{ name = 'dashboard (3333)';   url = 'http://127.0.0.1:3333/dashboard' },
    @{ name = 'chatbot (3335)';     url = 'http://127.0.0.1:3335/' },
    @{ name = 'proxy (8080)';       url = 'http://127.0.0.1:8080/' },
    @{ name = 'tunnel publico';     url = 'https://superloja.cc/dashboard' }
)
foreach ($t in $tests) {
    try {
        $r = Invoke-WebRequest -Uri $t.url -UseBasicParsing -TimeoutSec 10
        Write-Host "  [OK]   $($t.name) -> HTTP $($r.StatusCode)"
    } catch {
        $code = 0
        try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        if ($code -gt 0 -and $code -lt 500) { Write-Host "  [OK]   $($t.name) -> HTTP $code (vivo)" }
        else { Write-Host "  [FAIL] $($t.name) -> $($_.Exception.Message)" }
    }
}
Write-Host "`nSupervisor log: $logDir\supervisor.log"
