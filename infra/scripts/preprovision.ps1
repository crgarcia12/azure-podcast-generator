#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$existingKey = azd env get-value AKS_SSH_PUBLIC_KEY 2>$null
if ($existingKey) {
    Write-Host "AKS_SSH_PUBLIC_KEY already configured."
    exit 0
}

$candidateKeys = @(
    (Join-Path $HOME ".ssh\id_rsa.pub"),
    (Join-Path $HOME ".ssh\id_ed25519.pub")
)

$sshKey = $null
foreach ($candidate in $candidateKeys) {
    if (Test-Path $candidate) {
        $sshKey = (Get-Content $candidate -Raw).Trim()
        Write-Host "Using existing SSH public key: $candidate"
        break
    }
}

if (-not $sshKey) {
    $sshDirectory = Join-Path $HOME ".ssh"
    $keyPath = Join-Path $sshDirectory "azd_aks"
    New-Item -ItemType Directory -Force -Path $sshDirectory | Out-Null
    ssh-keygen -t rsa -b 4096 -N "" -f $keyPath | Out-Null
    $sshKey = (Get-Content "$keyPath.pub" -Raw).Trim()
    Write-Host "Generated a new SSH public key at $keyPath.pub"
}

azd env set AKS_SSH_PUBLIC_KEY $sshKey | Out-Null
Write-Host "Configured AKS_SSH_PUBLIC_KEY for provisioning."
