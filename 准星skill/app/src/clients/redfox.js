import { ProviderError, PROVIDER_ERROR_CODES } from '../providers/errors.js';

const BASE_URL = 'https://redfox.hk';
const ENDPOINTS = Object.freeze({
  douyinUserWithWorks: '/story/api/dyData/queryUserWithWorks',
  wechatWorkList: '/story/api/gzhData/queryWorkList',
  wechatWork: '/story/api/gzhData/queryWork',
  wechatArticleDetail: '/story/api/gzhData/queryArticleDetail',
  wechatSearchUser: '/story/api/gzhData/searchUser',
  xiaohongshuAccount: '/story/api/xhsUser/queryAccountDetail',
});

// 3203：红狐优质库未收录该账号。增量更新时等于「本次无新增」，验证时等于「无法监控」，
// 两个场景语义不同，由调用方用 isNoData() 自行区分，客户端只负责如实标记。
const NO_DATA = Object.freeze({ list: [], workList: [], noData: true });

export function isNoData(data) {
  return data?.noData === true;
}

export function createRedfoxClient(config = {}) {
  const apiKey = config.apiKey || process.env.REDFOX_API_KEY;
  const request = config.request || fetch;

  async function post(endpoint, payload) {
    if (!apiKey) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.NOT_CONFIGURED,
        'Redfox provider is not configured',
        { provider: 'redfox' }
      );
    }

    let response;
    try {
      response = await request(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, 'Redfox request failed', {
        provider: 'redfox', retryable: true, cause,
      });
    }

    let body;
    try {
      body = await response.json();
    } catch (cause) {
      throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, 'Redfox returned invalid JSON', {
        provider: 'redfox', retryable: response.status >= 500, cause,
      });
    }

    const code = Number(body?.code ?? body?.statusCode);
    if (!response.ok || code === 3106 || code === 3107) {
      throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, 'Redfox API key was rejected', {
        provider: 'redfox', retryable: false,
      });
    }
    if (code === 3108) {
      throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, 'Redfox rate limit reached', {
        provider: 'redfox', retryable: true,
      });
    }
    if (code === 3203) {
      return NO_DATA;
    }
    if (Number.isFinite(code) && code !== 2000 && code !== 200) {
      throw new ProviderError(PROVIDER_ERROR_CODES.FETCH_FAILED, `Redfox returned business code ${code}`, {
        provider: 'redfox', retryable: false,
      });
    }
    return body?.data ?? body;
  }

  return {
    queryDouyinUserWithWorks({ accountId, accountName }) {
      const identity = accountId ? { accountId } : { accountName };
      return post(ENDPOINTS.douyinUserWithWorks, { ...identity, source: '准星-WorkBuddy' });
    },
    queryWechatWorkList({ account, accountName, offset = 0, publishTimeStart, publishTimeEnd }) {
      return post(ENDPOINTS.wechatWorkList, {
        account,
        ...(accountName ? { accountName } : {}),
        offset,
        sortType: '_2',
        ...(publishTimeStart ? { publishTimeStart } : {}),
        ...(publishTimeEnd ? { publishTimeEnd } : {}),
        source: '准星-WorkBuddy',
      });
    },
    searchWechatUser({ keyword, offset = 0 }) {
      return post(ENDPOINTS.wechatSearchUser, { keyword, offset, source: '准星-WorkBuddy' });
    },
    queryWork({ workUuid }) {
      return post(ENDPOINTS.wechatWork, { workUuid, source: '准星-WorkBuddy' });
    },
    queryArticleDetail({ url }) {
      return post(ENDPOINTS.wechatArticleDetail, { url, source: '准星-WorkBuddy' });
    },
    queryXiaohongshuAccount({ accountId, userId }) {
      return post(ENDPOINTS.xiaohongshuAccount, {
        accountId,
        ...(userId ? { userId } : {}),
      });
    },
  };
}
