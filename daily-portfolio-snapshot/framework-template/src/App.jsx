import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getStoredPortfolio, saveStoredPortfolio, getStoredSettings, saveStoredSettings, getStoredCache, saveStoredCache } from './services/storage';
import { fetchQuote, DEMO_QUOTES, getSymbolCurrency } from './services/twelveData';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [portfolio, setPortfolio] = useState(getStoredPortfolio);
  const [settings, setSettings] = useState(getStoredSettings);
  const [cache, setCache] = useState(getStoredCache);
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Simulation controls
  const [simYears, setSimYears] = useState(20);
  const [simRate, setSimRate] = useState(0.04);

  // Form states
  const [newSymbol, setNewSymbol] = useState('');
  const [newQty, setNewQty] = useState('0');
  const [newMonthly, setNewMonthly] = useState('0');
  const [newCostPrice, setNewCostPrice] = useState('');
  const [newStartMonth, setNewStartMonth] = useState('');
  const [newMemo, setNewMemo] = useState('');
  const [newIsNisa, setNewIsNisa] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey || '');

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2800);
  }, []);

  const formatNum = (num, decimals = 2) => {
    if (num === null || isNaN(num)) return '0.00';
    return Number(num).toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const formatYen = (val) => `¥${formatNum(Math.round(val), 0)}`;

  // Quotes refresh
  const refreshQuotes = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cache.timestamp && (now - cache.timestamp < CACHE_TTL_MS) && Object.keys(cache.quotes).length > 0) {
      return;
    }
    setLoading(true);
    const symbols = [...new Set(portfolio.map(h => h.symbol.toUpperCase()))];
    const newQuotes = { ...cache.quotes };

    try {
      if (!settings.apiKey || settings.apiKey === 'YOUR_API_KEY' || !navigator.onLine) {
        symbols.forEach(sym => {
          if (DEMO_QUOTES[sym]) newQuotes[sym] = { ...DEMO_QUOTES[sym] };
        });
        showToast(navigator.onLine ? 'デモ相場データを適用しました' : 'オフラインのためキャッシュを表示');
      } else {
        showToast('Twelve Dataから最新相場を取得中...');
        const results = await Promise.all(symbols.map(s => fetchQuote(s, settings.apiKey).catch(() => null)));
        results.forEach(q => { if (q) newQuotes[q.symbol] = q; });
        showToast('保存しました');
      }
      const updatedCache = { timestamp: now, quotes: newQuotes };
      setCache(updatedCache);
      saveStoredCache(updatedCache);
    } catch {
      showToast('読み込みに失敗しました。ネットワークを確認してください');
    } finally {
      setLoading(false);
    }
  }, [cache, portfolio, settings.apiKey, showToast]);

  useEffect(() => {
    const handleFocus = () => {
      if (Date.now() - (cache.timestamp || 0) >= CACHE_TTL_MS) refreshQuotes(false);
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [cache.timestamp, refreshQuotes]);

  // Totals & Enriched List
  const totals = useMemo(() => {
    const rate = parseFloat(settings.usdjpyRate) || 155.0;
    let grandTotalJPY = 0, prevGrandTotalJPY = 0, nisaTotalJPY = 0, taxableTotalJPY = 0, monthlyTotalJPY = 0, totalEstShares = 0;

    const list = portfolio.map(item => {
      const sym = item.symbol.toUpperCase();
      const q = cache.quotes[sym] || DEMO_QUOTES[sym] || { close: 0, previous_close: 0, change: 0, percent_change: 0, currency: getSymbolCurrency(sym) };
      const qty = parseFloat(item.qty) || 0;
      const monthly = parseFloat(item.monthly) || 0;
      const isNISA = Boolean(item.isNISA);

      const priceInJPY = q.currency === 'USD' ? q.close * rate : q.close;
      const prevPriceInJPY = q.currency === 'USD' ? q.previous_close * rate : q.previous_close;

      const currentValJPY = qty * priceInJPY;
      const prevValJPY = qty * prevPriceInJPY;
      const diffJPY = currentValJPY - prevValJPY;
      const percentDiff = prevValJPY > 0 ? (diffJPY / prevValJPY) * 100 : q.percent_change;
      const estShares = priceInJPY > 0 ? (monthly / priceInJPY) : 0;

      grandTotalJPY += currentValJPY;
      prevGrandTotalJPY += prevValJPY;
      if (isNISA) nisaTotalJPY += currentValJPY;
      else taxableTotalJPY += currentValJPY;
      monthlyTotalJPY += monthly;
      totalEstShares += estShares;

      return { ...item, name: q.name || item.symbol, quoteCurrency: q.currency, close: q.close, previous_close: q.previous_close, priceInJPY, currentValJPY, diffJPY, percentDiff, estShares };
    });

    const grandDiffJPY = grandTotalJPY - prevGrandTotalJPY;
    const grandPercentDiff = prevGrandTotalJPY > 0 ? (grandDiffJPY / prevGrandTotalJPY) * 100 : 0;
    return { list, grandTotalJPY, prevGrandTotalJPY, grandDiffJPY, grandPercentDiff, nisaTotalJPY, taxableTotalJPY, monthlyTotalJPY, totalEstShares };
  }, [portfolio, cache.quotes, settings.usdjpyRate]);

  // Future Compound Projection
  const simResults = useMemo(() => {
    const calc = (init, monthly, r, y) => {
      const mr = r / 12;
      const fvInitial = init * Math.pow(1 + r, y);
      const fvMonthly = mr > 0 ? monthly * (Math.pow(1 + mr, 12 * y) - 1) / mr : monthly * 12 * y;
      const futureValue = fvInitial + fvMonthly;
      const principal = init + (monthly * 12 * y);
      return { futureValue, principal, gains: Math.max(0, futureValue - principal) };
    };

    const nisaMonthly = totals.list.filter(h => h.isNISA).reduce((s, h) => s + (h.monthly || 0), 0);
    const taxableMonthly = totals.list.filter(h => !h.isNISA).reduce((s, h) => s + (h.monthly || 0), 0);

    const moderate = calc(totals.grandTotalJPY, totals.monthlyTotalJPY, simRate, simYears);
    const optimistic = calc(totals.grandTotalJPY, totals.monthlyTotalJPY, 0.06, simYears);
    const conservative = calc(totals.grandTotalJPY, totals.monthlyTotalJPY, 0.015, simYears);
    const nisaRes = calc(totals.nisaTotalJPY, nisaMonthly, simRate, simYears);
    const taxRes = calc(totals.taxableTotalJPY, taxableMonthly, simRate, simYears);

    return { moderate, optimistic, conservative, nisaRes, taxRes };
  }, [totals, simRate, simYears]);

  const handleSave = (e) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    const qty = parseFloat(newQty) || 0;
    const monthly = parseFloat(newMonthly) || 0;

    const idx = portfolio.findIndex(p => p.symbol.toUpperCase() === sym);
    let updated;
    if (idx >= 0) {
      updated = [...portfolio];
      updated[idx] = { symbol: sym, qty, monthly, costPrice: parseFloat(newCostPrice) || 0, startMonth: newStartMonth, memo: newMemo, isNISA: newIsNisa };
      showToast(`${sym} を更新しました`);
    } else {
      updated = [...portfolio, { symbol: sym, qty, monthly, costPrice: parseFloat(newCostPrice) || 0, startMonth: newStartMonth, memo: newMemo, isNISA: newIsNisa }];
      showToast('保存しました');
    }
    setPortfolio(updated);
    saveStoredPortfolio(updated);
    setNewSymbol('');
    setNewQty('0');
    setNewMonthly('0');
    setNewMemo('');
    setTab('dashboard');
  };

  const handleDelete = (index) => {
    const item = portfolio[index];
    if (window.confirm(`${item.symbol} を削除しますか？`)) {
      const updated = portfolio.filter((_, i) => i !== index);
      setPortfolio(updated);
      saveStoredPortfolio(updated);
      showToast(`${item.symbol} を削除しました`);
    }
  };

  return (
    <div>
      <header>
        <div className="header-inner">
          <div className="logo-area">
            <div className="logo-icon">▲</div>
            <div>
              <div className="brand-title">今日のポートフォリオスナップショット</div>
              <div className="brand-sub">アカウント不要でローカル保存。NISA対応の月額積立と将来予想を簡単に管理</div>
            </div>
          </div>
        </div>
      </header>

      <main className="container">
        {tab === 'dashboard' && (
          <div className="tab-content active">
            <div className="hero-card">
              <div className="hero-header">
                <div className="hero-title">合計評価額 (前日終値基準)</div>
                <span className="tag-nisa">JPY (¥)</span>
              </div>
              <div className="hero-total-value">{formatYen(totals.grandTotalJPY)}</div>
              <div className="hero-diff-row">
                <div className={`diff-badge ${totals.grandDiffJPY > 0 ? 'gain' : totals.grandDiffJPY < 0 ? 'loss' : 'neutral'}`}>
                  <span>{totals.grandDiffJPY > 0 ? '+' : ''}{formatYen(totals.grandDiffJPY)}</span>
                  <span>({totals.grandDiffJPY > 0 ? '+' : ''}{formatNum(totals.grandPercentDiff, 2)}%)</span>
                </div>
                <div className="hero-substats">前日終値総計: {formatYen(totals.prevGrandTotalJPY)}</div>
              </div>

              <div className="metrics-grid">
                <div className="metric-pill-box">
                  <div className="metric-label"><span className="tag-nisa">NISA</span> 合計</div>
                  <div className="metric-value">{formatYen(totals.nisaTotalJPY)}</div>
                </div>
                <div className="metric-pill-box">
                  <div className="metric-label"><span className="tag-taxable">課税</span> 合計</div>
                  <div className="metric-value">{formatYen(totals.taxableTotalJPY)}</div>
                </div>
                <div className="metric-pill-box">
                  <div className="metric-label">📅 月額積立</div>
                  <div className="metric-value">{formatYen(totals.monthlyTotalJPY)}/月</div>
                </div>
                <div className="metric-pill-box">
                  <div className="metric-label">📈 今月の推定買付</div>
                  <div className="metric-value">{formatNum(totals.totalEstShares, 2)} 口相当</div>
                </div>
              </div>
            </div>

            <div className="section-title-row">
              <h2 className="section-title">保有銘柄一覧 ({totals.list.length}銘柄)</h2>
              <button className="btn btn-primary btn-sm" onClick={() => setTab('manage')}>保有資産を登録</button>
            </div>

            <div className="holdings-list">
              {totals.list.map((h, i) => (
                <div key={i} className="holding-item">
                  <div className="holding-top">
                    <div>
                      <div className="symbol-name">{h.symbol} {h.isNISA ? <span className="tag-nisa">NISA</span> : <span className="tag-taxable">課税</span>}</div>
                      <div className="stock-desc">{h.name}</div>
                    </div>
                    <strong>{formatNum(h.qty, 2)} 口</strong>
                  </div>
                  {h.monthly > 0 && (
                    <div className="monthly-box">
                      <span>積立: {formatYen(h.monthly)}/月</span>
                      <span className="est-shares-animated">今月の推定買付: 約 {formatNum(h.estShares, 2)} 口</span>
                    </div>
                  )}
                  <div className="holding-bottom">
                    <div>終値: {h.quoteCurrency === 'USD' ? `$${formatNum(h.close, 2)}` : formatYen(h.close)}</div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="holding-total-val">{formatYen(h.currentValJPY)}</div>
                      <div className={`holding-diff-tag ${h.diffJPY > 0 ? 'gain' : 'loss'}`}>{h.diffJPY > 0 ? '+' : ''}{formatYen(h.diffJPY)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'simulation' && (
          <div className="tab-content active">
            <div className="card">
              <h2 className="section-title">将来予想（複利シミュレーション）</h2>
              <p className="form-help">年数: {simYears}年後 | 想定利回り: {(simRate*100).toFixed(1)}%</p>
              <div className="sim-pill-group" style={{ margin: '14px 0' }}>
                {[5, 10, 15, 20, 30].map(y => (
                  <span key={y} className={`sim-pill ${simYears === y ? 'active' : ''}`} onClick={() => setSimYears(y)}>{y}年</span>
                ))}
              </div>
              <div className="metrics-grid">
                <div className="metric-pill-box">
                  <div className="metric-label">予想総資産</div>
                  <div className="metric-value" style={{ color: 'var(--gain)' }}>{formatYen(simResults.moderate.futureValue)}</div>
                  <div className="metric-sub">運用益: +{formatYen(simResults.moderate.gains)}</div>
                </div>
                <div className="metric-pill-box">
                  <div className="metric-label"><span className="tag-nisa">NISA</span> 非課税予想</div>
                  <div className="metric-value">{formatYen(simResults.nisaRes.futureValue)}</div>
                </div>
                <div className="metric-pill-box">
                  <div className="metric-label"><span className="tag-taxable">課税</span> 口座予想</div>
                  <div className="metric-value">{formatYen(simResults.taxRes.futureValue)}</div>
                </div>
                <div className="metric-pill-box">
                  <div className="metric-label">累計積立元本</div>
                  <div className="metric-value">{formatYen(simResults.moderate.principal)}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'manage' && (
          <div className="tab-content active">
            <div className="guide-box">
              💡 <strong>個別株ガイド:</strong> 国内株は「7203.T」のように末尾に .T を付けて入力してください。<br />
              月額は金額で入力してください。口数は現在価格で概算表示されます。
            </div>
            <div className="card">
              <h2 className="section-title">保有資産を登録</h2>
              <form onSubmit={handleSave}>
                <div className="form-group">
                  <label className="form-label">シンボル</label>
                  <input type="text" className="form-input" placeholder="例: SPY, 7203.T" value={newSymbol} onChange={e => setNewSymbol(e.target.value)} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">保有数量</label>
                    <input type="number" className="form-input" value={newQty} onChange={e => setNewQty(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">月額積立（円）</label>
                    <input type="number" className="form-input" value={newMonthly} onChange={e => setNewMonthly(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="checkbox-row">
                    <input type="checkbox" checked={newIsNisa} onChange={e => setNewIsNisa(e.target.checked)} />
                    <strong>NISAで保有</strong>
                  </label>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>保存する</button>
              </form>
            </div>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        <button className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>ダッシュボード</button>
        <button className={`nav-btn ${tab === 'simulation' ? 'active' : ''}`} onClick={() => setTab('simulation')}>将来予想</button>
        <button className={`nav-btn ${tab === 'manage' ? 'active' : ''}`} onClick={() => setTab('manage')}>資産登録</button>
        <button className={`nav-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>設定</button>
      </nav>
      {toastMessage && <div className="toast show">{toastMessage}</div>}
    </div>
  );
}
