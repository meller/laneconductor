param ([string]$Command = "help")
$ErrorActionPreference = "Stop"

$Action = $Command.ToLower().Trim()
$NpmExe = "npm.cmd"

if ($Action -eq "install") {
    Write-Host "Installing dependencies..."
    & "$NpmExe" install
    Set-Location ui
    & "$NpmExe" install
    Set-Location ..
    $SkillDir = Join-Path $PWD ".claude/skills/laneconductor"
    $SkillDir | Out-File -FilePath (Join-Path $HOME ".laneconductorrc") -Encoding ascii
    Write-Host "Done."
}
elseif ($Action -eq "setup") {
    Write-Host "Starting Full Setup..."
    $Dirs = @("conductor/tracks", "conductor/code_styleguides")
    foreach ($d in $Dirs) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }
    if (-not (Test-Path .env)) { Copy-Item .env.example .env }
    if (-not (Test-Path .laneconductor.json)) { Copy-Item .laneconductor.json.example .laneconductor.json }
    node scripts/setup-db.mjs
    Write-Host "Setup complete!"
}
elseif ($Action -eq "start") {
    Write-Host "Starting LaneConductor..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd ui; npm.cmd run dev"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "node conductor/laneconductor.sync.mjs"
    Write-Host "Launched UI and Sync worker in separate windows."
}
elseif ($Action -eq "ui-start") {
    Set-Location ui
    & "$NpmExe" run dev
}
elseif ($Action -eq "sync-start" -or $Action -eq "lc-start") {
    node conductor/laneconductor.sync.mjs
}
elseif ($Action -eq "lc-start-all" -or $Action -eq "start-all") {
    Write-Host "Starting LaneConductor (UI + Worker)..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd ui; npm.cmd run dev"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "node conductor/laneconductor.sync.mjs"
    Write-Host "✅ LaneConductor started in parallel windows"
    Write-Host "   UI:  http://localhost:8090"
    Write-Host "   API: http://localhost:8091"
}
elseif ($Action -eq "ui-stop" -or $Action -eq "lc-ui-stop") {
    Write-Host "Stopping UI (port 8090-8091)..."
    # Kill all node processes running vite or the Express server
    Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $cmdline = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
            if ($cmdline -match "vite|server" -or $_.Path -match "ui") {
                $_.Kill($true)
                Write-Host "  Killed PID $($_.Id): $cmdline"
            }
        } catch { }
    }
    # Also explicitly kill any process on ports 8090/8091
    netstat -ano 2>$null | Select-String "8090|8091" | ForEach-Object {
        $procId = ($_ -split '\s+')[-1]
        if ($procId -match '^\d+$') {
            try { taskkill /PID $procId /F /T 2>$null } catch { }
        }
    }
    Write-Host "✅ UI stopped"
}
elseif ($Action -eq "lc-stop" -or $Action -eq "sync-stop") {
    Write-Host "Stopping worker..."
    Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "laneconductor.sync" } | Stop-Process -Force
    Write-Host "✅ Worker stopped"
}
elseif ($Action -eq "lc-stop-all" -or $Action -eq "stop") {
    Write-Host "Stopping LaneConductor (UI + Worker)..."
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "✅ Stopped."
}
elseif ($Action -eq "db-migrate") {
    node scripts/atlas-prisma.mjs
    .\bin\atlas.exe migrate apply --env local
}
elseif ($Action -eq "db-status") {
    .\bin\atlas.exe migrate status --env local
}
elseif ($Action -eq "db-diff") {
    $Name = $args[0]
    if (-not $Name) { $Name = Read-Host "Enter migration name" }
    node scripts/atlas-prisma.mjs
    .\bin\atlas.exe migrate diff $Name --env local
}
elseif ($Action -eq "db-validate") {
    .\bin\atlas.exe migrate validate --env local
}
elseif ($Action -eq "db-gen") {
    npx prisma generate
}
else {
    Write-Host "Commands:"
    Write-Host "  install              - Install all dependencies"
    Write-Host "  setup                - Full setup (directories, env, DB schema)"
    Write-Host "  start                - Start UI + Worker in parallel"
    Write-Host "  lc-start-all         - Start UI + Worker in parallel (alias: start-all)"
    Write-Host "  ui-start             - Start UI only"
    Write-Host "  lc-start / sync-start - Start Worker only"
    Write-Host "  stop                 - Stop all processes"
    Write-Host "  lc-stop-all          - Stop UI + Worker (alias: stop)"
    Write-Host "  lc-ui-stop / ui-stop - Stop UI only (ports 8090-8091)"
    Write-Host "  lc-stop / sync-stop  - Stop Worker only"
    Write-Host "  db-migrate           - Run database migration"
    Write-Host "  db-status            - Show migration status"
    Write-Host "  db-diff <name>       - Create migration"
    Write-Host "  db-validate          - Validate schema"
    Write-Host "  db-gen               - Generate Prisma client"
}
