targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@maxLength(90)
@description('Name of the resource group to use or create')
param resourceGroupName string = 'rg-${environmentName}'

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Public SSH key used for the AKS system node pool.')
param aksSshPublicKey string

@description('Admin username for AKS Linux nodes.')
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

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module aksStack 'aks-stack.bicep' = {
  name: 'aks-stack'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    aksSshPublicKey: aksSshPublicKey
    aksAdminUsername: aksAdminUsername
    aksClusterName: aksClusterName
    aksNodeResourceGroupName: aksNodeResourceGroupName
    containerRegistryName: containerRegistryName
    logAnalyticsWorkspaceName: logAnalyticsWorkspaceName
    applicationInsightsName: applicationInsightsName
    apiIdentityName: apiIdentityName
  }
}

output APPLICATIONINSIGHTS_CONNECTION_STRING string = aksStack.outputs.APPLICATIONINSIGHTS_CONNECTION_STRING
output AKS_CLUSTER_NAME string = aksStack.outputs.AKS_CLUSTER_NAME
output AKS_NAMESPACE string = aksStack.outputs.AKS_NAMESPACE
output AKS_OIDC_ISSUER_URL string = aksStack.outputs.AKS_OIDC_ISSUER_URL
output API_MANAGED_IDENTITY_CLIENT_ID string = aksStack.outputs.API_MANAGED_IDENTITY_CLIENT_ID
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = aksStack.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_CONTAINER_REGISTRY_NAME string = aksStack.outputs.AZURE_CONTAINER_REGISTRY_NAME
output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
@secure()
output JWT_SECRET string = aksStack.outputs.JWT_SECRET
output SERVICE_API_NAME string = 'api'
output SERVICE_WEB_NAME string = 'web'
output AZURE_RESOURCE_GROUP string = resourceGroupName
