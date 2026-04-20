#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$namespace = azd env get-value AKS_NAMESPACE 2>$null
if (-not $namespace) {
    $namespace = "azure-podcast-generator"
}

$envVars = New-Object System.Collections.Generic.List[string]
$unsetEnvVars = New-Object System.Collections.Generic.List[string]
$secretPairs = New-Object System.Collections.Generic.List[string]

function Add-EnvVar {
    param(
        [string]$Name,
        [string]$Value
    )
    $envVars.Add("$Name=$Value")
}

function Set-Or-UnsetEnvVar {
    param(
        [string]$Name,
        [string]$Value
    )
    if ($Value) {
        Add-EnvVar -Name $Name -Value $Value
    } else {
        $unsetEnvVars.Add("$Name-")
    }
}

$serviceWebEndpointUrl = if ($env:SERVICE_WEB_ENDPOINT_URL) {
    $env:SERVICE_WEB_ENDPOINT_URL
} else {
    azd env get-value SERVICE_WEB_ENDPOINT_URL 2>$null
}
if ($serviceWebEndpointUrl) {
    $serviceWebEndpointUrl = $serviceWebEndpointUrl.TrimEnd('/')
}

$cookieSecure = if ($env:COOKIE_SECURE) {
    $env:COOKIE_SECURE.ToLowerInvariant()
} elseif ($serviceWebEndpointUrl -like "https://*") {
    "true"
} else {
    "false"
}

if ($env:ALLOWED_ORIGINS) {
    $allowedOrigins = $env:ALLOWED_ORIGINS
} elseif ($serviceWebEndpointUrl) {
    $allowedOrigins = $serviceWebEndpointUrl
} else {
    $allowedOrigins = $null
}

Add-EnvVar -Name "COOKIE_SECURE" -Value $cookieSecure
Set-Or-UnsetEnvVar -Name "ALLOWED_ORIGINS" -Value $allowedOrigins
Set-Or-UnsetEnvVar -Name "REGISTRATION_ENABLED" -Value $env:REGISTRATION_ENABLED
Set-Or-UnsetEnvVar -Name "SEED_ADMIN_USERNAME" -Value $env:SEED_ADMIN_USERNAME

$hostVoice = if ($env:PODCAST_HOST_VOICE) { $env:PODCAST_HOST_VOICE } else { "en-US-JennyNeural" }
$guestVoice = if ($env:PODCAST_GUEST_VOICE) { $env:PODCAST_GUEST_VOICE } else { "en-US-GuyNeural" }

$hasApiKeyConfig = [bool](
    $env:AZURE_OPENAI_ENDPOINT -and
    $env:AZURE_OPENAI_DEPLOYMENT_NAME -and
    $env:AZURE_OPENAI_API_KEY -and
    $env:AZURE_SPEECH_KEY -and
    $env:AZURE_SPEECH_REGION
)

$hasManagedIdentityConfig = [bool](
    $env:AZURE_OPENAI_ENDPOINT -and
    $env:AZURE_OPENAI_DEPLOYMENT_NAME -and
    $env:AZURE_SPEECH_REGION -and
    $env:AZURE_SPEECH_RESOURCE_ID
)

