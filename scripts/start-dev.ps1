param(
    [string]$Bun = "$env:APPDATA\npm\node_modules\bun\bin\bun.exe",
    [string]$AppPort = "3000",
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

Start-Process -FilePath $Bun `
    -ArgumentList "x", "next", "dev", "-p", $AppPort `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput "$Root\dev.out.log" `
    -RedirectStandardError "$Root\dev.err.log"

Start-Process -FilePath $Bun `
    -ArgumentList "scripts/relay-proxy.ts" `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput "$Root\relay.out.log" `
    -RedirectStandardError "$Root\relay.err.log"

Write-Output "started: app on $AppPort, relay on 8765"
