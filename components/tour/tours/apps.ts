import type { TourDefinition } from "../types"

// The apps list, an app's page, and one short tour per tab. The app page's
// tour plays together with the tour of whichever tab is open.

export const APPS_TOURS: TourDefinition[] = [
  {
    id: "apps",
    version: 1,
    title: "Apps & keys",
    steps: [
      {
        title: "Apps & keys",
        body: "An app is one project that calls the gateway, like a website, a script or a bot. Each app has its own API keys, budget, rate limits and model chains, so one project can't use up another's allowance and you can see what each one costs.",
      },
      {
        target: "apps-empty",
        side: "top",
        title: "Create your first app",
        body: "Give it a name (the slug is filled in for you). You'll land on its page, where you create an API key and get copy-paste code for your language.",
      },
      {
        target: "page-actions",
        side: "bottom",
        align: "end",
        title: "New app",
        body: "Create another app. One per project keeps keys, limits and costs separate, and lets you switch one off without affecting the others.",
      },
      {
        target: "apps-table",
        side: "top",
        title: "Your apps",
        body: "Every app you can manage, with its keys and the last 30 days of traffic. Admins see everyone's apps here, with an <b>Owner</b> column.",
      },
      {
        target: "apps-status",
        side: "bottom",
        title: "Enabled or disabled",
        body: "A disabled app's keys are refused straight away, without being revoked, so you can pause a project and switch it back on later.",
      },
      {
        target: "apps-usage-columns",
        side: "bottom",
        title: "Requests and spend",
        body: "How many requests the app made in the last 30 days and what they cost, using the prices set on each model. Free models count as $0.",
      },
      {
        target: "apps-open",
        side: "right",
        title: "Open an app",
        body: "Click a name to manage its keys, model chains, limits and settings, and to get code for calling it.",
      },
    ],
  },
  {
    id: "app",
    version: 1,
    title: "App",
    steps: [
      {
        title: "An app's control panel",
        body: "Everything about this project is on this page, split into tabs. Each tab has a short tour too: open the tab, then click the compass at the top right.",
      },
      {
        target: "page-actions",
        side: "bottom",
        align: "end",
        title: "On or off",
        body: "Switch the whole app off and every one of its keys is refused at once (clients get an error), without deleting anything. Switch it back on to resume.",
      },
      {
        target: "app-tabs",
        side: "bottom",
        title: "The tabs",
        body: "<b>Keys</b> to create and revoke API keys, <b>Models</b> for named model chains, <b>Settings</b> for budgets, limits and protections, <b>Usage</b> for what it has cost, <b>Integrate</b> for ready-to-paste code, and <b>Danger zone</b> to delete the app.",
      },
    ],
  },
  {
    id: "app-keys",
    version: 1,
    title: "API keys",
    steps: [
      {
        target: "app-create-key",
        side: "bottom",
        align: "end",
        title: "Create a key",
        body: "Your code sends this key as a Bearer token (or <code>x-api-key</code>). Make one per environment or machine, so you can revoke one without breaking the others. You can set an expiry and limits for just that key.",
      },
      {
        target: "app-keys-empty",
        side: "top",
        title: "No keys yet",
        body: "This app can't be called until it has a key. The full key is shown only once, right after you create it; only a fingerprint is stored, so copy it somewhere safe.",
      },
      {
        target: "app-keys-table",
        side: "top",
        title: "Keys",
        body: "Each key shows its first and last characters, who created it, when it was last used, and when it expires. If a key leaks, revoke it here and create a new one.",
      },
      {
        target: "app-keys-limits",
        side: "bottom",
        title: "Per-key limits",
        body: "A key can have its own requests per minute, tokens per minute and monthly budget, on top of the app's. Useful for giving a teammate or a script a smaller allowance. <b>App limits</b> means it only follows the app's.",
      },
      {
        target: "app-key-actions",
        side: "left",
        title: "Limits and revoke",
        body: "<b>Limits</b> changes this key's allowance (it takes effect within 30 seconds). <b>Revoke</b> disables the key for good; clients using it get an error immediately.",
      },
    ],
  },
  {
    id: "app-models",
    version: 1,
    title: "Models and buckets",
    steps: [
      {
        target: "app-buckets",
        side: "top",
        title: "Buckets: named model chains",
        body: 'A bucket is a list of models your code calls by name, like <code>model: "smart"</code>. If the first model fails, is rate-limited or is cooling down, the next one answers, and your app never sees the error. Changes save by themselves and reach API calls within 30 seconds.',
      },
      {
        target: "app-buckets-empty",
        side: "top",
        title: "Create a bucket",
        body: "Click a suggested name, or <b>New bucket</b> for your own. Then add models to it from the table below.",
      },
      {
        target: "app-new-bucket",
        side: "left",
        title: "New bucket",
        body: "Make one per job, for example <code>smart</code> for hard questions, <code>fast</code> for quick ones, <code>free</code> for free-tier models only.",
      },
      {
        target: "app-bucket",
        side: "right",
        title: "A bucket",
        body: "Models are tried top to bottom. Drag cards to reorder them, or drag the handle at the top to reorder buckets. Each card shows price, context size, health, and this month's usage by this app.",
      },
      {
        target: "app-bucket-strategy",
        side: "right",
        title: "Order and hedging",
        body: "<b>Order</b> decides which model goes first: as listed, fastest recently, cheapest, or spread evenly. <b>Hedging</b> starts the next model too if the first is slow; the first answer wins, but you may pay for both.",
      },
      {
        target: "app-bucket-menu",
        side: "left",
        title: "Default bucket",
        body: 'From this menu, make a bucket the <b>default</b>: it answers requests that name no model (or <code>model: "default"</code>). You can also rename or delete it here.',
      },
      {
        target: "app-only-buckets",
        side: "top",
        title: "Lock the app to its buckets",
        body: "On: this app's keys can only call these buckets and the models in them. Off: they can also call any model you're allowed to use by its full name.",
      },
      {
        target: "app-library",
        side: "top",
        title: "Models you can use",
        body: "Every model your account can call, with prices and this app's usage this month. Drag a row onto a bucket, or use <b>Add</b>. Search, or filter by where models come from and by price, to find what you need.",
      },
      {
        target: "app-library-buckets",
        side: "bottom",
        title: "Already in a bucket",
        body: "Shows which of this app's buckets each model is in, so you can spot models you haven't used yet.",
      },
    ],
  },
  {
    id: "app-settings",
    version: 1,
    title: "App settings",
    steps: [
      {
        target: "app-settings-limits",
        side: "bottom",
        title: "Budget and rate limits",
        body: "<b>Monthly budget</b>: requests are refused once this month's spend reaches it. <b>Rate limit</b> and <b>Token limit</b> cap requests and tokens per minute across all the app's keys. Leave any of them empty for no limit.",
      },
      {
        target: "app-settings-cache",
        side: "top",
        title: "Response cache",
        body: "When on, an identical request (same model, messages and settings) gets the saved answer instantly and costs nothing. Good for repeated questions; turn it off if every answer must be fresh.",
      },
      {
        target: "app-settings-pii",
        side: "top",
        title: "Personal data in prompts",
        body: "Finds email addresses, phone numbers, card and bank numbers and API keys. <b>Redact</b> swaps them for placeholders like <code>[EMAIL]</code> before any provider sees them; <b>Block</b> refuses the request instead.",
      },
      {
        target: "app-settings-json",
        side: "top",
        title: "Check structured output",
        body: "When your code asks for JSON (or a JSON schema), the gateway checks the answer. If it isn't valid, the next model in the bucket answers instead.",
      },
      {
        target: "app-settings-payloads",
        side: "top",
        title: "Log full payloads",
        body: "Store each request's prompt and answer for 7 days so you can read them in <b>Logs</b> and replay them in <b>Compare</b>. Leave it off if prompts contain anything sensitive.",
      },
      {
        target: "app-settings-save",
        side: "top",
        align: "end",
        title: "Save",
        body: "Nothing changes until you save. New settings reach API calls within 30 seconds.",
      },
    ],
  },
  {
    id: "app-usage",
    version: 1,
    title: "App usage",
    steps: [
      {
        target: "app-usage-stats",
        side: "bottom",
        title: "The last 30 days",
        body: "Requests, tokens, cost and error rate for this app, across all its keys. The error rate counts requests that failed even after trying the fallbacks.",
      },
      {
        target: "app-usage-budget",
        side: "bottom",
        title: "Budget this month",
        body: "How much of the monthly budget is used (months start on the 1st, UTC). At 100%, the app's requests are refused until next month or until you raise the budget in <b>Settings</b>.",
      },
      {
        target: "app-usage-table",
        side: "top",
        title: "By model",
        body: "The same numbers per model, so you can see which models do the work and which ones cost the most. Errors here are requests that failed even after trying the fallbacks.",
      },
      {
        target: "app-usage-empty",
        side: "top",
        title: "No usage yet",
        body: "Once this app's keys make requests, numbers show up here. Try one from the <b>Integrate</b> tab or the <b>Playground</b>.",
      },
    ],
  },
  {
    id: "app-integrate",
    version: 1,
    title: "Integrate",
    steps: [
      {
        target: "app-integrate-endpoints",
        side: "bottom",
        title: "Endpoints",
        body: "The addresses your code calls. They follow the OpenAI and Anthropic formats, so existing SDKs work: just change the base URL and use your gateway key.",
      },
      {
        target: "app-integrate-quickstart",
        side: "top",
        title: "Ready-to-paste code",
        body: "Working examples for this app, already pointing at this gateway and one of its buckets. Replace the key placeholder with a key from the <b>Keys</b> tab.",
      },
      {
        target: "app-integrate-mode",
        side: "left",
        title: "Full answer or streaming",
        body: "<b>Streaming</b> shows the answer word by word as it's written, which feels much faster in chat apps. Switching to another model on failure still works, as long as nothing has been sent yet.",
      },
      {
        target: "app-integrate-snippets",
        side: "bottom",
        title: "Pick your language",
        body: "OpenAI SDKs for Python and TypeScript, LangChain for Python and JavaScript, Anthropic-compatible tools (Claude Code, the Anthropic SDK), opencode, and plain curl.",
      },
    ],
  },
  {
    id: "app-danger",
    version: 1,
    title: "Danger zone",
    steps: [
      {
        target: "app-delete",
        side: "top",
        title: "Delete the app",
        body: "Deletes the app and all its keys for good; clients using them start getting errors immediately. Past request logs are kept. If you only want to pause it, switch the app off at the top instead.",
      },
    ],
  },
]
