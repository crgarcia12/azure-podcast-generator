#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$resourceGroup = azd env get-value AZURE_RESOURCE_GROUP 2>$null
$clusterName = azd env get-value AKS_CLUSTER_NAME 2>$null

if (-not $resourceGroup -or -not $clusterName) {
    throw "AZURE_RESOURCE_GROUP and AKS_CLUSTER_NAME must be available in the azd environment."
}

az aks get-credentials `
    --resource-group $resourceGroup `
    --name $clusterName `
    --overwrite-existing `
    --only-show-errors | Out-Null

$rootDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$envFile = Join-Path $rootDir "src/web/.env.production"
if (Test-Path $envFile) {
    Remove-Item $envFile -Force
}

Write-Host "Connected kubectl context to AKS cluster '$clusterName'."
