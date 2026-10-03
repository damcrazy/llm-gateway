import type { TourDefinition } from "../types"

// Monitor: Logs, Latency, Alerts, Audit log; and the Playground and Compare.

const logs: TourDefinition = {
  id: "logs",
  version: 1,
  title: "Logs",
  steps: [
    {
      title: "Every request, in one place",
      body: "Each call that went through the gateway is listed here, newest first: from your apps, the Playground and Compare. Come here to see which model answered a request, what it cost, or why it failed.",
    },
    {
      target: "logs-filters",
      title: "Filters",
      side: "bottom",
      align: "start",
      body: "Narrow the list by <b>time range</b> (last hour to 30 days, 24 hours by default), <b>status</b>, <b>app</b> and the model that answered. <b>Dashboard</b> means calls made from the dashboard itself without an app. Filters are kept in the address, so you can bookmark a view.",
    },
    {
      target: "logs-refresh",
      title: "Refresh and reset",
      side: "bottom",
      body: "The list doesn't update by itself. Press refresh to load requests that came in since you opened the page. <b>Reset</b> appears once any filter is set and clears them all.",
    },
    {
      target: "logs-columns",
      title: "What each row shows",
      side: "bottom",
      body: "One row per request: the app, the model asked for (an arrow shows the one that actually answered, if different), provider, status with its HTTP code, tokens in and out, cost and latency. A request's details also show its time to first token: how long until a streamed answer started.",
    },
    {
      target: "logs-tags",
      title: "Tags and privacy badges",
      side: "right",
      body: "Tag badges show what your app sent in the <code>x-gateway-tags</code> header (comma-separated, up to 10). Click a tag in a request's details to filter by it. <b>PII redacted</b> means personal data was replaced before reaching the provider; <b>PII blocked</b> means the request was refused.",
    },
    {
      target: "logs-attempts",
      title: "Attempts and fallbacks",
      side: "left",
      body: "Usually 1. A higher number with a retry icon means a model failed and the gateway tried the next one in the chain. A request's details list each attempt with its error and any cooldown the failing model was put on.",
    },
    {
      target: "logs-pagination",
      title: "Pages",
      side: "top",
      body: "50 requests per page. The count shows how many match your filters in total.",
    },
    {
      target: "logs-empty",
      title: "Nothing to show yet",
      side: "top",
      body: "No requests match these filters in this time range. Try a longer range or <b>Reset</b>. To see one appear, send a message from the <b>Playground</b> or call the gateway with an app's key, then refresh.",
    },
    {
      target: "logs-first-row",
      title: "Open a request",
      side: "bottom",
      body: "Click a row for its details: every upstream attempt, plus the request and response bodies if the app has <b>Log full payloads</b> on (kept 7 days). When the request was stored, <b>Replay in Compare</b> reruns it against other models.",
    },
  ],
}

const latency: TourDefinition = {
  id: "latency",
  version: 1,
  title: "Latency",
  steps: [
    {
      title: "Where the time goes",
      body: "This page splits each call's time into waiting on the AI provider and work the gateway itself adds. Come here when responses feel slow, to see whether the provider or the gateway is the cause. Network time to your app isn't included.",
    },
    {
      target: "latency-controls",
      title: "Time range and app",
      side: "bottom",
      align: "end",
      body: "Pick <b>1h</b>, <b>24h</b> (the default) or <b>7d</b>. When there's more than one app, you can also narrow to a single app. Everything on the page is recalculated for your choice.",
    },
    {
      target: "latency-empty",
      title: "No calls yet",
      side: "top",
      body: "Nothing in this range has a timing breakdown. Pick a longer range, or send a message from the <b>Playground</b> and reload; new calls appear once they finish.",
    },
    {
      target: "latency-tiles",
      title: "The headline numbers",
      side: "bottom",
      body: "Median (the typical call) and 95th percentile (the slowest 5%) for successful calls: total time, time at the provider, and time the gateway added. <b>Gateway share</b> is the gateway's slice of all that time; it should stay small.",
    },
    {
      target: "latency-phases",
      title: "The gateway's own steps",
      side: "top",
      body: "The gateway's time per step, averaged over successful calls. A long <b>Failed attempts</b> bar means models fail before a fallback answers. A long <b>Limits</b> bar is often a requests-per-minute limit, which checks the database on every call.",
    },
    {
      target: "latency-calls",
      title: "Recent calls",
      side: "bottom",
      body: "The latest 50 calls, each drawn as one bar split by colour: provider time, gateway time, and hatched failed attempts. Hover a bar for the exact breakdown, including time to first token for streamed calls.",
    },
    {
      target: "latency-models",
      title: "Compare models",
      side: "top",
      body: "Medians for up to 15 models that answered most often. <b>First token</b> is how long until a streamed answer starts, which is what users feel in chat. If a model is consistently slow, move it lower in your fallback chains or set a <b>Slow responses</b> alert.",
    },
  ],
}

