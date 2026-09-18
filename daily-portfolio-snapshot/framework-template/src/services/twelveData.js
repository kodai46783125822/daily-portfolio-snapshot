export const DEMO_QUOTES = {
  'SPY': { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', close: 564.20, previous_close: 558.10, change: 6.10, percent_change: 1.09, currency: 'USD' },
  'VOO': { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', close: 518.50, previous_close: 512.90, change: 5.60, percent_change: 1.09, currency: 'USD' },
  'VT': { symbol: 'VT', name: 'Vanguard Total World Stock ETF', close: 114.80, previous_close: 114.10, change: 0.70, percent_change: 0.61, currency: 'USD' },
  'QQQ': { symbol: 'QQQ', name: 'Invesco QQQ Trust Series 1', close: 489.10, previous_close: 483.40, change: 5.70, percent_change: 1.18, currency: 'USD' },
  '1306': { symbol: '1306', name: 'NEXT FUNDS TOPIX連動型上場投信', close: 2980.0, previous_close: 2955.0, change: 25.0, percent_change: 0.85, currency: 'JPY' },
  '7203.T': { symbol: '7203.T', name: 'トヨタ自動車 (7203)', close: 2850.5, previous_close: 2800.0, change: 50.5, percent_change: 1.80, currency: 'JPY' }
};

export function getSymbolCurrency(sym) {
  const s = sym.toUpperCase();
  if (s.endsWith('.T') || s === '1306' || /^\d{4}$/.test(s)) {
    return 'JPY';
  }
  return 'USD';
}

export async function fetchQuote(symbol, apiKey) {
  const clean = symbol.trim().toUpperCase();
  if (!apiKey || apiKey === 'YOUR_API_KEY') {
    return DEMO_QUOTES[clean] || {
      symbol: clean,
      name: clean,
      close: getSymbolCurrency(clean) === 'JPY' ? 2500 : 120.0,
      previous_close: getSymbolCurrency(clean) === 'JPY' ? 2480 : 118.5,
      change: getSymbolCurrency(clean) === 'JPY' ? 20 : 1.5,
      percent_change: 0.81,
      currency: getSymbolCurrency(clean)
    };
  }

  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(clean)}&apikey=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error' || data.code) {
      throw new Error(data.message || '銘柄が見つかりませんでした');
    }
    return {
      symbol: data.symbol || clean,
      name: data.name || clean,
      close: parseFloat(data.close) || 0,
      previous_close: parseFloat(data.previous_close) || parseFloat(data.close) || 0,
      change: parseFloat(data.change) || 0,
      percent_change: parseFloat(data.percent_change) || 0,
      currency: data.currency || getSymbolCurrency(clean)
    };
  } catch (err) {
    console.warn(`Quote error for ${symbol}:`, err);
    if (DEMO_QUOTES[clean]) return DEMO_QUOTES[clean];
    throw err;
  }
}
