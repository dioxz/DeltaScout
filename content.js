// ── TickProb Content Script ──────────────────────────────────────────────────
// Reads the live last-traded price from TradingView's DOM every 200ms,
// runs tick momentum analysis, and overlays a prediction panel on the chart.

const WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window
const POLL_MS = 200;              // how often to check the price

let ticks = [];         // { price, ts }
let lastSeenPrice = null;
let overlayEl = null;
let pollInterval = null;
let enabled = true;

// ── Price Extraction ─────────────────────────────────────────────────────────
// TradingView renders the last price in a few possible selectors depending
// on layout. We try them in order.
function extractPrice() {
  const selectors = [
    // Main chart header - last price value
    '[data-name="legend-series-item"] [class*="priceValue"]',
    '[class*="lastPrice"]',
    '[class*="price-qWcO4bp9"]',
    // Watchlist / quote panel
    '[class*="lastPrice-"]',
    '[data-field="last_price"] [class*="value"]',
    // Symbol info bar (top of chart)
    '[class*="symbolInfo"] [class*="last"]',
    // Generic fallback - the big price shown in top-left of chart
    '[class*="chart-controls-bar"] [class*="price"]',
    // Data window
    '[class*="currentPrice"]',
  ];

  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const text = el.innerText || el.textContent || "";
      const cleaned = text.replace(/[,$%\s]/g, "");
      const num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // Deep fallback: scan all elements with aria-label containing "price"
  const all = document.querySelectorAll('[aria-label*="price" i], [aria-label*="last" i]');
  for (const el of all) {
    const text = el.innerText || el.textContent || "";
    const cleaned = text.replace(/[,$%\s]/g, "");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

// ── Tick Math ────────────────────────────────────────────────────────────────
function pruneOldTicks() {
  const cutoff = Date.now() - WINDOW_MS;
  ticks = ticks.filter(t => t.ts >= cutoff);
  if (ticks.length > 3000) ticks = ticks.slice(-3000);
}

function calcProb() {
  if (ticks.length < 2) return null;

  const now = Date.now();
  const recent = ticks.filter(t => now - t.ts <= WINDOW_MS);
  if (recent.length < 2) return null;

  let up = 0, down = 0, flat = 0;
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i].price - recent[i - 1].price;
    if (d > 0) up++;
    else if (d < 0) down++;
    else flat++;
  }

  const activeTotal = up + down;
  const pUp = activeTotal > 0 ? up / activeTotal : 0.5;
  const pDown = activeTotal > 0 ? down / activeTotal : 0.5;

  // Last-30s momentum bias
  const recent30 = recent.filter(t => now - t.ts <= 30000);
  let rUp = 0, rDown = 0;
  for (let i = 1; i < recent30.length; i++) {
    const d = recent30[i].price - recent30[i - 1].price;
    if (d > 0) rUp++;
    else if (d < 0) rDown++;
  }
  const rTotal = rUp + rDown;
  const recentBias = rTotal > 0 ? (rUp - rDown) / rTotal : 0;

  // Blended: 60% 5m window + 40% last 30s
  const blendedUp = pUp * 0.6 + (recentBias * 0.5 + 0.5) * 0.4;

  // Streak
  let streak = 0, streakDir = null;
  for (let i = recent.length - 1; i >= 1; i--) {
    const d = recent[i].price - recent[i - 1].price;
    const dir = d > 0 ? "up" : d < 0 ? "down" : null;
    if (!dir) continue;
    if (!streakDir) streakDir = dir;
    if (dir === streakDir) streak++;
    else break;
  }

  // Avg tick size
  const avgMove = recent.slice(1).reduce((a, t, i) => a + Math.abs(t.price - recent[i].price), 0) / (recent.length - 1);
  const lastPrice = recent[recent.length - 1].price;
  const projectedPrice = lastPrice + avgMove * (blendedUp > 0.5 ? 1 : -1);

  return {
    pUp: blendedUp * 100,
    pDown: (1 - blendedUp) * 100,
    up, down, flat,
    total: recent.length,
    streak, streakDir,
    avgMove,
    lastPrice,
    projectedPrice,
    windowSec: Math.round((now - recent[0].ts) / 1000),
  };
}