const alerts: TourDefinition = {
  id: "alerts",
  version: 1,
  title: "Alerts",
  steps: [
    {
      title: "Know when something needs you",
      body: "The gateway warns you when a budget runs low, a model keeps failing or responses slow down. Alerts appear in the bell at the top of every page, on this page, and optionally in Slack or Discord.",
    },
    {
      target: "alerts-bell",
      title: "The bell",
      side: "bottom",
      align: "end",
      body: "A red dot with a number means unread alerts. Click it on any page to see the latest ones; they're marked as read when you close it.",
    },
    {
      target: "alerts-list",
      title: "Recent alerts",
      side: "right",
      align: "start",
      body: "Your alerts from the last 90 days, newest first. Unread ones are marked <b>New</b>. Each shows when it fired, what kind it is, the app involved, and whether it reached your webhook.",
    },
    {
      target: "alerts-mark-read",
      title: "Mark all as read",
      side: "bottom",
      align: "end",
      body: "Clears the <b>New</b> marks here and the unread count on the bell.",
    },
    {
      target: "alerts-budget",
      title: "Budget alerts",
      side: "left",
      body: "Fires when an app with a monthly budget, or your own account budget, passes this share (80% by default), and again when it's used up. App budgets are set in each app's settings.",
    },
    {
      target: "alerts-latency",
      title: "Slow responses",
      side: "left",
      body: "Off by default. Pick a threshold to be told when an app's median response time over 15 minutes goes above it. For streamed calls it uses time to first token. At most once an hour per app.",
    },
    {
      target: "alerts-model-down",
      title: "Failing models",
      side: "left",
      body: "On by default. Alerts you when a model fails 3 times in a row or is taken out of rotation, for example after a bad key. Covers your own providers; admins also hear about shared ones.",
    },
    {
      target: "alerts-webhook",
      title: "Send alerts to Slack or Discord",
      side: "left",
      body: "Optional. Paste an incoming-webhook URL (https only) and every alert is also posted there. It's stored encrypted; afterwards only its host is shown, with <b>Replace</b> and <b>Remove</b>.",
    },
    {
      target: "alerts-actions",
      title: "Test, then save",
      side: "top",
      body: "Changes apply only after <b>Save</b>. <b>Send test alert</b> adds a test alert here and in the bell and posts it to your saved webhook. If you've just typed a new URL, it posts only to that URL, so you can check it before saving.",
    },
  ],
}

const audit: TourDefinition = {
  id: "audit",
  version: 1,
  title: "Audit log",
  steps: [
    {
      title: "Who changed what, and when",
      body: "A record of changes made in the dashboard, plus sign-ins and security events such as password changes. Members see their own entries; admins see everyone's. Entries are kept for a year.",
    },
    {
      target: "audit-columns",
      title: "Reading an entry",
      side: "bottom",
      body: "Newest first, 100 at a time. <b>When</b> is relative (hover for the exact time). <b>What</b> is a plain summary; click it to open the app, provider or prompt it's about. <b>Action</b> is the event's exact name, such as <code>account.sign_in</code>. Admins also see <b>Who</b>.",
    },
    {
      target: "audit-details",
      title: "Details",
      side: "left",
      body: "Some entries record more, such as the settings that changed or how someone signed in. Click <b>Details</b> to see it.",
    },
    {
      target: "audit-older",
      title: "Older entries",
      side: "top",
      body: "Loads the next 100 entries, older than the last one shown. Your filters are kept.",
    },
    {
      target: "audit-empty",
      title: "Nothing here yet",
      side: "top",
      body: "Changes to apps, keys, providers, models, routes, people and settings appear here as soon as they're made. If a filter is set, try <b>Everything</b>.",
    },
    {
      target: "audit-person",
      title: "Filter by person",
      side: "bottom",
      body: "Admins only. Pick someone to see just their changes and sign-ins. The list holds everyone in the most recent 500 entries.",
    },
    {
      target: "audit-area",
      title: "Check your security events",
      side: "bottom",
      align: "start",
      body: "Filter by area, such as <b>Apps</b> or <b>API keys</b>. Choose <b>Sign-in &amp; security</b> to review sign-ins and password changes; if you see one that wasn't you, change your password in Account.",
    },
  ],
}

