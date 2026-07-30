import { createRedfoxClient } from '../clients/redfox.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../providers/errors.js';

export async function fetchChannel() {
  throw new ProviderError(
    PROVIDER_ERROR_CODES.CONTRACT_MISSING,
    'Redfox does not publish a Xiaohongshu creator works-list contract; no endpoint was called',
    { provider: 'xiaohongshu' }
  );
}

export async function validate(channelInput) {
  const accountId = String(channelInput || '').trim();
  if (!accountId) throw new TypeError('Xiaohongshu accountId is required');
  const data = await createRedfoxClient().queryXiaohongshuAccount({ accountId });
  return {
    valid: true,
    channel_id: data?.accountId || accountId,
    channel_name: data?.accountName || accountId,
    avatar_url: data?.accountAvatar || null,
  };
}
