param(
    [ValidateSet('status','start','stop','restart','logs')]$Action = 'status',
    [int]$Lines = 30
)

# control.ps1 - ferramenta manual de gestao dos servicos SuperLoja.
# A gestao continua e do supervisor.js (health-check + respawn a cada 20s).
#   status  : estado de todos os servicos + probes HTTP
#   start   : garante supervisor vivo (services-start.ps1)
#   stop    : para supervisor + servicos nossos (NUNCA o bridge do Hermes)
#   restart : stop + start
#   logs    : ultimas $Lines linhas de cada log

$wd = 'C:\superloja\webhook-server'
$logDir = 'C:\superloja\data\logs'

$services = @(
    @{ name='supervisor';   port=0;    log='supervisor' }
    @{ name='dashboard';    port=3333; log='dashboard' }
    @{ name='chatbot';      port=3335; log='chatbot' }
    @{ name='intelligence'; port=3336; log='intelligence' }
    @{ name='reverse-proxy';port=8080; log='proxy' }
    @{ name='cloudflared';  port=0;    log='cloudflared' }
    # whatsapp-bridge (3010) pertence ao gateway Hermes - so observamos, nunca gerimos
    @{ name='whatsapp-bridge (Hermes)'; port=3010; log=$null }
)

function Get-SvcAlive($svc) {
    if ($svc.name -eq 'supervisor') {
        $lock = 'C:\superloja\data\supervisor.lock'
        if (Test-Path $lock) {
            $supPid = [int](Get-Content $lock -ErrorAction SilentlyContinue)
            if ($supPid -and (Get-Process -Id $supPid -ErrorAction SilentlyContinue)) { return $supPid }
        }
        return $null
    }
    if ($svc.name -eq 'cloudflared') {
        $p = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p) { return $p.Id } else { return $null }
    }
    $conn = Get-NetTCPConnection -State Listen -LocalPort $svc.port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess } else { return $null }
}

switch ($Action) {

    'status' {
        Write-Host "`n=== Servicos SuperLoja ==="
        $allOk = $true
        foreach ($svc in $services) {
            $procId = Get-SvcAlive $svc
            $tag = if ($procId) { '[OK]  ' } else { $allOk = $false; '[DOWN]' }
            $portStr = if ($svc.port -gt 0) { ":$($svc.port)" } else { '' }
            $pidStr = if ($procId) { "PID $procId" } else { '' }
            Write-Host ("  {0,-26} {1,-6} {2} {3}" -f $svc.name, $portStr, $tag, $pidStr)
        }

        Write-Host "`n=== Probes HTTP ==="
        $probes = @(
            @{ n='dashboard';       u='http://127.0.0.1:3333/dashboard' }
            @{ n='webhook publico'; u='http://127.0.0.1:8080/webhook?hub.mode=test' }
            @{ n='tunnel publico';  u='https://superloja.cc/dashboard' }
        )
        foreach ($p in $probes) {
            try {
                $r = Invoke-WebRequest -Uri $p.u -UseBasicParsing -TimeoutSec 8
                Write-Host "  [OK]   $($p.n) -> HTTP $($r.StatusCode)"
            } catch {
                $code = 0
                try { $code = [int]$_.Exception.Response.StatusCode } catch {}
                if ($code -gt 0 -and $code -lt 500) { Write-Host "  [OK]   $($p.n) -> HTTP $code (vivo)" }
                else { Write-Host "  [FAIL] $($p.n) -> $($_.Exception.Message)"; $allOk = $false }
            }
        }

        if (-not $allOk) {
            Write-Host "`nAlgum servico em baixo. O supervisor recupera sozinho em ate 20s;"
            Write-Host "se persistir:  powershell -File control.ps1 restart"
            exit 1
        }
    }

    'start' {
        & "$wd\services-start.ps1"
    }

    'stop' {
        Write-Host "A parar servicos SuperLoja (bridge do Hermes fica intocado)..."
        # 1) supervisor primeiro (senao ressuscita o resto)
        $lock = 'C:\superloja\data\supervisor.lock'
        if (Test-Path $lock) {
            $supPid = [int](Get-Content $lock -ErrorAction SilentlyContinue)
            if ($supPid) { try { Stop-Process -Id $supPid -Force -ErrorAction Stop; Write-Host "  parou supervisor PID $supPid" } catch {} }
        }
        # 2) servicos node nossos (por CommandLine; NUNCA bridge/gateway)
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
            $_.CommandLine -match 'dashboard\.js|messenger-chatbot\.js|intelligence-api\.js|reverse-proxy\.js|supervisor\.js'
        } | ForEach-Object {
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host "  parou PID $($_.ProcessId)" }
            catch { Write-Host "  PID $($_.ProcessId): sem permissao (elevado)" }
        }
        # 3) cloudflared
        Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
            try { Stop-Process -Id $_.Id -Force; Write-Host "  parou cloudflared PID $($_.Id)" } catch {}
        }
        Write-Host "Feito."
    }

    'restart' {
        & $PSCommandPath stop
        Start-Sleep -Seconds 2
        & $PSCommandPath start
    }

    'logs' {
        Write-Host "`n=== Logs (ultimas $Lines linhas) ==="
        foreach ($svc in $services) {
            if (-not $svc.log) { continue }
            $f = Join-Path $logDir "$($svc.log).log"
            if (Test-Path $f) {
                Write-Host "`n--- $($svc.log).log ---"
                Get-Content $f -Tail $Lines
            }
        }
    }
}
