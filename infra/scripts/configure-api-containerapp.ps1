#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$resourceGroup = azd env get-value AZURE_RESOURCE_GROUP 2>$null
$apiAppName = azd env get-value SERVICE_API_NAME 2>$null
$webUrl = azd env get-value SERVICE_WEB_ENDPOINT_URL 2>$null
if (-not $webUrl) {
    $webUrl = azd env get-value REACT_APP_WEB_BASE_URL 2>$null
}

if (-not $resourceGroup -or -not $apiAppName) {
    throw "AZURE_RESOURCE_GROUP and SERVICE_API_NAME must be available in the azd environment."
}

$allowedOrigins = if ($env:ALLOWED_ORIGINS) { $env:ALLOWED_ORIGINS } elseif ($webUrl) { $webUrl } else { "" }
$envVars = @("COOKIE_SECURE=true")
if ($allowedOrigins) {
    $envVars += "ALLOWED_ORIGINS=$allowedOrigins"
}

$secretArgs = @()
if ($env:SEED_ADMIN_USERNAME -and $env:SEED_ADMIN_PASSWORD) {
    $secretArgs += "seed-admin-password=$($env:SEED_ADMIN_PASSWORD)"
    $envVars += "SEED_ADMIN_USERNAME=$($env:SEED_ADMIN_USERNAME)"
    $envVars += "SEED_ADMIN_PASSWORD=secretref:seed-admin-password"
}

$hasAzureKeyConfig = [bool](
    $env:AZURE_OPENAI_ENDPOINT -and
    $env:AZURE_OPENAI_DEPLOYMENT_NAME -and
    $env:AZURE_OPENAI_API_KEY -and
    $env:AZURE_SPEECH_KEY -and
    $env:AZURE_SPEECH_REGION
)

$hasAzureManagedIdentityConfig = [bool](
    $env:AZURE_OPENAI_ENDPOINT -and
    $env:AZURE_OPENAI_DEPLOYMENT_NAME -and
    $env:AZURE_SPEECH_REGION -and
    $env:AZURE_SPEECH_RESOURCE_ID
)

if ($hasAzureKeyConfig) {
    $secretArgs += "azure-openai-api-key=$($env:AZURE_OPENAI_API_KEY)"
    $secretArgs += "azure-speech-key=$($env:AZURE_SPEECH_KEY)"
    $envVars += "PODCAST_PROVIDER=azure"
    $envVars += "AZURE_OPENAI_ENDPOINT=$($env:AZURE_OPENAI_ENDPOINT)"
    $envVars += "AZURE_OPENAI_DEPLOYMENT_NAME=$($env:AZURE_OPENAI_DEPLOYMENT_NAME)"
    $envVars += "AZURE_OPENAI_API_VERSION=$($env:AZURE_OPENAI_API_VERSION ? $env:AZURE_OPENAI_API_VERSION : '2024-10-21')"
    $envVars += "AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key"
    $envVars += "AZURE_SPEECH_REGION=$($env:AZURE_SPEECH_REGION)"
    $envVars += "AZURE_SPEECH_KEY=secretref:azure-speech-key"
    $envVars += "PODCAST_HOST_VOICE=$($env:PODCAST_HOST_VOICE ? $env:PODCAST_HOST_VOICE : 'en-US-JennyNeural')"
    $envVars += "PODCAST_GUEST_VOICE=$($env:PODCAST_GUEST_VOICE ? $env:PODCAST_GUEST_VOICE : 'en-US-GuyNeural')"
} elseif ($hasAzureManagedIdentityConfig) {
    $envVars += "PODCAST_PROVIDER=azure"
    $envVars += "AZURE_OPENAI_ENDPOINT=$($env:AZURE_OPENAI_ENDPOINT)"
    $envVars += "AZURE_OPENAI_DEPLOYMENT_NAME=$($env:AZURE_OPENAI_DEPLOYMENT_NAME)"
    $envVars += "AZURE_OPENAI_API_VERSION=$($env:AZURE_OPENAI_API_VERSION ? $env:AZURE_OPENAI_API_VERSION : '2024-10-21')"
    $envVars += "AZURE_SPEECH_REGION=$($env:AZURE_SPEECH_REGION)"
    $envVars += "AZURE_SPEECH_RESOURCE_ID=$($env:AZURE_SPEECH_RESOURCE_ID)"
    $envVars += "PODCAST_HOST_VOICE=$($env:PODCAST_HOST_VOICE ? $env:PODCAST_HOST_VOICE : 'en-US-JennyNeural')"
    $envVars += "PODCAST_GUEST_VOICE=$($env:PODCAST_GUEST_VOICE ? $env:PODCAST_GUEST_VOICE : 'en-US-GuyNeural')"
} else {
    $envVars += "PODCAST_PROVIDER=mock"
}

if ($secretArgs.Count -gt 0) {
    az containerapp secret set `
        --resource-group $resourceGroup `
        --name $apiAppName `
        --secrets $secretArgs `
        --only-show-errors | Out-Null
}

az containerapp update `
    --resource-group $resourceGroup `
    --name $apiAppName `
    --set-env-vars $envVars `
    --only-show-errors | Out-Null

Write-Host "Configured API container app '$apiAppName' in resource group '$resourceGroup'."
