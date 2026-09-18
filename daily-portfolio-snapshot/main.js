/**
 * Daily Portfolio Snapshot - main.js
 * Account-free, mobile-first portfolio tracker with 24h caching & Twelve Data integration
 */

// --- Constants & Storage Keys ---
const STORAGE_KEYS = {
  HOLDINGS: 'dps_holdings_v1',
  CACHE: 'dps_price_cache_v1',
  SETTINGS: 'dps_settings_v1'
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Realistic Demo Quotes for instant zero-config startup
const DEMO_QUOTES = {
  'SPY': { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', close: 564.20, previous_close: 558.10, change: 6.10, percent_change: 1.09, currency: 'USD' },
  'VOO': { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', close: 518.50, previous_close: 512.90, change: 5.60, percent_change: 1.09, currency: 'USD' },
  'VT': { symbol: 'VT', name: 'Vanguard Total World Stock ETF', close: 114.80, previous_close: 114.10, change: 0.70, percent_change: 0.61, currency: 'USD' },
  'QQQ': { symbol: 'QQQ', name: 'Invesco QQQ Trust Series 1', close: 489.10, previous_close: 483.40, change: 5.70, percent_change: 1.18, currency: 'USD' },
  '1306': { symbol: '1306', name: 'NEXT FUNDS TOPIX連動型上場投信', close: 2980.0, previous_close: 2955.0, change: 25.0, percent_change: 0.85, currency: 'JPY' }
};

// Default Initial Holdings
const INITIAL_HOLDINGS = [
  { id: 'h1', symbol: 'SPY', shares: 15, currency: 'USD', name: 'SPDR S&P 500 ETF' },
  { id: 'h2', symbol: 'VOO', shares: 20, currency: 'USD', name: 'Vanguard S&P 500 ETF' },
  { id: 'h3', symbol: 'VT', shares: 40, currency: 'USD', name: 'Vanguard Total World Stock' },
  { id: 'h4', symbol: 'QQQ', shares: 10, currency: 'USD', name: 'Invesco QQQ Trust' },
  { id: 'h5', symbol: '1306', shares: 500, currency: 'JPY', name: 'TOPIX 連動型上場投信' }
];

// Default Settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  baseCurrency: 'JPY',
  usdjpyRate: 155.00
};

// Application State
let appState = {
  holdings: [],
  cache: { timestamp: 0, quotes: {} },
  settings: { ...DEFAULT_SETTINGS },
  isUpdating: false
};

// --- Utility Functions ---
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return '0.00';
  return Number(num).toLocaleString('ja-JP', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatCurrency(val, currency) {
  const formatted = formatNumber(val, currency === 'JPY' ? 0 : 2);
  return currency === 'JPY' ? `¥${formatted}` : `$${formatted}`;
}

function formatRelativeDate(timestamp) {
  if (!timestamp) return '未取得';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// --- LocalStorage Operations ---
function loadStorage() {
  try {
    const savedHoldings = localStorage.getItem(STORAGE_KEYS.HOLDINGS);
    appState.holdings = savedHoldings ? JSON.parse(savedHoldings) : [...INITIAL_HOLDINGS];

    const savedCache = localStorage.getItem(STORAGE_KEYS.CACHE);
    if (savedCache) {
      appState.cache = JSON.parse(savedCache);
    } else {
      appState.cache = { timestamp: Date.now(), quotes: { ...DEMO_QUOTES } };
    }

    const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (savedSettings) {
      appState.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
    }
  } catch (e) {
    console.error('Error loading storage:', e);
    appState.holdings = [...INITIAL_HOLDINGS];
    appState.cache = { timestamp: Date.now(), quotes: { ...DEMO_QUOTES } };
  }
}

function saveHoldings() {
  localStorage.setItem(STORAGE_KEYS.HOLDINGS, JSON.stringify(appState.holdings));
}

function saveCache() {
  localStorage.setItem(STORAGE_KEYS.CACHE, JSON.stringify(appState.cache));
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(appState.settings));
}

// --- Twelve Data API Fetcher with Fallback & Cache ---
async function fetchQuoteForSymbol(symbol, apiKey) {
  const cleanSymbol = symbol.trim().toUpperCase();
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(cleanSymbol)}&apikey=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.status === 'error' || data.code) {
      throw new Error(data.message || 'Twelve Data API Error');
    }

    return {
      symbol: data.symbol || cleanSymbol,
      name: data.name || cleanSymbol,
      close: parseFloat(data.close) || 0,
      previous_close: parseFloat(data.previous_close) || parseFloat(data.close) || 0,
      change: parseFloat(data.change) || 0,
      percent_change: parseFloat(data.percent_change) || 0,
      currency: data.currency || (cleanSymbol === '1306' ? 'JPY' : 'USD')
    };
  } catch (err) {
    console.warn(`Fetch error for ${symbol}:`, err.message);
    if (DEMO_QUOTES[cleanSymbol]) {
      return { ...DEMO_QUOTES[cleanSymbol] };
    }
    return {
      symbol: cleanSymbol,
      name: cleanSymbol,
      close: 100.0,
      previous_close: 100.0,
      change: 0.0,
      percent_change: 0.0,
      currency: cleanSymbol === '1306' ? 'JPY' : 'USD'
    };
  }
}