const playground: TourDefinition = {
  id: "playground",
  version: 1,
  title: "Playground",
  steps: [
    {
      title: "Try models before you code",
      body: "Chat with any route or model through the real gateway: routing, fallbacks, cooldowns, limits, cost tracking and logging all apply. Use it to try a model or check a route before wiring it into your app.",
    },
    {
      target: "playground-empty",
      title: "Create an app first",
      side: "top",
      body: "Playground requests run as one of your apps, so its limits apply and usage is logged under it. Create an app, then come back.",
    },
    {
      target: "playground-app",
      title: "Run as",
      side: "right",
      body: "The app this request runs as, exactly like a call with its key: its allowed models, rate limit and budget apply, and usage is logged under it. Admins can also pick <b>No app (unrestricted)</b>.",
    },
    {
      target: "playground-model",
      title: "Route or model",
      side: "right",
      body: "What to call, the same name your app puts in <code>model</code>. A bucket or route can move on to another model when one fails; a single model is called directly, with no fallback. The note underneath says which you picked.",
    },
    {
      target: "playground-system",
      title: "System prompt",
      side: "right",
      body: "Optional instructions sent at the start of every turn, such as a role or tone. Changes apply from your next message.",
    },
    {
      target: "playground-params",
      title: "Temperature and max tokens",
      side: "right",
      body: "Leave blank for the model's defaults. Temperature (0 to 2) sets how varied answers are; lower is more predictable. Max tokens caps the length of each answer.",
    },
    {
      target: "playground-conversation",
      title: "Conversation",
      side: "left",
      align: "start",
      body: "Under each reply: the model that actually answered, its provider, latency, tokens and cost. If a model failed first, a <b>Fell back after…</b> note lists the failed attempts. The full history is sent each turn; <b>Clear</b> starts over.",
    },
    {
      target: "playground-composer",
      title: "Send a message",
      side: "top",
      body: "Type a message and press <b>Send</b> (or ⌘/Ctrl + Enter). Each message is a real request: the provider charges for it, it counts toward the app's limits and budget, and it appears in <b>Logs</b>.",
    },
  ],
}

const compare: TourDefinition = {
  id: "compare",
  version: 1,
  title: "Compare",
  steps: [
    {
      title: "Models side by side",
      body: "Send the same conversation to up to 4 models at once and compare answers, speed and cost. Open it from a request in Logs (<b>Replay in Compare</b>), from a prompt (<b>Try in Compare</b>), or start from scratch here.",
    },
    {
      target: "compare-empty",
      title: "Create an app first",
      side: "top",
      body: "Comparisons run as one of your apps, so its limits apply and usage is logged under it. Create an app, then come back.",
    },
    {
      target: "compare-prefill",
      title: "What was loaded",
      side: "bottom",
      body: "Says where this conversation came from. A replay brings the logged conversation and runs as the same app when you can use it; the answers are new. A prompt brings its saved messages and settings.",
    },
    {
      target: "compare-app",
      title: "Run as",
      side: "bottom",
      align: "start",
      body: "Every model runs as this app, with its allowed models, rate limit and budget, and usage logged under it. Switching apps reloads the model lists and clears any pick the new app can't use.",
    },
    {
      target: "compare-pickers",
      title: "Models to compare",
      side: "bottom",
      body: "Pick up to 4 with <b>Add a model</b>. Buckets and routes use their fallback chain like your app does, so another model may answer; its card then shows which one. Use × to remove one.",
    },
    {
      target: "compare-variables",
      title: "Prompt variables",
      side: "bottom",
      body: "This prompt has <code>{{variables}}</code>. Fill in each one; the values are put into the messages before sending, and the run won't start while one is empty.",
    },
    {
      target: "compare-conversation",
      title: "Conversation",
      side: "top",
      body: "Every model gets exactly these messages. Set each message's role, add <b>User</b>, <b>Assistant</b> or <b>System</b> messages to build a multi-turn chat, and remove ones you don't need. At least one user message is required.",
    },
    {
      target: "compare-results",
      title: "Results",
      side: "top",
      body: "One card per model with its answer, latency, tokens and cost. <b>Fastest</b> and <b>Cheapest</b> mark the winners, and an <b>attempts</b> badge means a fallback happened. Every run also appears in Logs.",
    },
    {
      target: "compare-run",
      title: "Run the comparison",
      side: "top",
      body: "Temperature and max tokens apply to every model; leave them blank for each model's default. <b>Run</b> (or ⌘/Ctrl + Enter) sends to all picked models at once. Each is a real, charged request, and the answers appear below.",
    },
  ],
}

export const MONITOR_TOURS: TourDefinition[] = [
  logs,
  latency,
  alerts,
  audit,
  playground,
  compare,
]
