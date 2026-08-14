
$pids = (Get-NetTCPConnection -LocalPort 3335 -ErrorAction SilentlyContinue).OwningProcess
foreach ($p in ($pids | Sort -Unique)) {
  try { Stop-Process -Id $p -Force -ErrorAction Stop; Write-Output "killed $p" }
  catch { Write-Output "skip $p: $($_.Exception.Message)" }
}
Start-Sleep -Seconds 2
Set-Location C:\superloja\webhook-server
. .\.env 2>$null
$log = "C:\superloja\data\logs\chatbot-$(Get-Date -Format yyyyMMdd).log"
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "messenger-chatbot.js" `
  -WorkingDirectory "C:\superloja\webhook-server" `
  -RedirectStandardOutput $log `
  -RedirectStandardError "$log.err" `
  -WindowStyle Hidden
Start-Sleep -Seconds 4
$conn = Get-NetTCPConnection -LocalPort 3335 -ErrorAction SilentlyContinue
if ($conn) { Write-Output "OK pid $($conn.OwningProcess)" } else { Write-Output "FAIL" }