async function refreshMarketQuotes(force = false) {
  if (appState.isUpdating) return;

  const now = Date.now();
  const cacheAge = now - (appState.cache.timestamp || 0);

  if (!force && cacheAge < CACHE_TTL_MS && Object.keys(appState.cache.quotes).length > 0) {
    renderDashboard();
    return;
  }

  appState.isUpdating = true;
  const refreshBtn = document.getElementById('btn-manual-refresh');
  if (refreshBtn) refreshBtn.classList.add('updating');

  const apiKey = appState.settings.apiKey.trim();
  const isDemo = !apiKey || apiKey === 'YOUR_API_KEY';

  const demoBanner = document.getElementById('demo-banner');
  if (demoBanner) demoBanner.style.display = isDemo ? 'block' : 'none';

  try {
    const symbolsToFetch = [...new Set(appState.holdings.map(h => h.symbol.toUpperCase()))];
    const newQuotes = { ...appState.cache.quotes };

    if (isDemo || !navigator.onLine) {
      symbolsToFetch.forEach(sym => {
        if (DEMO_QUOTES[sym]) {
          newQuotes[sym] = { ...DEMO_QUOTES[sym] };
        } else if (!newQuotes[sym]) {
          newQuotes[sym] = {
            symbol: sym,
            name: sym,
            close: 150.0,
            previous_close: 148.5,
            change: 1.5,
            percent_change: 1.01,
            currency: sym === '1306' ? 'JPY' : 'USD'
          };
        }
      });
      showToast(navigator.onLine ? 'デモ相場データを適用しました' : 'オフラインのためキャッシュを表示');
    } else {
      showToast('Twelve Dataから最新相場を取得中...');
      const promises = symbolsToFetch.map(sym => fetchQuoteForSymbol(sym, apiKey));
      const results = await Promise.all(promises);
      results.forEach(q => {
        if (q) newQuotes[q.symbol] = q;
      });
      showToast('相場データを更新しました');
    }

    appState.cache = {
      timestamp: now,
      quotes: newQuotes
    };
    saveCache();
  } catch (e) {
    console.error('Refresh quotes error:', e);
    showToast('相場更新に失敗しました（前回のデータを使用）');
  } finally {
    appState.isUpdating = false;
    if (refreshBtn) refreshBtn.classList.remove('updating');
    renderDashboard();
  }
}

