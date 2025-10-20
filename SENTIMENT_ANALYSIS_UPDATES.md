# Sentiment Analysis Page Updates

## Required Changes for sentiment-analysis.html

### 1. Add Global Variables (after line 376)

```javascript
// Add to existing state object
window.tickerStats = new Map(); // ticker -> analytics stats
```

### 2. Replace loadTickers function (around line 392)

```javascript
async function loadTickers() {
    try {
        // Parse URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const preselectedTickers = urlParams.get('tickers')?.split(',').map(t => t.trim().toUpperCase()) || [];
        const paramDays = urlParams.get('days');
        const paramBase = urlParams.get('base');
        
        // Apply preselected settings
        if (paramDays) {
            const daysToPreset = {
                '1': '24h',
                '7': '7d',
                '30': '30d'
            };
            const preset = daysToPreset[paramDays] || '7d';
            state.timeRange = { preset };
            
            // Update UI
            document.querySelectorAll('.time-range-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.range === preset);
            });
        }
        
        if (paramBase) {
            state.baseCurrency = paramBase.toUpperCase();
            document.querySelectorAll('.currency-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.currency === paramBase.toUpperCase());
            });
        }
        
        // Fetch ticker stats
        const days = paramDays || 7;
        const base = paramBase || 'USD';
        
        const response = await fetch(`/api/analytics/ticker-stats?days=${days}&base=${base}&minMentions=5&includeCorrelation=false`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load tickers');
        }
        
        // Store ticker stats
        window.tickerStats.clear();
        data.stats.forEach(stat => {
            window.tickerStats.set(stat.ticker, stat);
        });
        
        state.availableTickers = data.stats.map(s => s.ticker).sort();
        
        renderTickerCheckboxes();
        
        // Apply preselection
        if (preselectedTickers.length > 0) {
            preselectedTickers.forEach(ticker => {
                const checkbox = document.getElementById(`ticker-${ticker}`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            });
            handleTickerChange();
            
            // Auto-load chart after short delay
            setTimeout(() => {
                if (state.selectedTickers.length > 0) {
                    loadChartData();
                }
            }, 500);
        }
        
        // Restore saved state if no preselection
        if (preselectedTickers.length === 0) {
            restoreState();
        }
        
    } catch (error) {
        showError(`Failed to load tickers: ${error.message}`);
    }
}
```

### 3. Update renderTickerCheckboxes function (around line 415)

```javascript
function renderTickerCheckboxes() {
    const container = document.getElementById('tickerCheckboxes');
    
    // Add sorting controls
    const sortingHTML = `
        <div style="margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
            <label style="font-size: 12px; font-weight: 600;">Sort by:</label>
            <select id="tickerSort" onchange="sortAndRenderTickers()" style="padding: 4px; margin-left: 5px; font-size: 12px;">
                <option value="ticker">Ticker (A-Z)</option>
                <option value="totalMentions">Mentions (High-Low)</option>
                <option value="avgSentiment">Sentiment (High-Low)</option>
                <option value="priceChangePercent">Price Change (High-Low)</option>
                <option value="dataPoints">Data Points (High-Low)</option>
            </select>
            <button class="btn btn-secondary" onclick="showTopNSelector()" style="margin-left: 10px; padding: 4px 8px; font-size: 12px;">
                🏆 Select Top N
            </button>
        </div>
    `;
    
    container.innerHTML = sortingHTML + state.availableTickers.map(ticker => {
        const stats = window.tickerStats.get(ticker);
        const mentions = stats ? stats.totalMentions : 0;
        const dataPoints = stats ? stats.dataPoints : 0;
        const hasData = stats && stats.hasData;
        
        const badgeStyle = hasData ? '' : 'opacity: 0.5; color: #999;';
        
        return `
            <div class="ticker-checkbox" style="${!hasData ? 'opacity: 0.6;' : ''}">
                <input type="checkbox" id="ticker-${ticker}" value="${ticker}" 
                       onchange="handleTickerChange()">
                <label for="ticker-${ticker}">
                    ${ticker}
                    <span style="font-size: 10px; ${badgeStyle}">
                        (${mentions}m, ${dataPoints}d)
                    </span>
                </label>
            </div>
        `;
    }).join('');
}
```

