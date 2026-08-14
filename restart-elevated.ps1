# restart-elevated.ps1 - restart com privilegios de Admin (UAC).
# Usar APENAS quando um processo elevado/zombie prende uma porta e o restart
# normal (restart-services.cmd / control.ps1 restart) nao consegue matar.
# Mata por PADRAO de linha de comando e por PORTA - nunca PIDs fixos
# (PIDs sao reutilizados pelo Windows; matar PID antigo pode atingir outro processo).
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Sem elevacao. A pedir UAC...'
    $arg = '-NoProfile -File "' + $MyInvocation.MyCommand.Path + '"'
    try {
        $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $arg -Verb RunAs -PassThru
        $proc.WaitForExit(180) | Out-Null
        Write-Host "Concluido (exit $($proc.ExitCode))"
        exit $proc.ExitCode
    } catch {
        Write-Host "UAC falhou ou cancelado: $($_.Exception.Message)"
        exit 2
    }
}

# ── Seccao elevada ────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Continue'
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ELEVADO - a terminar servicos SuperLoja..."

# 1) node dos nossos scripts (por CommandLine)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -match 'dashboard\.js|messenger-chatbot\.js|intelligence-api\.js|reverse-proxy\.js|supervisor\.js|proxy-3338'
} | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host "  parou PID $($_.ProcessId)" } catch { Write-Host "  PID $($_.ProcessId): $($_.Exception.Message)" }
}

# 2) zombies presos nas nossas portas (CommandLine em branco por AV, etc.)
foreach ($port in @(3333, 3335, 3336, 8080)) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host "  parou zombie porta ${port}: PID $_" } catch {}
        }
}

# 3) cloudflared
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force; Write-Host "  parou cloudflared PID $($_.Id)" } catch {}
}

Start-Sleep -Seconds 2
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] A arrancar de novo (services-start.ps1)..."
& 'C:\superloja\webhook-server\services-start.ps1'
Write-Host "[$(Get-Date -Format 'HH:mm:ss')] FEITO."
