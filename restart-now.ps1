$ErrorActionPreference = 'Stop'
$taskName = 'Superloja Restart Now'
$scriptPath = 'C:\superloja\webhook-server\services-start.ps1'

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>One-shot restart of Superloja services (kill + start).</Description>
    <URI>\$taskName</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$(Get-Date (Get-Date).AddSeconds(5) -Format 'yyyy-MM-ddTHH:mm:ss')</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <GroupId>S-1-5-4</GroupId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <AllowHardTerminate>true</AllowHardTerminate>
    <Enabled>true</Enabled>
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

try {
    Register-ScheduledTask -TaskName $taskName -Xml (Get-Content $xmlPath -Raw) -Force | Out-Null
    Write-Host "OK: task registered"
    Start-ScheduledTask -TaskName $taskName
    Write-Host "OK: task started"
} catch {
    Write-Host "FAIL: $($_.Exception.Message)"
    Write-Host "Need to run this script as Administrator (right-click PowerShell -> Run as administrator)."
    exit 1
} finally {
    Remove-Item $xmlPath -ErrorAction SilentlyContinue
}