export const STORAGE_KEYS = {
  PORTFOLIO: 'dps_portfolio_v1',
  LEGACY: 'dps_holdings_v1',
  CACHE: 'dps_price_cache_v1',
  SETTINGS: 'dps_settings_v1'
};

export const INITIAL_HOLDINGS = [
  { symbol: 'SPY', qty: 15, monthly: 30000, startMonth: '2024-01', isNISA: true },
  { symbol: 'VOO', qty: 20, monthly: 20000, startMonth: '2024-02', isNISA: true },
  { symbol: 'VT', qty: 40, monthly: 10000, startMonth: '2024-01', isNISA: false },
  { symbol: 'QQQ', qty: 10, monthly: 0, startMonth: '', isNISA: false },
  { symbol: '1306', qty: 500, monthly: 10000, startMonth: '2024-03', isNISA: true },
  { symbol: '7203.T', qty: 100, monthly: 10000, startMonth: '2024-04', isNISA: true }
];

export const DEFAULT_SETTINGS = {
  apiKey: '',
  usdjpyRate: 155.00
};

export function getStoredPortfolio() {
  try {
    let raw = localStorage.getItem(STORAGE_KEYS.PORTFOLIO);
    if (!raw) {
      const legacy = localStorage.getItem(STORAGE_KEYS.LEGACY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        return parsed.map(item => ({
          symbol: item.symbol,
          qty: parseFloat(item.qty || item.shares || 0),
          monthly: parseFloat(item.monthly || 0),
          startMonth: item.startMonth || '',
          isNISA: item.isNISA !== undefined ? Boolean(item.isNISA) : true
        }));
      }
      return INITIAL_HOLDINGS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_HOLDINGS;
  }
}

export function saveStoredPortfolio(portfolio) {
  localStorage.setItem(STORAGE_KEYS.PORTFOLIO, JSON.stringify(portfolio));
}

export function getStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveStoredSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

export function getStoredCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CACHE);
    return raw ? JSON.parse(raw) : { timestamp: 0, quotes: {} };
  } catch {
    return { timestamp: 0, quotes: {} };
  }
}

export function saveStoredCache(cache) {
  localStorage.setItem(STORAGE_KEYS.CACHE, JSON.stringify(cache));
}
