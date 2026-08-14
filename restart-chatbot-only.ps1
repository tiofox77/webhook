
$pid_alvo = 26632
$port = 3335

# Kill tudo (com fallback via Get-NetTCPConnection se PID mudou)
$pids = @()
$pids += $pid_alvo
$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($conn) { $pids += $conn.OwningProcess | Sort-Object -Unique }

foreach ($p in $pids) {
  try { Stop-Process -Id $p -Force -ErrorAction Stop; Write-Output "killed $p" }
  catch { Write-Output "skip $p: $($_.Exception.Message)" }
}

Start-Sleep -Seconds 2

# Confirmar porta livre
$free = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
if ($free) {
  Write-Output "FAIL: porta $port ainda ocupada"
  exit 1
}

# Iniciar chatbot
Set-Location C:\superloja\webhook-server
. .\.env 2>$null
$node_args = @("messenger-chatbot.js")
$log = "C:\superloja\data\logs\chatbot-$(Get-Date -Format yyyyMMdd).log"

# Inicia com nohup (process detached)
$proc = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList $node_args `
  -WorkingDirectory "C:\superloja\webhook-server" `
  -RedirectStandardOutput $log `
  -RedirectStandardError "$log.err" `
  -WindowStyle Hidden `
  -PassThru

Write-Output "started pid $($proc.Id), log: $log"
Start-Sleep -Seconds 3

# Verificar que subiu
$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($conn) {
  Write-Output "OK: pid $($conn.OwningProcess) na porta $port"
} else {
  Write-Output "FAIL: chatbot não subiu em 3s"
}
