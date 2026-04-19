param environmentName string
param location string
param aksSshPublicKey string
param aksAdminUsername string = 'azureuser'
param aksClusterName string = ''
param aksNodeResourceGroupName string = ''
param containerRegistryName string = ''
param logAnalyticsWorkspaceName string = ''
param applicationInsightsName string = ''
param apiIdentityName string = ''

var tags = {
  'azd-env-name': environmentName
}

var defaultNamePrefix = toLower(replace(environmentName, '_', '-'))
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var defaultContainerRegistryName = take('${replace(defaultNamePrefix, '-', '')}acr${resourceToken}', 50)
var aksNamespace = 'azure-podcast-generator'
var resolvedClusterName = !empty(aksClusterName) ? aksClusterName : '${defaultNamePrefix}-aks'
var resolvedNodeResourceGroupName = !empty(aksNodeResourceGroupName) ? aksNodeResourceGroupName : '${defaultNamePrefix}-node-rg'
var resolvedContainerRegistryName = !empty(containerRegistryName) ? containerRegistryName : defaultContainerRegistryName
var resolvedApiIdentityName = !empty(apiIdentityName) ? apiIdentityName : '${defaultNamePrefix}-api-mi'
var jwtSecret = uniqueString(resourceGroup().id, resourceToken, 'jwt-secret')

module logAnalytics 'core/monitor/loganalytics.bicep' = {
  name: 'loganalytics'
  params: {
    name: !empty(logAnalyticsWorkspaceName) ? logAnalyticsWorkspaceName : '${defaultNamePrefix}-law'
    location: location
    tags: tags
  }
}

module applicationInsights 'core/monitor/applicationinsights.bicep' = {
  name: 'applicationinsights'
  params: {
    name: !empty(applicationInsightsName) ? applicationInsightsName : '${defaultNamePrefix}-appi'
    location: location
    tags: tags
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: resolvedContainerRegistryName
  location: location
  sku: {
    name: 'Basic'
  }
  tags: tags
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: resolvedApiIdentityName
  location: location
}

resource aks 'Microsoft.ContainerService/managedClusters@2024-09-01' = {
  name: resolvedClusterName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {
    dnsPrefix: take('${replace(defaultNamePrefix, '-', '')}${resourceToken}', 54)
    nodeResourceGroup: resolvedNodeResourceGroupName
    linuxProfile: {
      adminUsername: aksAdminUsername
      ssh: {
        publicKeys: [
          {
            keyData: aksSshPublicKey
          }
        ]
      }
    }
    agentPoolProfiles: [
      {
        name: 'system'
        count: 1
        vmSize: 'Standard_D2s_v3'
        mode: 'System'
        osType: 'Linux'
        osSKU: 'Ubuntu'
        type: 'VirtualMachineScaleSets'
        enableAutoScaling: true
        minCount: 1
        maxCount: 3
        maxPods: 30
      }
    ]
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalytics.outputs.id
        }
      }
    }
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'azure'
      loadBalancerSku: 'standard'
    }
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
    }
  }
}

resource apiFederatedCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = {
  name: 'aks-api'
  parent: apiIdentity
  properties: {
    issuer: aks.properties.oidcIssuerProfile.issuerURL
    subject: 'system:serviceaccount:${aksNamespace}:api'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

output APPLICATIONINSIGHTS_CONNECTION_STRING string = applicationInsights.outputs.connectionString
output AKS_CLUSTER_NAME string = aks.name
output AKS_NAMESPACE string = aksNamespace
output AKS_OIDC_ISSUER_URL string = aks.properties.oidcIssuerProfile.issuerURL
output API_MANAGED_IDENTITY_CLIENT_ID string = apiIdentity.properties.clientId
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.properties.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = containerRegistry.name
@secure()
output JWT_SECRET string = jwtSecret
