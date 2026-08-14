$ErrorActionPreference = 'Continue'
$wd = 'C:\superloja\webhook-server'

# Coisas a apagar (lixo / desactualizado)
$remove = @(
    # Binário Linux desnecessário
    'cloudflared',
    # Scripts .sh para Linux (não usados em Windows)
    'control.sh',
    'chatbot-control.sh',
    'dashboard-logs.sh',
    'dashboard-sequencial.sh',
    'manage-poster.sh',
    'watchdog.sh',
    'GUIA-RAPIDO.sh',
    'QUICK_DEPLOY.sh',
    # Backups antigos .env
    '.env.bak.20260702-115741',
    '.env.bak.20260702-115846',
    '.env.bak.20260702-120559',
    '.env-backup-2026-07-02',
    '.env-backups-2026-07-02',
    # Backups antigos daily-analytics
    'daily-analytics.js.bak.20260702-115741',
    'daily-analytics.js.bak.20260702-115848',
    # Migration script (já foi corrido)
    'migrate-superloja.ps1',
    # Setup scripts (legado, já feito)
    'setup.sh',
    'setup-cron.sh',
    'setup-messenger-webhook.sh',
    'setup-tunnel.sh',
    # Dir esquisito criado por engano
    'C:superlojadatalogs',
    # Dirs vazios
    'auto-poster',
    'scheduler',
    # Template só útil em Linux (não tem as creds reais)
    '.env.example'
)

Write-Host "=== A apagar lixo de $wd ==="
foreach ($f in $remove) {
    $p = Join-Path $wd $f
    if (Test-Path $p) {
        try {
            Remove-Item -Path $p -Recurse -Force
            Write-Host "  removido: $f"
        } catch {
            Write-Host "  ERRO a remover $f : $_"
        }
    } else {
        Write-Host "  nao existe: $f"
    }
}

# Limpar logs antigos (> 30 dias) para poupar espaço
$logDir = 'C:\superloja\data\logs'
if (Test-Path $logDir) {
    $old = Get-ChildItem -Path $logDir -File -ErrorAction SilentlyContinue | Where-Object {
        $_.LastWriteTime -lt (Get-Date).AddDays(-30)
    }
    foreach ($f in $old) {
        try {
            Remove-Item $f.FullName -Force
            Write-Host "  log antigo: $($f.Name)"
        } catch {}
    }
}

# Limpar img_cache de videos > 7 dias
$imgCache = 'C:\superloja\data\img_cache'
if (Test-Path $imgCache) {
    $old = Get-ChildItem -Path $imgCache -File -ErrorAction SilentlyContinue | Where-Object {
        $_.LastWriteTime -lt (Get-Date).AddDays(-7) -and $_.Extension -eq '.mp4'
    }
    foreach ($f in $old) {
        try {
            Remove-Item $f.FullName -Force
            Write-Host "  mp4 antigo: $($f.Name)"
        } catch {}
    }
}

Write-Host "`n=== Conteudo final de $wd ==="
Get-ChildItem -Path $wd -Force | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
