#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

function Get-AzdEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $processValue = [System.Environment]::GetEnvironmentVariable($Key)
    if ($processValue) {
        return $processValue
    }

    $value = azd env get-value $Key 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    return $value
}

$resourceGroup = Get-AzdEnvValue AZURE_RESOURCE_GROUP
$clusterName = Get-AzdEnvValue AKS_CLUSTER_NAME

if (-not $resourceGroup -or -not $clusterName) {
    throw "AZURE_RESOURCE_GROUP and AKS_CLUSTER_NAME must be available in the azd environment."
}

function Wait-ForAksCluster {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResourceGroup,
        [Parameter(Mandatory = $true)]
        [string]$ClusterName
    )

    $startedCluster = $false

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $clusterState = az aks show `
            --resource-group $ResourceGroup `
            --name $ClusterName `
            --query "{provisioningState:provisioningState,powerState:powerState.code}" `
            --output json 2>$null | ConvertFrom-Json

        if ($LASTEXITCODE -ne 0) {
            Start-Sleep -Seconds 10
            continue
        }

        if ($clusterState.powerState -eq "Stopped" -and -not $startedCluster) {
            az aks start `
                --resource-group $ResourceGroup `
                --name $ClusterName `
                --only-show-errors | Out-Null
            $startedCluster = $true
            Start-Sleep -Seconds 10
            continue
        }

        if ($clusterState.provisioningState -eq "Succeeded" -and $clusterState.powerState -eq "Running") {
            return $true
        }

        Start-Sleep -Seconds 10
    }

    return $false
}

if (-not (Wait-ForAksCluster -ResourceGroup $resourceGroup -ClusterName $clusterName)) {
    throw "AKS cluster '$clusterName' is not available for deployment."
}

az aks get-credentials `
    --resource-group $resourceGroup `
    --name $clusterName `
    --overwrite-existing `
    --only-show-errors | Out-Null

$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $rootDir "src/web/.env.production"
if (Test-Path $envFile) {
    Remove-Item $envFile -Force
}

$namespaceName = Get-AzdEnvValue AKS_NAMESPACE
if (-not $namespaceName) {
    $namespaceName = "azure-podcast-generator"
}

$appInsightsConnectionString = Get-AzdEnvValue APPLICATIONINSIGHTS_CONNECTION_STRING
$jwtSecretBase64 = kubectl get secret api-config -n $namespaceName -o jsonpath='{.data.jwt-secret}' 2>$null
if ($LASTEXITCODE -eq 0 -and $jwtSecretBase64) {
    $jwtSecret = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($jwtSecretBase64))
}
if (-not $jwtSecret) {
    $jwtSecret = Get-AzdEnvValue JWT_SECRET
}
if (-not $jwtSecret) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $jwtSecret = [System.Convert]::ToHexString($bytes).ToLowerInvariant()
}

$namespaceYaml = kubectl create namespace $namespaceName --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) {
    throw "Failed to render namespace manifest for '$namespaceName'."
}
$namespaceYaml | kubectl apply --validate=false -f - | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply namespace '$namespaceName'."
}

$secretYaml = kubectl create secret generic api-config `
    --namespace $namespaceName `
    --from-literal=jwt-secret="$jwtSecret" `
    --from-literal=applicationinsights-connection-string="$appInsightsConnectionString" `
    --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) {
    throw "Failed to render secret manifest for 'api-config'."
}
$secretYaml | kubectl apply --validate=false -f - | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply secret 'api-config'."
}

$env:SERVICE_API_IMAGE_NAME = Get-AzdEnvValue SERVICE_API_IMAGE_NAME
$env:SERVICE_DEVBOX_IMAGE_NAME = Get-AzdEnvValue SERVICE_DEVBOX_IMAGE_NAME
$env:SERVICE_WEB_IMAGE_NAME = Get-AzdEnvValue SERVICE_WEB_IMAGE_NAME
$env:API_MANAGED_IDENTITY_CLIENT_ID = Get-AzdEnvValue API_MANAGED_IDENTITY_CLIENT_ID

node (Join-Path $rootDir "scripts/render-aks-manifests.mjs")

Write-Host "Connected kubectl context to AKS cluster '$clusterName'."
