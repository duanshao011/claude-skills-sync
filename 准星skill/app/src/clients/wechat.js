import { ProviderError, PROVIDER_ERROR_CODES } from '../providers/errors.js';

export function createWechatClient(config = {}) {
  const configured = Boolean(config.apiKey || process.env.WECHAT_PROVIDER_API_KEY);
  return {
    async fetchAccount() {
      if (!configured) {
        throw new ProviderError(
          PROVIDER_ERROR_CODES.NOT_CONFIGURED,
          'WeChat provider is not configured',
          { provider: 'wechat' }
        );
      }
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONTRACT_MISSING,
        'WeChat provider contract is not defined; no endpoint was called',
        { provider: 'wechat' }
      );
    },
  };
}
