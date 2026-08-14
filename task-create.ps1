# task-create.ps1 - cria tarefa de auto-start (precisa Admin)
# Right-click PowerShell -> "Run as administrator", depois correr este script

$ErrorActionPreference = 'Stop'
$taskName = 'Superloja AutoStart'
$scriptPath = 'C:\superloja\webhook-server\services-start.ps1'

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERRO: Precisa de correr como Administrador." -ForegroundColor Red
    Write-Host "   Right-click PowerShell -> Run as administrator" -ForegroundColor Yellow
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
    -WorkingDirectory 'C:\superloja\webhook-server'

$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = 'PT30S'  # 30s delay para Windows terminar de inicializar
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Auto-start Superloja (dashboard + proxy + tunnel + whatsapp-bridge) on user logon' `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "[OK] Tarefa '$taskName' registada" -ForegroundColor Green
Write-Host ""
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, TaskPath | Format-Table -AutoSize
Write-Host ""
Write-Host "Para testar agora:" -ForegroundColor Cyan
Write-Host "   schtasks /run /tn `"$taskName`""