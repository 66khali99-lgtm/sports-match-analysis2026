NEON MATCH INTELLIGENCE
=======================

Updated version of Sports Match Analysis.

WHAT CHANGED
- Neon professional responsive interface.
- Dynamic team directory instead of a small hard-coded list.
- Search/autocomplete with club crests.
- Flashscore-style display aliases for major clubs (for example Manchester Utd, Atl. Madrid, AS Roma, Inter, PSG, Dortmund, FC Porto, Sporting CP).
- More recent matches used by the prediction model (up to 15 fetched, 12 weighted).
- Home/away scoring split and form weighting.
- Improved confidence and prediction calculations.
- Save analysis locally in the browser.
- Keeps the API key on the server side; use FOOTBALL_DATA_API_KEY in production.

RUN LOCALLY
1. Install Node.js 18+.
2. Set FOOTBALL_DATA_API_KEY if needed.
3. Run: node server.js
4. Open: http://localhost:3000

DEPLOY
Render/Railway/etc.: start command = node server.js
Environment variable: FOOTBALL_DATA_API_KEY=YOUR_KEY

DATA NOTE
The app uses football-data.org as its machine-readable source. Flashscore is used as the reference for familiar club display naming; it is not scraped or used as the underlying API.
Flashscore currently advertises coverage of 1000+ football competitions from 90+ countries, while this app's exact team coverage depends on the competitions and teams exposed by the configured football-data.org API plan.
