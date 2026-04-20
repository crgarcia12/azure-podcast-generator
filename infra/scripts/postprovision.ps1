$ErrorActionPreference = "Stop"

Write-Host "Post-provision configuration..." -ForegroundColor Green

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SETTINGS_FILE = Join-Path $ROOT_DIR "apphost.settings.json"
$TEMPLATE_FILE = Join-Path $ROOT_DIR "apphost.settings.template.json"

# Check if settings file exists, if not, copy from template
if (-not (Test-Path $SETTINGS_FILE)) {
    Write-Host "apphost.settings.json not found. Copying from template..." -ForegroundColor Yellow
    if (Test-Path $TEMPLATE_FILE) {
        Copy-Item $TEMPLATE_FILE $SETTINGS_FILE
        Write-Host "Template copied successfully." -ForegroundColor Green
    } else {
        Write-Host "Warning: Template file not found at $TEMPLATE_FILE - skipping." -ForegroundColor Yellow
    }
}

$resourceGroup = azd env get-value AZURE_RESOURCE_GROUP 2>$null
$clusterName = azd env get-value AKS_CLUSTER_NAME 2>$null
$namespaceName = azd env get-value AKS_NAMESPACE 2>$null
$containerRegistryName = azd env get-value AZURE_CONTAINER_REGISTRY_NAME 2>$null
$containerRegistryEndpoint = azd env get-value AZURE_CONTAINER_REGISTRY_ENDPOINT 2>$null

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

azd env set AZURE_AKS_CLUSTER_NAME $clusterName | Out-Null

if (-not (Wait-ForAksCluster -ResourceGroup $resourceGroup -ClusterName $clusterName)) {
    Write-Host "AKS cluster not available yet, skipping Kubernetes context setup. It will be configured when the cluster is provisioned and a deployment is performed." -ForegroundColor Yellow
    exit 0
}

if ($containerRegistryName) {
    az aks update `
        --resource-group $resourceGroup `
        --name $clusterName `
        --attach-acr $containerRegistryName `
        --only-show-errors | Out-Null
}

az config set extension.use_dynamic_install=yes_without_prompt | Out-Null

$appRoutingEnabled = az aks show `
    --resource-group $resourceGroup `
    --name $clusterName `
    --query "addonProfiles.webApplicationRouting.enabled" `
    --output tsv 2>$null

if ($appRoutingEnabled -ne "true") {
    $appRoutingOutput = az aks approuting enable `
        --resource-group $resourceGroup `
        --name $clusterName `
        --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0 -and (-not ($appRoutingOutput | Out-String).Contains("already enabled"))) {
        throw ($appRoutingOutput | Out-String)
    }
}

az aks get-credentials `
    --resource-group $resourceGroup `
    --name $clusterName `
    --overwrite-existing `
    --only-show-errors | Out-Null

Write-Host "Provisioning complete!" -ForegroundColor Green
Write-Host "  - Resource Group: $resourceGroup" -ForegroundColor Cyan
Write-Host "  - AKS Cluster: $clusterName" -ForegroundColor Cyan
Write-Host "  - Namespace: $namespaceName" -ForegroundColor Cyan
Write-Host "  - Container Registry: $containerRegistryEndpoint" -ForegroundColor Cyan