// --- Price & Value Calculations ---
function convertCurrency(amount, fromCur, toCur) {
  if (fromCur === toCur) return amount;
  const rate = parseFloat(appState.settings.usdjpyRate) || 155.0;
  if (fromCur === 'USD' && toCur === 'JPY') {
    return amount * rate;
  } else if (fromCur === 'JPY' && toCur === 'USD') {
    return amount / rate;
  }
  return amount;
}

function calculatePortfolioTotals() {
  let currentTotalBase = 0;
  let prevTotalBase = 0;
  const baseCur = appState.settings.baseCurrency;

  const holdingsWithValues = appState.holdings.map(h => {
    const quote = appState.cache.quotes[h.symbol.toUpperCase()] || DEMO_QUOTES[h.symbol.toUpperCase()] || {
      close: 0,
      previous_close: 0,
      change: 0,
      percent_change: 0,
      currency: h.currency || 'USD'
    };

    const shares = parseFloat(h.shares) || 0;
    const currentPrice = quote.close;
    const prevPrice = quote.previous_close;
    const holdingValNative = shares * currentPrice;
    const prevHoldingValNative = shares * prevPrice;
    const holdingDiffNative = holdingValNative - prevHoldingValNative;
    const percentChange = prevHoldingValNative > 0 ? (holdingDiffNative / prevHoldingValNative) * 100 : quote.percent_change;

    // Convert to Base Currency
    const holdingValBase = convertCurrency(holdingValNative, quote.currency, baseCur);
    const prevHoldingValBase = convertCurrency(prevHoldingValNative, quote.currency, baseCur);

    currentTotalBase += holdingValBase;
    prevTotalBase += prevHoldingValBase;

    return {
      ...h,
      name: quote.name || h.name || h.symbol,
      quoteCurrency: quote.currency,
      currentPrice,
      prevPrice,
      priceChange: quote.change,
      percentChange,
      holdingValNative,
      holdingDiffNative,
      holdingValBase
    };
  });

  const totalDiffBase = currentTotalBase - prevTotalBase;
  const totalPercentDiff = prevTotalBase > 0 ? (totalDiffBase / prevTotalBase) * 100 : 0;

  return {
    holdings: holdingsWithValues,
    currentTotalBase,
    prevTotalBase,
    totalDiffBase,
    totalPercentDiff,
    baseCur
  };
}

