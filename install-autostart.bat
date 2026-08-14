@echo off
:: install-autostart.bat - regista tarefa de auto-start (precisa admin)
:: Right-click -> "Run as administrator"
echo.
echo === Superloja AutoStart - Install (Admin) ===
echo.

:: Check for admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: Este script precisa de ser corrido como Administrador.
    echo.
    echo    Right-click no ficheiro ^-^> "Run as administrator"
    echo.
    pause
    exit /b 1
)

schtasks /create /tn "Superloja AutoStart" ^
    /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\superloja\webhook-server\services-start.ps1" ^
    /sc onlogon ^
    /rl highest ^
    /delay 0000:30 ^
    /f

if %errorlevel% equ 0 (
    echo.
    echo [OK] Tarefa "Superloja AutoStart" registada!
    echo.
    echo    Trigger:    On user logon (+30s delay)
    echo    Action:     services-start.ps1 (dashboard + proxy + tunnel + whatsapp-bridge)
    echo.
    echo    A tarefa vai correr no proximo logon. Para testar agora:
    echo       schtasks /run /tn "Superloja AutoStart"
    echo.
) else (
    echo [FAIL] Nao foi possivel registar a tarefa.
)

echo.
pause