if ($hasApiKeyConfig) {
    Add-EnvVar -Name "PODCAST_PROVIDER" -Value "azure"
    Add-EnvVar -Name "AZURE_OPENAI_ENDPOINT" -Value $env:AZURE_OPENAI_ENDPOINT
    Add-EnvVar -Name "AZURE_OPENAI_DEPLOYMENT_NAME" -Value $env:AZURE_OPENAI_DEPLOYMENT_NAME
    Add-EnvVar -Name "AZURE_OPENAI_API_VERSION" -Value $(if ($env:AZURE_OPENAI_API_VERSION) { $env:AZURE_OPENAI_API_VERSION } else { "2024-10-21" })
    Add-EnvVar -Name "AZURE_SPEECH_REGION" -Value $env:AZURE_SPEECH_REGION
    Add-EnvVar -Name "PODCAST_HOST_VOICE" -Value $hostVoice
    Add-EnvVar -Name "PODCAST_GUEST_VOICE" -Value $guestVoice
    $secretPairs.Add("AZURE_OPENAI_API_KEY=$($env:AZURE_OPENAI_API_KEY)")
    $secretPairs.Add("AZURE_SPEECH_KEY=$($env:AZURE_SPEECH_KEY)")
    $unsetEnvVars.Add("AZURE_SPEECH_RESOURCE_ID-")
} elseif ($hasManagedIdentityConfig) {
    Add-EnvVar -Name "PODCAST_PROVIDER" -Value "azure"
    Add-EnvVar -Name "AZURE_OPENAI_ENDPOINT" -Value $env:AZURE_OPENAI_ENDPOINT
    Add-EnvVar -Name "AZURE_OPENAI_DEPLOYMENT_NAME" -Value $env:AZURE_OPENAI_DEPLOYMENT_NAME
    Add-EnvVar -Name "AZURE_OPENAI_API_VERSION" -Value $(if ($env:AZURE_OPENAI_API_VERSION) { $env:AZURE_OPENAI_API_VERSION } else { "2024-10-21" })
    Add-EnvVar -Name "AZURE_SPEECH_REGION" -Value $env:AZURE_SPEECH_REGION
    Add-EnvVar -Name "AZURE_SPEECH_RESOURCE_ID" -Value $env:AZURE_SPEECH_RESOURCE_ID
    Add-EnvVar -Name "PODCAST_HOST_VOICE" -Value $hostVoice
    Add-EnvVar -Name "PODCAST_GUEST_VOICE" -Value $guestVoice
    $unsetEnvVars.Add("AZURE_OPENAI_API_KEY-")
    $unsetEnvVars.Add("AZURE_SPEECH_KEY-")
} else {
    Add-EnvVar -Name "PODCAST_PROVIDER" -Value "mock"
    foreach ($name in @(
        "AZURE_OPENAI_ENDPOINT-",
        "AZURE_OPENAI_DEPLOYMENT_NAME-",
        "AZURE_OPENAI_API_VERSION-",
        "AZURE_OPENAI_API_KEY-",
        "AZURE_SPEECH_REGION-",
        "AZURE_SPEECH_KEY-",
        "AZURE_SPEECH_RESOURCE_ID-",
        "PODCAST_HOST_VOICE-",
        "PODCAST_GUEST_VOICE-"
    )) {
        $unsetEnvVars.Add($name)
    }
}

if ($env:SEED_ADMIN_PASSWORD) {
    $secretPairs.Add("SEED_ADMIN_PASSWORD=$($env:SEED_ADMIN_PASSWORD)")
} else {
    $unsetEnvVars.Add("SEED_ADMIN_PASSWORD-")
}

if ($secretPairs.Count -gt 0) {
    $secretArgs = @()
    foreach ($pair in $secretPairs) {
        $secretArgs += "--from-literal=$pair"
    }

    $secretYaml = kubectl create secret generic api-runtime-secrets `
        -n $namespace `
        @secretArgs `
        --dry-run=client `
        -o yaml

    $secretYaml | kubectl apply -f - | Out-Null

    kubectl set env deployment/api `
        -n $namespace `
        --from=secret/api-runtime-secrets | Out-Null
}

if ($envVars.Count -gt 0) {
    $envVarArray = $envVars.ToArray()
    kubectl set env deployment/api `
        -n $namespace `
        @envVarArray | Out-Null
}

if ($unsetEnvVars.Count -gt 0) {
    $unsetEnvVarArray = $unsetEnvVars.ToArray()
    kubectl set env deployment/api `
        -n $namespace `
        @unsetEnvVarArray | Out-Null
}

kubectl rollout status deployment/api -n $namespace --timeout=300s
Write-Host "Configured AKS API deployment in namespace '$namespace'."
