@echo off
REM SuperLoja - restart dos servicos (Hermes ou manual).
REM Mata os node dos servicos que a sessao conseguir matar e relanca o supervisor.
echo [restart-services] a terminar servicos antigos...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'supervisor\.js|dashboard\.js|messenger-chatbot\.js|intelligence-api\.js' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('  parou PID ' + $_.ProcessId) } catch { Write-Host ('  PID ' + $_.ProcessId + ': sem permissao (elevado) - supervisor contorna') } }"
echo [restart-services] a lancar supervisor...
start "" /B "C:\Program Files\nodejs\node.exe" "C:\superloja\webhook-server\supervisor.js"
ping -n 13 127.0.0.1 >nul
echo [restart-services] estado das portas:
netstat -ano | findstr "LISTENING" | findstr ":3333 :3335 :3336 :8080"
echo [restart-services] concluido. Log: C:\superloja\data\logs\supervisor.log
