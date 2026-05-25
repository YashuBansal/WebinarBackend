param(
  [string]$Collection = "RAZORPAY_WEBHOOK_TEST_MATRIX.postman_collection.json",
  [string]$Environment = "RAZORPAY_WEBHOOK_TEST_ENV.postman_environment.json"
)

$ErrorActionPreference = "Stop"

Write-Host "Running Razorpay webhook matrix via Newman..."
Write-Host "Collection: $Collection"
Write-Host "Environment: $Environment"

if (-not (Get-Command newman -ErrorAction SilentlyContinue)) {
  Write-Error "Newman not found. Install with: npm install -g newman"
  exit 1
}

if (-not (Test-Path $Collection)) {
  Write-Error "Collection file not found: $Collection"
  exit 1
}

if (-not (Test-Path $Environment)) {
  Write-Error "Environment file not found: $Environment"
  exit 1
}

newman run $Collection `
  --environment $Environment `
  --reporters cli,json `
  --reporter-json-export "newman-razorpay-webhook-report.json" `
  --bail failure

if ($LASTEXITCODE -ne 0) {
  Write-Error "Newman run failed. See newman-razorpay-webhook-report.json"
  exit $LASTEXITCODE
}

Write-Host "Newman run passed."