### 4. Add sorting and Top N functions

```javascript
function sortAndRenderTickers() {
    const sortBy = document.getElementById('tickerSort').value;
    
    state.availableTickers.sort((a, b) => {
        if (sortBy === 'ticker') {
            return a.localeCompare(b);
        }
        
        const aStats = window.tickerStats.get(a);
        const bStats = window.tickerStats.get(b);
        
        if (!aStats && !bStats) return 0;
        if (!aStats) return 1;
        if (!bStats) return -1;
        
        const aVal = aStats[sortBy] ?? -Infinity;
        const bVal = bStats[sortBy] ?? -Infinity;
        
        return bVal - aVal; // Descending
    });
    
    renderTickerCheckboxes();
    
    // Restore checkbox states
    state.selectedTickers.forEach(ticker => {
        const checkbox = document.getElementById(`ticker-${ticker}`);
        if (checkbox) checkbox.checked = true;
    });
}

function showTopNSelector() {
    const input = prompt(
        'Select Top N Tickers\n\n' +
        'Format: metric:limit\n' +
        'Metrics: mentions, sentiment, price, dataPoints\n' +
        'Limit: 1-10\n\n' +
        'Examples:\n' +
        '- price:10 (top 10 by price change)\n' +
        '- mentions:5 (top 5 by mentions)',
        'price:10'
    );
    
    if (!input) return;
    
    const parts = input.split(':');
    if (parts.length !== 2) {
        alert('Invalid format. Use metric:limit');
        return;
    }
    
    const metricMap = {
        mentions: 'totalMentions',
        sentiment: 'avgSentiment',
        price: 'priceChangePercent',
        dataPoints: 'dataPoints'
    };
    
    const metric = metricMap[parts[0]] || parts[0];
    const limit = parseInt(parts[1]);
    
    if (isNaN(limit) || limit < 1 || limit > 10) {
        alert('Limit must be between 1 and 10');
        return;
    }
    
    applyTopNSelection(metric, limit);
}

function applyTopNSelection(metric, limit) {
    // Sort tickers by metric
    const sorted = state.availableTickers
        .map(ticker => ({ ticker, stats: window.tickerStats.get(ticker) }))
        .filter(item => item.stats && item.stats.hasData)
        .sort((a, b) => {
            const aVal = a.stats[metric] ?? -Infinity;
            const bVal = b.stats[metric] ?? -Infinity;
            return bVal - aVal;
        })
        .slice(0, limit);
    
    // Clear all checkboxes
    document.querySelectorAll('.ticker-checkbox input').forEach(cb => {
        cb.checked = false;
    });
    
    // Check top N
    sorted.forEach(item => {
        const checkbox = document.getElementById(`ticker-${item.ticker}`);
        if (checkbox) checkbox.checked = true;
    });
    
    handleTickerChange();
}
```

## Testing Checklist

1. **URL Parameters**: Visit `/sentiment-analysis?tickers=BTC,ETH&days=7&base=USD`
   - Should pre-select BTC and ETH
   - Should set time range to 7 days
   - Should set currency to USD
   - Should auto-load chart after 500ms

2. **Ticker List**:
   - Should show badges with mentions and data points
   - Should grey out tickers with no data
   - Sort dropdown should reorder list correctly

3. **Top N Selection**:
   - Should prompt with correct format
   - Should select top N tickers by chosen metric
   - Should auto-update checkboxes and state

4. **Cross-page Navigation**:
   - From Ticker Management, clicking "Open in Chart" should navigate with params
   - Chart should auto-load with pre-selected tickers

## Performance Notes

- The `/api/analytics/ticker-stats` endpoint (without correlation) should be fast (<1s for 100+ tickers)
- Checkbox rendering for 200+ tickers should be instant
- Sorting is client-side and instant

## Additional Polish

- Consider adding a "Clear Selection" button
- Add visual feedback when auto-loading chart from URL params
- Show loading spinner during ticker stats fetch