// ── Overlay UI ───────────────────────────────────────────────────────────────
function createOverlay() {
  if (overlayEl) return;

  overlayEl = document.createElement("div");
  overlayEl.id = "tickprob-overlay";
  overlayEl.innerHTML = `
    <div class="tp-header">
      <span class="tp-logo"><img src="${chrome.runtime.getURL('icon48.png')}" style="height:20px;width:20px;vertical-align:middle;margin-right:6px;border-radius:3px;">Delta<span>Scout</span></span>
      <span class="tp-status" id="tp-status">● READING</span>
      <button class="tp-toggle" id="tp-toggle">−</button>
    </div>
    <div class="tp-body" id="tp-body">
      <div class="tp-direction" id="tp-direction">WAITING</div>

      <div class="tp-arc-wrap">
        <svg id="tp-arc-svg" viewBox="0 0 160 90" width="160" height="90">
          <path d="M 16 80 A 64 64 0 0 1 144 80" fill="none" stroke="#1e1e2e" stroke-width="10" stroke-linecap="round"/>
          <path id="tp-arc-down" d="M 16 80 A 64 64 0 0 1 144 80" fill="none" stroke="#ff4466" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="201 201" stroke-dashoffset="0"/>
          <path id="tp-arc-up" d="M 16 80 A 64 64 0 0 1 144 80" fill="none" stroke="#00ff88" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="0 201" stroke-dashoffset="0"/>
          <text id="tp-pct" x="80" y="76" text-anchor="middle" fill="#e0e0f0" font-size="16" font-weight="900" font-family="monospace">—</text>
          <text x="80" y="88" text-anchor="middle" fill="#555570" font-size="7" font-family="monospace" letter-spacing="2">UP PROB</text>
          <text x="10" y="88" text-anchor="middle" fill="#ff4466" font-size="7" font-family="monospace" id="tp-pdown-label">—</text>
          <text x="150" y="88" text-anchor="middle" fill="#00ff88" font-size="7" font-family="monospace" id="tp-pup-label">—</text>
        </svg>
      </div>

      <div class="tp-grid">
        <div class="tp-stat up">
          <div class="tp-stat-val" id="tp-up">0</div>
          <div class="tp-stat-label">UP</div>
        </div>
        <div class="tp-stat down">
          <div class="tp-stat-val" id="tp-down">0</div>
          <div class="tp-stat-label">DOWN</div>
        </div>
        <div class="tp-stat flat">
          <div class="tp-stat-val" id="tp-flat">0</div>
          <div class="tp-stat-label">FLAT</div>
        </div>
        <div class="tp-stat neutral">
          <div class="tp-stat-val" id="tp-total">0</div>
          <div class="tp-stat-label">TOTAL</div>
        </div>
      </div>

      <div class="tp-prices">
        <div class="tp-price-row">
          <span class="tp-label">LAST</span>
          <span class="tp-val" id="tp-last">—</span>
        </div>
        <div class="tp-price-row">
          <span class="tp-label">PROJECTED</span>
          <span class="tp-val accent" id="tp-proj">—</span>
        </div>
        <div class="tp-price-row">
          <span class="tp-label">AVG MOVE</span>
          <span class="tp-val muted" id="tp-avg">—</span>
        </div>
      </div>

      <div id="tp-streak" class="tp-streak" style="display:none"></div>

      <div class="tp-bar-wrap">
        <div class="tp-bar-track">
          <div class="tp-bar-fill" id="tp-bar"></div>
          <div class="tp-bar-mid"></div>
        </div>
        <div class="tp-bar-labels">
          <span style="color:#ff4466">↓ BEAR</span>
          <span>50%</span>
          <span style="color:#00ff88">BULL ↑</span>
        </div>
      </div>

      <div class="tp-window" id="tp-window">5m window · 0 ticks · 0s</div>
    </div>
  `;

  document.body.appendChild(overlayEl);

  // Toggle collapse
  let collapsed = false;
  document.getElementById("tp-toggle").addEventListener("click", () => {
    collapsed = !collapsed;
    document.getElementById("tp-body").style.display = collapsed ? "none" : "block";
    document.getElementById("tp-toggle").textContent = collapsed ? "+" : "−";
  });

  // Make draggable
  makeDraggable(overlayEl);
}