// --- Render Functions ---
function renderDashboard() {
  const summary = calculatePortfolioTotals();
  const baseCur = summary.baseCur;

  const badgeEl = document.getElementById('base-currency-badge');
  if (badgeEl) badgeEl.textContent = baseCur === 'JPY' ? 'JPY (¥)' : 'USD ($)';

  const heroValEl = document.getElementById('hero-total-val');
  if (heroValEl) heroValEl.textContent = formatCurrency(summary.currentTotalBase, baseCur);

  const heroPrevEl = document.getElementById('hero-prev-total');
  if (heroPrevEl) heroPrevEl.textContent = formatCurrency(summary.prevTotalBase, baseCur);

  const diffBadge = document.getElementById('hero-diff-badge');
  if (diffBadge) {
    const isPositive = summary.totalDiffBase > 0;
    const isNegative = summary.totalDiffBase < 0;

    diffBadge.className = 'diff-badge ' + (isPositive ? 'gain' : isNegative ? 'loss' : 'neutral');
    const sign = isPositive ? '+' : '';
    const arrow = isPositive ? ' ▲' : isNegative ? ' ▼' : '';
    diffBadge.innerHTML = `
      <span>${sign}${formatCurrency(summary.totalDiffBase, baseCur)}</span>
      <span>(${sign}${formatNumber(summary.totalPercentDiff, 2)}%)${arrow}</span>
    `;
  }

  const now = Date.now();
  const cacheTimestamp = appState.cache.timestamp || 0;
  const hoursRemaining = Math.max(0, Math.round((CACHE_TTL_MS - (now - cacheTimestamp)) / (1000 * 60 * 60)));
  const isStale = (now - cacheTimestamp) >= CACHE_TTL_MS;

  const cacheDot = document.getElementById('cache-dot');
  if (cacheDot) cacheDot.className = 'cache-dot' + (isStale ? ' stale' : '');

  const lastUpdateText = document.getElementById('last-update-text');
  if (lastUpdateText) {
    if (cacheTimestamp === 0) {
      lastUpdateText.textContent = 'データ未取得';
    } else {
      lastUpdateText.textContent = `取得: ${formatRelativeDate(cacheTimestamp)} (${hoursRemaining > 0 ? `有効期限: 残り約${hoursRemaining}時間` : 'キャッシュ期限切れ・要更新'})`;
    }
  }

  const countBadge = document.getElementById('holdings-count-badge');
  if (countBadge) countBadge.textContent = `${summary.holdings.length}銘柄`;

  const listContainer = document.getElementById('holdings-list-container');
  if (!listContainer) return;

  if (summary.holdings.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <p>登録されている銘柄がありません。</p>
        <button class="btn btn-primary btn-sm" onclick="switchTab('tab-manage')">+ 最初の銘柄を追加</button>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = summary.holdings.map(item => {
    const isUp = item.holdingDiffNative > 0;
    const isDown = item.holdingDiffNative < 0;
    const diffClass = isUp ? 'gain' : isDown ? 'loss' : 'neutral';
    const sign = isUp ? '+' : '';
    const arrow = isUp ? '▲' : isDown ? '▼' : '';

    return `
      <div class="holding-item">
        <div class="holding-top">
          <div class="symbol-title-group">
            <div class="symbol-name">${item.symbol}</div>
            <div class="stock-desc">${item.name || item.symbol}</div>
          </div>
          <div class="holding-shares-pill">${formatNumber(item.shares, item.shares % 1 === 0 ? 0 : 2)} 株</div>
        </div>

        <div class="holding-bottom">
          <div class="price-col">
            <div class="price-label">終値 / 前日終値</div>
            <div class="current-price">${formatCurrency(item.currentPrice, item.quoteCurrency)}</div>
            <div class="prev-close-text">前日: ${formatCurrency(item.prevPrice, item.quoteCurrency)}</div>
          </div>

          <div class="value-col">
            <div class="price-label">保有評価額</div>
            <div class="holding-total-val">${formatCurrency(item.holdingValBase, baseCur)}</div>
            <div class="holding-diff-tag ${diffClass}">
              ${sign}${formatCurrency(item.holdingDiffNative, item.quoteCurrency)} (${sign}${formatNumber(item.percentChange, 2)}%) ${arrow}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderManageHoldings() {
  const container = document.getElementById('manage-holdings-list');
  if (!container) return;

  if (appState.holdings.length === 0) {
    container.innerHTML = `<p class="form-help">登録された銘柄はありません。</p>`;
    return;
  }

  container.innerHTML = appState.holdings.map((h) => {
    return `
      <div class="holding-item" style="padding: 12px 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <strong style="font-size: 1.05rem;">${h.symbol}</strong>
            <span style="font-size: 0.85rem; color: var(--text-muted); margin-left: 8px;">${h.shares} 株 (${h.currency || 'USD'})</span>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteHolding('${h.id}')" title="削除">
            削除
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// --- Tab Switching ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  if (tabId === 'tab-dashboard') {
    renderDashboard();
  } else if (tabId === 'tab-manage') {
    renderManageHoldings();
  } else if (tabId === 'tab-settings') {
    loadSettingsToForm();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectQuickSymbol(symbol) {
  const symEl = document.getElementById('input-symbol');
  const curEl = document.getElementById('input-currency');
  const shEl = document.getElementById('input-shares');
  if (symEl) symEl.value = symbol;
  if (curEl) curEl.value = (symbol === '1306' ? 'JPY' : 'USD');
  if (shEl) shEl.focus();
}

// --- Holding Actions ---
function addHolding(e) {
  if (e) e.preventDefault();
  const symbolInput = document.getElementById('input-symbol');
  const sharesInput = document.getElementById('input-shares');
  const currencyInput = document.getElementById('input-currency');

  const symbol = symbolInput.value.trim().toUpperCase();
  const shares = parseFloat(sharesInput.value);
  const currency = currencyInput.value;

  if (!symbol || isNaN(shares) || shares <= 0) {
    showToast('正しいシンボルと保有数量を入力してください');
    return;
  }

  const existing = appState.holdings.find(h => h.symbol === symbol);
  if (existing) {
    existing.shares = parseFloat(existing.shares) + shares;
    showToast(`${symbol} の保有数量を更新しました (${existing.shares}株)`);
  } else {
    const newHolding = {
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      symbol,
      shares,
      currency,
      name: DEMO_QUOTES[symbol] ? DEMO_QUOTES[symbol].name : symbol
    };
    appState.holdings.push(newHolding);
    showToast(`${symbol} をポートフォリオに追加しました`);
  }

  saveHoldings();
  symbolInput.value = '';
  sharesInput.value = '';

  refreshMarketQuotes(false);
  renderManageHoldings();
  switchTab('tab-dashboard');
}

function deleteHolding(id) {
  const item = appState.holdings.find(h => h.id === id);
  const sym = item ? item.symbol : '銘柄';
  if (confirm(`${sym} をポートフォリオから削除しますか？`)) {
    appState.holdings = appState.holdings.filter(h => h.id !== id);
    saveHoldings();
    renderManageHoldings();
    renderDashboard();
    showToast(`${sym} を削除しました`);
  }
}

// --- JSON Backup & Restore ---
function exportJSON() {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    settings: {
      baseCurrency: appState.settings.baseCurrency,
      usdjpyRate: appState.settings.usdjpyRate
    },
    holdings: appState.holdings
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `portfolio_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('JSONファイルを書き出しました');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (parsed && Array.isArray(parsed.holdings)) {
        appState.holdings = parsed.holdings;
        if (parsed.settings) {
          if (parsed.settings.baseCurrency) appState.settings.baseCurrency = parsed.settings.baseCurrency;
          if (parsed.settings.usdjpyRate) appState.settings.usdjpyRate = parsed.settings.usdjpyRate;
          saveSettings();
        }
        saveHoldings();
        refreshMarketQuotes(true);
        renderManageHoldings();
        showToast(`${parsed.holdings.length}件の銘柄データを読み込みました`);
        switchTab('tab-dashboard');
      } else {
        alert('有効なポートフォリオJSON形式ではありません。');
      }
    } catch (err) {
      alert('JSONの解析に失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// --- Settings Operations ---
function loadSettingsToForm() {
  const keyEl = document.getElementById('input-api-key');
  const baseCurEl = document.getElementById('select-base-currency');
  const rateEl = document.getElementById('input-usdjpy-rate');
  if (keyEl) keyEl.value = appState.settings.apiKey || '';
  if (baseCurEl) baseCurEl.value = appState.settings.baseCurrency || 'JPY';
  if (rateEl) rateEl.value = appState.settings.usdjpyRate || 155.0;
}

function saveApiKey() {
  const keyInput = document.getElementById('input-api-key');
  if (!keyInput) return;
  const key = keyInput.value.trim();
  appState.settings.apiKey = key;
  saveSettings();
  showToast('APIキーを保存しました');
  refreshMarketQuotes(true);
}

function toggleKeyVisibility() {
  const input = document.getElementById('input-api-key');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function saveCurrencySettings() {
  const baseCur = document.getElementById('select-base-currency').value;
  const rate = parseFloat(document.getElementById('input-usdjpy-rate').value) || 155.0;
  appState.settings.baseCurrency = baseCur;
  appState.settings.usdjpyRate = rate;
  saveSettings();
  showToast('通貨設定を保存しました');
  renderDashboard();
}

function clearCache() {
  appState.cache = { timestamp: 0, quotes: {} };
  saveCache();
  showToast('キャッシュを消去しました');
  refreshMarketQuotes(true);
}

function resetToSample() {
  if (confirm('サンプルデータ（SPY, VOO, VT, QQQ, 1306）に初期化しますか？')) {
    appState.holdings = [...INITIAL_HOLDINGS];
    appState.cache = { timestamp: Date.now(), quotes: { ...DEMO_QUOTES } };
    saveHoldings();
    saveCache();
    showToast('サンプルデータを復元しました');
    renderDashboard();
    renderManageHoldings();
  }
}

function clearAllData() {
  if (confirm('すべてのポートフォリオ情報と設定を完全に消去しますか？この操作は取り消せません。')) {
    localStorage.removeItem(STORAGE_KEYS.HOLDINGS);
    localStorage.removeItem(STORAGE_KEYS.CACHE);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    appState.holdings = [];
    appState.cache = { timestamp: 0, quotes: {} };
    appState.settings = { ...DEFAULT_SETTINGS };
    showToast('全データを消去しました');
    renderDashboard();
    renderManageHoldings();
  }
}

// --- Page Focus & Auto-Refresh Listener ---
function setupLifecycleListeners() {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - (appState.cache.timestamp || 0) >= CACHE_TTL_MS) {
        refreshMarketQuotes(false);
      }
    }
  });

  window.addEventListener('focus', () => {
    const now = Date.now();
    if (now - (appState.cache.timestamp || 0) >= CACHE_TTL_MS) {
      refreshMarketQuotes(false);
    }
  });

  const updateOnlineStatus = () => {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.style.display = !navigator.onLine ? 'block' : 'none';
  };
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

// --- PWA Service Worker Registration ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('PWA ServiceWorker registered:', reg.scope))
      .catch(err => console.log('ServiceWorker registration skipped/failed:', err.message));
  }
}

// Expose globals for onclick handlers
window.switchTab = switchTab;
window.selectQuickSymbol = selectQuickSymbol;
window.deleteHolding = deleteHolding;

// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  setupLifecycleListeners();

  const addForm = document.getElementById('form-add-symbol');
  if (addForm) addForm.addEventListener('submit', addHolding);

  const refreshBtn = document.getElementById('btn-manual-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshMarketQuotes(true));

  const gotoAddBtn = document.getElementById('btn-goto-add');
  if (gotoAddBtn) gotoAddBtn.addEventListener('click', () => switchTab('tab-manage'));

  const exportBtn = document.getElementById('btn-export-json');
  if (exportBtn) exportBtn.addEventListener('click', exportJSON);

  const importFile = document.getElementById('file-import-json');
  if (importFile) importFile.addEventListener('change', importJSON);

  const saveKeyBtn = document.getElementById('btn-save-api-key');
  if (saveKeyBtn) saveKeyBtn.addEventListener('click', saveApiKey);

  const toggleKeyBtn = document.getElementById('btn-toggle-key-visibility');
  if (toggleKeyBtn) toggleKeyBtn.addEventListener('click', toggleKeyVisibility);

  const saveCurBtn = document.getElementById('btn-save-currency-settings');
  if (saveCurBtn) saveCurBtn.addEventListener('click', saveCurrencySettings);

  const clearCacheBtn = document.getElementById('btn-clear-cache');
  if (clearCacheBtn) clearCacheBtn.addEventListener('click', clearCache);

  const resetSampleBtn = document.getElementById('btn-reset-sample');
  if (resetSampleBtn) resetSampleBtn.addEventListener('click', resetToSample);

  const clearAllBtn = document.getElementById('btn-clear-all');
  if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllData);

  renderDashboard();
  registerServiceWorker();
});
