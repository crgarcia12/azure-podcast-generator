// Standalone devbox deployment — independent of the app infra lifecycle.
// Deployed into an EXISTING Container Apps Environment + ACR (provisioned
// separately by the app's main infra). Only creates: a user-assigned
// managed identity, ACR pull role assignment, and the devbox container app.

targetScope = 'resourceGroup'

@description('Azure region')
param location string = resourceGroup().location

@description('Name of the existing Container Apps Environment')
param containerAppsEnvironmentName string

@description('Name of the existing Azure Container Registry')
param containerRegistryName string

@description('Name of the devbox container app')
param devboxContainerAppName string = 'devbox'

@description('Name of the user-assigned managed identity for the devbox')
param devboxIdentityName string = '${devboxContainerAppName}-mi'

@description('Full image reference in the ACR, e.g. myacr.azurecr.io/devbox:latest')
param devboxImage string

@description('CPU cores')
param cpu string = '0.5'

@description('Memory')
param memory string = '1.0Gi'

resource acae 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvironmentName
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: containerRegistryName
}

resource devboxIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: devboxIdentityName
  location: location
}

// Grant AcrPull to the devbox identity on the shared ACR
resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, devboxIdentity.id, 'AcrPull')
  scope: acr
  properties: {
    // AcrPull
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: devboxIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource devbox 'Microsoft.App/containerApps@2024-03-01' = {
  name: devboxContainerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${devboxIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: acae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: null
      registries: [
        {
          server: acr.properties.loginServer
          identity: devboxIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'main'
          image: devboxImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
}

output devboxName string = devbox.name
output devboxIdentityPrincipalId string = devboxIdentity.properties.principalId
