param(
  [Parameter(Mandatory=$true)][string]$ApprovalFile
)

$ErrorActionPreference = "Stop"

$checker = Join-Path $PSScriptRoot "check-production-pilot-approval.js"
node $checker -ApprovalFile $ApprovalFile
exit $LASTEXITCODE