function makeDraggable(el) {
  let ox = 0, oy = 0, mx = 0, my = 0;
  const header = el.querySelector(".tp-header");
  header.style.cursor = "move";
  header.addEventListener("mousedown", (e) => {
    e.preventDefault();
    mx = e.clientX; my = e.clientY;
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", stopDrag);
  });
  function drag(e) {
    ox = mx - e.clientX; oy = my - e.clientY;
    mx = e.clientX; my = e.clientY;
    el.style.top = (el.offsetTop - oy) + "px";
    el.style.left = (el.offsetLeft - ox) + "px";
    el.style.right = "auto";
  }
  function stopDrag() {
    document.removeEventListener("mousemove", drag);
    document.removeEventListener("mouseup", stopDrag);
  }
}

function updateOverlay(prob, price) {
  if (!overlayEl) return;

  const arcCircumference = 201;

  if (!prob) {
    document.getElementById("tp-direction").textContent = "WAITING";
    document.getElementById("tp-direction").className = "tp-direction neutral";
    document.getElementById("tp-status").textContent = price ? "● READING" : "○ SCANNING";
    document.getElementById("tp-pct").textContent = "—";
    return;
  }

  const { pUp, pDown, up, down, flat, total, streak, streakDir, avgMove, lastPrice, projectedPrice, windowSec } = prob;

  // Direction
  const dirEl = document.getElementById("tp-direction");
  if (pUp > 58) { dirEl.textContent = "BULLISH"; dirEl.className = "tp-direction bull"; }
  else if (pDown > 58) { dirEl.textContent = "BEARISH"; dirEl.className = "tp-direction bear"; }
  else { dirEl.textContent = "NEUTRAL"; dirEl.className = "tp-direction neutral"; }

  // Arc
  const upStroke = (pUp / 100) * arcCircumference;
  document.getElementById("tp-arc-up").setAttribute("stroke-dasharray", `${upStroke} ${arcCircumference}`);
  document.getElementById("tp-pct").textContent = pUp.toFixed(1) + "%";
  document.getElementById("tp-pup-label").textContent = pUp.toFixed(0) + "%↑";
  document.getElementById("tp-pdown-label").textContent = pDown.toFixed(0) + "%↓";

  // Stats
  document.getElementById("tp-up").textContent = up;
  document.getElementById("tp-down").textContent = down;
  document.getElementById("tp-flat").textContent = flat;
  document.getElementById("tp-total").textContent = total;

  // Prices
  const fmt = (n) => n < 1 ? n.toFixed(5) : n < 100 ? n.toFixed(3) : n.toFixed(2);
  document.getElementById("tp-last").textContent = fmt(lastPrice);
  const projEl = document.getElementById("tp-proj");
  projEl.textContent = fmt(projectedPrice);
  projEl.style.color = pUp > 50 ? "#00ff88" : "#ff4466";
  document.getElementById("tp-avg").textContent = avgMove.toFixed(6);

  // Streak
  const streakEl = document.getElementById("tp-streak");
  if (streak > 2) {
    streakEl.style.display = "block";
    streakEl.textContent = `${streak} consecutive ${streakDir?.toUpperCase()} ticks`;
    streakEl.className = `tp-streak ${streakDir}`;
  } else {
    streakEl.style.display = "none";
  }

  // Bar
  document.getElementById("tp-bar").style.width = `${pUp}%`;

  // Window info
  document.getElementById("tp-window").textContent = `5m window · ${total} ticks · ${windowSec}s`;

  // Status
  document.getElementById("tp-status").textContent = "● LIVE";
}

// ── Poll Loop ────────────────────────────────────────────────────────────────
function poll() {
  if (!enabled) return;

  const price = extractPrice();

  if (price !== null && price !== lastSeenPrice) {
    lastSeenPrice = price;
    pruneOldTicks();
    ticks.push({ price, ts: Date.now() });
  }

  const prob = calcProb();
  updateOverlay(prob, price);
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  // Wait for TradingView chart to fully render
  const waitForChart = setInterval(() => {
    const hasChart = document.querySelector('[class*="chart-controls-bar"], [class*="layout__area--center"], canvas');
    if (hasChart) {
      clearInterval(waitForChart);
      createOverlay();
      pollInterval = setInterval(poll, POLL_MS);
    }
  }, 500);
}

// Listen for enable/disable from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SET_ENABLED") {
    enabled = msg.value;
    if (!enabled) {
      document.getElementById("tp-status").textContent = "○ PAUSED";
      document.getElementById("tp-direction").textContent = "PAUSED";
    }
  }
  if (msg.type === "RESET") {
    ticks = [];
    lastSeenPrice = null;
  }
});

init();
