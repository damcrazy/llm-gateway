import type { TourDefinition } from "../types"

// The Overview tour doubles as the welcome tour: it's the first page anyone
// sees, so it explains the gateway and the sidebar before this page itself.

export const OVERVIEW_TOURS: TourDefinition[] = [
  {
    id: "overview",
    version: 1,
    title: "Welcome and Overview",
    steps: [
      {
        title: "Welcome to your LLM gateway",
        body: "Your apps send every AI request here instead of straight to OpenAI, Anthropic, Gemini and the rest. The gateway picks a model, switches to another one when a provider fails, enforces your limits, and records the cost of every call.<br><br>This short tour shows where things are. Use <b>Next</b> or the arrow keys; press Esc to close it.",
      },
      {
        target: "nav-group-monitor",
        side: "right",
        title: "Monitor: see what's happening",
        body: "Everything about traffic that already happened: <b>Logs</b> for each request, <b>Latency</b> for where time goes, <b>Alerts</b> for problems, the <b>Audit log</b> of changes, and the <b>Playground</b> and <b>Compare</b> to try models before you use them in code.",
      },
      {
        target: "nav-group-configure",
        side: "right",
        title: "Configure: set things up",
        body: "<b>Providers</b> hold API keys for AI services, <b>Models</b> lists what they offer, and <b>Apps &amp; keys</b> is where each of your projects gets its own key, limits and fallback chains. <b>Prompts</b> stores reusable prompts, and <b>Tracing</b> sends requests to Langfuse or OpenTelemetry.",
      },
      {
        target: "nav-group-access",
        side: "right",
        title: "Access: who can use the gateway",
        body: "Only you, as the owner, see this. Add people, make someone an admin, choose which models members may call, and set monthly budgets per person.",
      },
      {
        target: "nav-apps",
        side: "right",
        title: "Start here: create an app",
        body: "Make one app per project (a website, a script, a bot). Each app gets API keys, its own budget and rate limits, and named model chains like <code>smart</code> that your code calls instead of a specific model.",
      },
      {
        target: "tour-button",
        side: "bottom",
        align: "end",
        title: "A tour for every page",
        body: "Every page has a short tour like this one. Click the compass whenever you want the tour of the page you're on. If you'd like each page's tour to start by itself the first time you open it, turn that on in <b>Account &amp; security</b>.",
      },
      {
        target: "alerts-bell",
        side: "bottom",
        align: "end",
        title: "Alerts",
        body: "A red dot means something needs attention: an app close to its budget, a model that keeps failing, or slow responses. Click it for the latest alerts; choose what to be alerted about on the <b>Alerts</b> page.",
      },
      {
        target: "nav-account",
        side: "right",
        align: "end",
        title: "Your account",
        body: "Change your password, add Google sign-in, manage your authenticator apps (two-factor sign-in is required for everyone), and choose whether tours start by themselves.",
      },
      {
        target: "overview-getting-started",
        side: "top",
        title: "Setup checklist",
        body: "There's no traffic yet, so this list shows what's left to set up, in order. Each step ticks itself off as you do it; the highlighted one is next.",
      },
      {
        target: "overview-member-welcome",
        side: "top",
        title: "Your first steps",
        body: "Create an app, give it an API key and pick a model. Once your app sends requests, this page turns into charts of your traffic and spending.",
      },
      {
        target: "overview-health",
        side: "left",
        title: "Health",
        body: "How many providers, models and routes are switched on, and which models are cooling down. A model cools down after errors or rate limits, and requests skip it until it recovers, so your apps keep working.",
      },
      {
        target: "page-actions",
        side: "bottom",
        align: "end",
        title: "Time range",
        body: "Choose the period for every number and chart on this page. Each figure is compared with the period just before it, so you can see whether things are going up or down.",
      },
      {
        target: "overview-kpis",
        side: "bottom",
        title: "Key numbers",
        body: "Requests, tokens, cost, error rate and average latency for the period, with the change from the previous one. A rising error rate usually means a provider is having trouble or a key ran out of credit.",
      },
      {
        target: "overview-charts",
        side: "top",
        title: "Usage over time",
        body: "Requests (successful and failed), cost and tokens per day or hour. Hover a bar for exact values, or switch a chart to a table with the buttons in its corner.",
      },
      {
        target: "overview-breakdown",
        side: "top",
        title: "Where usage comes from",
        body: "The same totals split by model, provider and app, so you can spot which app spends the most or which model fails most often.",
      },
      {
        target: "nav-apps",
        side: "right",
        title: "Next: your apps",
        body: "Open <b>Apps &amp; keys</b> to create an app and its first API key. Its page has copy-paste code for Python, TypeScript, LangChain, curl and more.",
      },
    ],
  },
]
