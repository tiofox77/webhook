$ErrorActionPreference = 'Stop'
$taskName = 'Superloja AutoStart'
$scriptPath = 'C:\superloja\webhook-server\services-start.ps1'

# Build task XML inline (avoids schtasks elevation requirement for /Create)
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Auto-start Superloja (dashboard, proxy, tunnel, whatsapp-bridge) at user logon.</Description>
    <URI>\$taskName</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <GroupId>S-1-5-4</GroupId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
  </Settings>
  <Actions>
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "$scriptPath"</Arguments>
      <WorkingDirectory>C:\superloja\webhook-server</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$xmlPath = Join-Path $env:TEMP "$taskName.xml"
[System.IO.File]::WriteAllText($xmlPath, $xml, [System.Text.Encoding]::Unicode)

Write-Host "Registering task '$taskName'..."
try {
    Register-ScheduledTask -TaskName $taskName -Xml (Get-Content $xmlPath -Raw) -Force | Out-Null
    Write-Host "  OK: task registered (Logon trigger, 30s delay)"
    Write-Host "  Task will run on next user logon."
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)"
    Write-Host "  Tip: this command needs to be run as Administrator (right-click PowerShell -> Run as administrator)"
    exit 1
} finally {
    Remove-Item $xmlPath -ErrorAction SilentlyContinue
}

# Show registered task
Write-Host "`n--- Task details ---"
schtasks /query /TN "$taskName" /FO LIST /V 2>&1 | Select-String "TaskName|Status|Trigger|Next Run Time|Author" | ForEach-Object { Write-Host "  $_" }