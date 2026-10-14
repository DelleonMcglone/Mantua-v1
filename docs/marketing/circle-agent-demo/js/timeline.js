/**
 * The storyboard: every scene's absolute start and end (seconds) and the
 * copy it shows. Scenes are mounted by `engine.js`; builders live in
 * `scenes/`. Keep the scene order chronological — the engine relies on it.
 */

export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;

/** Scene list; `type` selects the builder, `from`/`to` are absolute seconds. */
export const SCENES = [
  {
    type: "title",
    from: 0,
    to: 3.4,
    eyebrow: "Introducing",
    title: "Your Circle Sports Agent",
    sub: "A daily brief, an edge, and an agent that acts on it.",
    pan: [26, 40],
  },
  { type: "brief", from: 3.0, to: 13.0 },
  { type: "create", from: 12.6, to: 23.2 },
  { type: "live", from: 22.8, to: 26.6 },
  { type: "chapter", from: 26.2, to: 28.4, label: "Daily Brief", pan: [35, 50] },
  { type: "chapter", from: 28.2, to: 30.4, label: "Automated trading", pan: [50, 65] },
  { type: "chapter", from: 30.2, to: 32.4, label: "Policy-capped risk", pan: [65, 80] },
  { type: "run", from: 32.0, to: 40.4 },
  {
    type: "title",
    from: 40.0,
    to: 43.2,
    eyebrow: "",
    title: "Find Your Edge",
    accent: "Edge",
    sub: "",
    pan: [80, 92],
  },
  { type: "outro", from: 42.8, to: 47.0, pan: [92, 100] },
];

export const DURATION = SCENES[SCENES.length - 1].to;

/** Copy shown inside the chat scenes. */
export const COPY = {
  briefPrompt:
    "Give me my daily briefing: my agent wallet, open positions and P&L, and today's NFL slate with anything worth trading.",
  briefRows: [
    ["Agent wallet", "$212.40 USDC · $25.00 of $25.00 cap left today"],
    ["Open positions", "1 · $18.60 · P&L +$3.10"],
    ["Track record", "+$41.25 realized · 63% win rate (5-3)"],
    ["Policy", "active · max $10.00 per trade"],
  ],
  briefMarkets: [
    ["Sun 1:00 PM", "KC vs BUF · home 58.0%"],
    ["Sun 4:25 PM", "DAL vs PHI · home 47.5%"],
    ["Sun 8:20 PM", "SF vs DET · home 61.0%"],
  ],
  briefText:
    "Wallet healthy, one open position in the green. KC vs BUF is priced 58% home — my model says 64%. That is a 6-point edge worth a look.",
  createPrompt:
    "Every Sunday at 9 AM, run my brief and take $10 YES on any game where the edge is 5+ points",
  createReply: "I can set this up as a recurring workflow that runs under your policy caps.",
  workflowTitle: "Edge Hunter: NFL Sundays",
  steps: [
    ["Trigger", "Every Sunday at 9:00 AM ET, before the first kickoff"],
    ["Run the Daily Brief", "wallet, positions, policy and the slate"],
    ["Analyze every game", "model estimate vs market price"],
    ["If the edge is 5+ points", "Buy $10 YES · within your $10 per-trade cap"],
  ],
  liveTitle: "Edge Hunter: NFL Sundays",
  liveDesc:
    "Every Sunday at 9 AM, runs the brief, analyzes the slate and takes $10 YES where the edge is 5+ points…",
  runSteps: [
    ["Assembling the brief", "wallet $212.40 · cap $25.00 left"],
    ["Analyzing the matchup", "KC vs BUF · estimate 64.0% · market 58.0% · +6.0 pts"],
    ["Simulating the trade", "$10.00 → ~17.1 YES · price impact 0.12% · policy ok"],
    ["Placing the trade", "Bought $10.00 of KC YES · tx 0x3f8c…a91c"],
  ],
  disclaimer:
    "Illustrative demo. Agents trade USDC on Arc within the policy and caps you set. Not investment advice.",
};
