# DeltaScout
Live tick momentum analyzer for TradingView — Chrome Extension Reads the real-time last-traded price directly from TradingView, counts up and down ticks over a rolling 5-minute window, and calculates the probability that the next tick will go up or down. No indicators. No lagging candles. Just raw tick momentum.

What it does

Most retail tools analyze candles. Candles are already old data by the time they render. DeltaScout skips the chart and goes straight to the source — the last-traded price updating live in the TradingView DOM — and builds a probabilistic model from pure tick flow.

Every 200ms it reads the current price. If it changed, that’s a new tick. Over a 5-minute rolling window it tracks:

- How many ticks moved up
- How many ticks moved down
- How many were flat

From that it calculates a blended directional probability: *60% weight on the full 5-minute tick ratio, **40% weight on the last 30 seconds* to capture short-term momentum shifts. The result is a live % chance that the next tick goes up or down, updating in real time as the market moves.

## Note 
### This is a lightweight version of the full system, which is why it runs as a browser extension instead of a standalone platform. The full version is still in development, so this build focuses on delivering the core functionality in a fast, accessible way while the main architecture is being worked on.

## Features

- *Live tick reading* from TradingView’s DOM at 200ms intervals
- *5-minute rolling window* — old ticks drop off automatically
- *Blended probability model* — full window + recent 30s momentum bias
- *Streak detection* — alerts you when you’re on 3+ consecutive ticks in the same direction
- *Projected next price* — estimated based on average tick size and current directional bias
- *Visual probability arc* — at-a-glance bull/bear gauge
- *Tick tape* — live feed of the last ticks with direction arrows
- *Draggable overlay* — place it anywhere on your TradingView chart
- *Collapsible panel* — hide it when you need the full chart
- *Pause / Resume / Reset* from the extension popup

## Installation

This extension is not on the Chrome Web Store YET. Install it manually in Developer Mode:

1. Download or clone this repository
2. Open Chrome and navigate to chrome://extensions
3. Enable *Developer mode* using the toggle in the top right
4. Click *Load unpacked*
5. Select the deltascout-extension folder
6. Open any TradingView chart at [tradingview.com/chart](https://www.tradingview.com/chart/)
7. The DeltaScout overlay appears automatically in the top-right corner of the chart

## How to use

Once installed and TradingView is open:

- The overlay starts reading ticks immediately — no setup needed
- Watch the *probability arc* and *BULLISH / BEARISH / NEUTRAL* signal update live
- *UP / DOWN / FLAT* counters show the raw tick breakdown for the current 5-minute window
- *PROJECTED* price shows where the next tick is estimated to land based on current bias and average move size
- If a streak of 3+ consecutive ticks fires in one direction, the streak badge appears
- Drag the panel anywhere on the chart by clicking and holding the header
- Click *−* to collapse the panel, *+* to expand it
- Use the extension popup (click the toolbar icon) to pause analysis or reset the tick history

## How the probability is calculated

1. Every 200ms: read last-traded price from TradingView DOM
2. If price changed from last read: log tick as UP, DOWN, or FLAT
3. Drop any ticks older than 5 minutes
4. Count UP and DOWN ticks (exclude FLAT from directional calculation)
5. 5m probability = UP / (UP + DOWN)
6. Last-30s bias = (recentUP - recentDOWN) / (recentUP + recentDOWN)
7. Blended probability = (5m_prob × 0.6) + ((bias × 0.5 + 0.5) × 0.4)
8. Projected price = last_price ± avg_tick_size based on blended direction

The streak counter scans backwards from the most recent tick and counts how many consecutive ticks went in the same direction without interruption.

## Limitations

- *TradingView DOM dependency* — TradingView occasionally updates their CSS class names. If the overlay shows SCANNING and never picks up a price, the DOM selector may need updating in content.js.
- *No broker connection* — DeltaScout reads the displayed price only. It does not connect to any exchange feed or API.
- *Past tick ratios are not a guarantee* — a 70% up probability means 70 out of the last N ticks went up. It does not guarantee the next tick goes up. Markets can flip instantly on news, large orders, or volatility spikes.
- *Flat market behavior* — in very low volatility periods with many flat ticks, the probability will hover near 50% and signal NEUTRAL. This is correct behavior, not a bug.

## Disclaimer

DeltaScout is an educational and analytical tool. It does not constitute financial advice. Past tick ratios do not predict future price movement. Use at your own risk.


## License

MIT License. Free to use, modify, and distribute.

Built for traders who want to see what the price is actually doing, not what a 14-period RSI thinks it might do.


