# Zastaví Postgres + Mailpit + MinIO.

$pgData = "$env:USERPROFILE\scoop\apps\postgresql\current\data"

Write-Host "► Stopping PostgreSQL..." -ForegroundColor Cyan
try {
    pg_ctl stop -D $pgData -m fast 2>$null
    Write-Host "  Stopped" -ForegroundColor Green
} catch {
    Write-Host "  Not running" -ForegroundColor Yellow
}

Write-Host "► Stopping Mailpit..." -ForegroundColor Cyan
Get-Process mailpit -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "  OK" -ForegroundColor Green

Write-Host "► Stopping MinIO..." -ForegroundColor Cyan
Get-Process minio -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "✓ Dev prostředí zastaveno." -ForegroundColor Green
