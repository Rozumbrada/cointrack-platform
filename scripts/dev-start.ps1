# Spustí Postgres + Mailpit + MinIO bez Dockeru.
# Předpoklad: máš nainstalovaný scoop + postgresql + mailpit + minio binárku.

$ErrorActionPreference = "Stop"

$pgData    = "$env:USERPROFILE\scoop\apps\postgresql\current\data"
$pgLogfile = "$env:USERPROFILE\scoop\apps\postgresql\current\logfile"
$minioBin  = "$env:USERPROFILE\bin\minio.exe"
$minioData = "$env:USERPROFILE\cointrack-dev-data\minio"

# ─── Postgres ───────────────────────────────────────────────────────
Write-Host "► Starting PostgreSQL..." -ForegroundColor Cyan
if (-not (Test-Path $pgData)) {
    Write-Host "  First run — initializing data dir..." -ForegroundColor Yellow
    pg_ctl init -D $pgData
}
$pgStatus = pg_ctl status -D $pgData 2>&1
if ($pgStatus -match "no server running") {
    pg_ctl start -D $pgData -l $pgLogfile
    Start-Sleep -Seconds 2
    # Zajistit, že DB a user existují
    $exists = psql -U $env:USERNAME -t -c "SELECT 1 FROM pg_roles WHERE rolname='cointrack'" postgres 2>$null
    if (-not $exists) {
        createuser -s cointrack
        createdb -O cointrack cointrack
        psql -c "ALTER USER cointrack WITH PASSWORD 'cointrack';" postgres
        Write-Host "  Created user + db 'cointrack'" -ForegroundColor Green
    }
} else {
    Write-Host "  Already running" -ForegroundColor Green
}

# ─── Mailpit ────────────────────────────────────────────────────────
Write-Host "► Starting Mailpit..." -ForegroundColor Cyan
$mailpit = Get-Process mailpit -ErrorAction SilentlyContinue
if (-not $mailpit) {
    Start-Process -FilePath "mailpit" `
        -ArgumentList "--smtp 0.0.0.0:1025 --listen 0.0.0.0:8025" `
        -WindowStyle Hidden
    Write-Host "  Started (SMTP :1025, UI http://localhost:8025)" -ForegroundColor Green
} else {
    Write-Host "  Already running (PID $($mailpit.Id))" -ForegroundColor Green
}

# ─── MinIO ──────────────────────────────────────────────────────────
Write-Host "► Starting MinIO..." -ForegroundColor Cyan
$minio = Get-Process minio -ErrorAction SilentlyContinue
if (-not $minio) {
    New-Item -ItemType Directory -Force -Path $minioData | Out-Null
    $env:MINIO_ROOT_USER     = "cointrack"
    $env:MINIO_ROOT_PASSWORD = "cointrack123"
    Start-Process -FilePath $minioBin `
        -ArgumentList "server `"$minioData`" --console-address `":9001`"" `
        -WindowStyle Hidden
    Write-Host "  Started (S3 :9000, console http://localhost:9001)" -ForegroundColor Green
} else {
    Write-Host "  Already running (PID $($minio.Id))" -ForegroundColor Green
}

Write-Host ""
Write-Host "✓ Dev prostředí běží." -ForegroundColor Green
Write-Host ""
Write-Host "   Postgres: localhost:5432  (cointrack/cointrack)"
Write-Host "   Mailpit:  http://localhost:8025"
Write-Host "   MinIO:    http://localhost:9001  (cointrack/cointrack123)"
Write-Host ""
Write-Host "Pro spuštění API:   cd api; ./gradlew run"
Write-Host "Pro zastavení všeho: ./scripts/dev-stop.ps1"
