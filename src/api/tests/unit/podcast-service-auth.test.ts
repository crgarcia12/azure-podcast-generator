import { describe, expect, it } from 'vitest';
import { buildAzureSpeechAuthorizationToken } from '../../src/services/podcast-service.js';

describe('Azure Speech managed identity auth', () => {
  it('builds the documented aad resource token format for Speech REST requests', () => {
    const resourceId = '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.CognitiveServices/accounts/test-speech';
    const aadToken = 'test-microsoft-entra-token';

    expect(buildAzureSpeechAuthorizationToken(resourceId, aadToken)).toBe(
      `aad#${resourceId}#${aadToken}`,
    );
  });
});
