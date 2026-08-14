# Wrapper que invoca UAC sem bloquear shell original
$out = Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-File','C:\superloja\webhook-server\restart-chatbot-only.ps1' -WindowStyle Normal -PassThru
Write-Output "UAC launched. Id: $($out.Id). Approve to proceed."
