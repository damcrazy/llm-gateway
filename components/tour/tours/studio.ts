import type { TourDefinition } from "../types"

// Tours for Routes (list and one route), Prompts (list and editor) and Tracing.

const ROUTES: TourDefinition = {
  id: "routes",
  version: 1,
  title: "Routes",
  steps: [
    {
      title: "Shared model names",
      body: "Routes are names like <code>smart</code> or <code>fast</code> that any app can send as <code>model</code>. Each one stands for an ordered list of models with automatic failover, so you can switch providers here without changing app code. Only admins manage routes.",
    },
    {
      title: "How a name is matched",
      target: "page-header",
      side: "bottom",
      align: "start",
      body: "When a request names a model, the gateway checks the app's own buckets first, then these routes, then exact model slugs. So an app with its own bucket called <code>smart</code> gets that bucket, and every other app gets the route.",
    },
    {
      title: "No routes yet",
      target: "routes-empty",
      side: "top",
      body: "Start with one or two general names, such as <code>smart</code> for hard tasks and <code>fast</code> for quick, cheap ones. Give each a few models from different providers so one outage doesn't break your apps.",
    },
    {
      title: "Create a route",
      target: "routes-new",
      side: "bottom",
      align: "end",
      body: "<b>New route</b> asks for a name, a kind and a strategy, then opens the route so you can add its models. Choose <b>Chat</b> or <b>Embedding</b> carefully: a route only answers requests of its kind, and the kind can't be changed later.",
    },
    {
      title: "Your routes",
      target: "routes-table",
      side: "top",
      body: "One row per route. <b>Kind</b> says which requests it serves: a chat route can't answer an embeddings call, and the other way round. The description is just a note for people reading this list.",
    },
    {
      title: "Strategy",
      target: "routes-strategy",
      side: "bottom",
      body: "<b>Fallback</b> always starts with the first model and moves down only when it fails or is cooling down. <b>Round robin</b> starts with a different model on each request to spread the load; the rest still act as fallbacks.",
    },
    {
      title: "Target chain",
      target: "routes-targets",
      side: "bottom",
      body: "The models this route tries, in order (the first two are shown). A red <b>No targets</b> badge means every request to this route fails until you add a model.",
    },
    {
      title: "On or off",
      target: "routes-enabled",
      side: "bottom",
      body: "Switch a route off to stop it serving traffic without losing its models or settings. While it's off, requests that name it get an error, so check that no app depends on it first.",
    },
    {
      title: "Open a route",
      target: "routes-name",
      side: "bottom",
      align: "start",
      body: "Click a route's name to choose its models, put them in order and set timeouts. From there, <b>Test</b> sends a real request through it in the Playground.",
    },
  ],
}

const ROUTE: TourDefinition = {
  id: "route",
  version: 1,
  title: "Route",
  steps: [
    {
      title: "One route",
      body: "This page decides what happens when an app sends this route's name as <code>model</code>: which models stand behind it, in what order, and how long to wait for each. Come here to add a fallback, reorder models or tune timeouts.",
    },
    {
      title: "How apps call it",
      target: "route-snippet",
      side: "bottom",
      align: "end",
      body: "Apps put this in the request body, with their own API key. Copy it with the button. If an app has its own bucket with the same name, that app gets its bucket instead of this route.",
    },
    {
      title: "Targets",
      target: "route-targets",
      side: "right",
      align: "start",
      body: "The models behind this route, in the order they're tried. If one errors, times out or is cooling down, the next one answers and the app never sees the failure. With no targets, every request fails.",
    },
    {
      title: "Add a model",
      target: "route-add-model",
      side: "left",
      body: "Search enabled models of this route's kind. Only shared providers are listed, because every app can use a route. Add, reorder or remove as you like; nothing changes for apps until you click <b>Save targets</b>.",
    },
    {
      title: "Target health",
      target: "route-first-target",
      side: "bottom",
      body: "Each target shows its provider, price and features. <b>Cooling down</b> means it failed recently: the gateway moves it to the back and tries it only as a last resort until the cooldown ends. Use the arrows to change the order.",
    },
    {
      title: "Capability coverage",
      target: "route-coverage",
      side: "top",
      body: "Requests that use tool calling, images, structured output and so on only go to targets that support them, so they have fewer fallbacks. A red <b>0/…</b> means no target supports it, and such requests are tried on every target anyway.",
    },
    {
      title: "Strategy",
      target: "route-strategy",
      side: "left",
      body: "<b>Fallback</b> sends every request to the first target and uses the others only when it fails, so the top model gets most of the traffic. <b>Round robin</b> rotates the starting target to spread the load; the rest still back it up.",
    },
    {
      title: "Attempts and timeouts",
      target: "route-limits",
      side: "left",
      body: "<b>Max attempts</b> is how many targets one request may try before the app gets an error. <b>Timeout</b> aborts a call that runs too long; <b>First-token timeout</b> moves on when a stream hasn't started yet. Click <b>Save settings</b> to apply.",
    },
    {
      title: "Test it",
      target: "page-actions",
      side: "bottom",
      align: "end",
      body: "<b>Test</b> opens the Playground with this route picked, so you can send a real request and see which model answered (chat routes only). To pause a route, turn off <b>Enabled</b> in Settings instead of using <b>Delete</b>.",
    },
  ],
}

const PROMPTS: TourDefinition = {
  id: "prompts",
  version: 1,
  title: "Prompts",
  steps: [
    {
      title: "Prompt library",
      body: "Prompts are reusable message templates that your apps call by name. Keeping the wording here lets you improve it, version it and roll it back without redeploying the app.",
    },
    {
      title: "No prompts yet",
      target: "prompts-empty",
      side: "top",
      body: "A prompt is a set of messages with blanks like <code>{{name}}</code>. An app sends the prompt's slug and the values, and the gateway puts the filled-in messages before the app's own.",
    },
    {
      title: "Create a prompt",
      target: "prompts-new",
      side: "bottom",
      body: "<b>New prompt</b> asks for a name and a slug, then opens the editor with a short example to change. The slug is what apps send, so pick one you won't need to rename.",
    },
    {
      title: "Your prompts",
      target: "prompts-table",
      side: "top",
      body: "Most recently changed first. A prompt belongs to the person who made it, and an app can only use prompts from its own owner's library. Admins see everyone's prompts here.",
    },
    {
      title: "Slug",
      target: "prompts-slug",
      side: "bottom",
      body: 'What apps send to use the prompt: <code>"prompt": {"id": "…", "variables": {…}}</code>. The same field works on chat completions, responses and messages requests.',
    },
    {
      title: "Latest version",
      target: "prompts-latest",
      side: "bottom",
      body: "Each save creates a new numbered version, and saved versions never change. That makes it safe to experiment: you can always go back to an older one.",
    },
    {
      title: "What apps get",
      target: "prompts-published",
      side: "bottom",
      body: "<b>Latest</b> means apps always get the newest version, so every save goes live. A number such as <b>v3</b> means that version is published: apps keep getting it until you publish another. A request can still ask for a specific <code>version</code>.",
    },
    {
      title: "Open a prompt",
      target: "prompts-name",
      side: "bottom",
      align: "start",
      body: "Click a prompt's name to edit its messages, save and publish versions, and copy a ready-made request. From there, <b>Try in Compare</b> runs it on several models side by side.",
    },
  ],
}

const PROMPT: TourDefinition = {
  id: "prompt",
  version: 1,
  title: "Prompt editor",
  steps: [
    {
      title: "Prompt editor",
      body: "This is one prompt from your library. Change its messages and defaults, save them as a new version, then choose which version your apps get.",
    },
    {
      title: "Name and slug",
      target: "prompt-details",
      side: "bottom",
      body: "<b>Edit details</b> changes the name, slug and description. Only the slug matters to apps: if you change it, apps still sending the old slug start getting errors.",
    },
    {
      title: "Messages",
      target: "prompt-messages",
      side: "right",
      align: "start",
      body: "The messages apps get before their own. <b>System</b> sets how the model behaves; <b>User</b> and <b>Assistant</b> messages can add context or worked examples. Write <code>{{name}}</code> wherever the app should fill in a value.",
    },
    {
      title: "Variables",
      target: "prompt-variables",
      side: "top",
      body: "Every <code>{{name}}</code> found in the messages. Apps pass a value for each in <code>prompt.variables</code>; a request that leaves one out gets a 400 error naming it.",
    },
    {
      title: "Defaults",
      target: "prompt-defaults",
      side: "top",
      body: "Used only when the request doesn't set them. With a <b>Default model</b> (a bucket, route or model slug), apps can leave out <code>model</code> entirely. Temperature and max tokens are filled in the same way.",
    },
    {
      title: "Save a version",
      target: "prompt-save",
      side: "top",
      body: "Saving creates the next version; saved versions never change. If none is published, apps start getting the new one right away. If one is, they keep it until you publish this one. A short note helps you remember what changed.",
    },
    {
      title: "Versions",
      target: "prompt-versions",
      side: "left",
      align: "start",
      body: "<b>Open</b> loads a version into the editor to review or build on. <b>Publish</b> fixes the version apps get, and <b>Use latest</b> goes back to always serving the newest. A request can still ask for any <code>version</code> by number.",
    },
    {
      title: "Call it from your app",
      target: "prompt-usage",
      side: "left",
      align: "start",
      body: "Copy a curl or Python example with this prompt's slug and variables filled in. Use an API key from an app owned by the prompt's owner. Switch on <b>Ask for version</b> to pin the open version in the example.",
    },
    {
      title: "Try in Compare",
      target: "prompt-compare",
      side: "bottom",
      align: "end",
      body: "Runs the open version on several models side by side, so you can compare answers, speed and cost before apps use it. It uses the saved version, so save your edits first.",
    },
  ],
}

const TRACING: TourDefinition = {
  id: "tracing",
  version: 1,
  title: "Tracing",
  steps: [
    {
      title: "Trace export",
      body: "Tracing sends a record of every request your apps make to Langfuse or an OpenTelemetry collector you already use. Come here to connect one, so you can study cost, latency and errors in that tool.",
    },
    {
      title: "Export status",
      target: "tracing-status",
      side: "bottom",
      body: "When the last trace was sent, or the error if the last export failed. A failure usually means a wrong key, URL or header: fix it, save, and send a test trace.",
    },
    {
      title: "What is sent",
      target: "tracing-what",
      side: "bottom",
      body: "Traces go out after the response, so they add no delay for your apps. They include the model, tokens, cost, timings and errors. Prompts and answers are included only for apps with <b>Log full payloads</b> turned on.",
    },
    {
      title: "Langfuse",
      target: "tracing-langfuse",
      side: "top",
      body: "Each request becomes a Langfuse trace. Choose your region or a self-hosted URL, then paste the public and secret keys from your Langfuse project's <b>Settings → API keys</b>. The secret key is stored encrypted and never shown again.",
    },
    {
      title: "On or off",
      target: "tracing-langfuse-switch",
      side: "left",
      body: "Each destination has its own switch. Turning one off and saving stops sending but keeps the keys you entered, so you can turn it back on later without re-entering them.",
    },
    {
      title: "OpenTelemetry",
      target: "tracing-otel",
      side: "top",
      body: "Sends one span per request to an OTLP/HTTP collector such as Honeycomb, Grafana Cloud, Datadog or Jaeger. Enter its https URL and auth headers as <code>name=value</code>. Headers are stored encrypted; only their names are shown again.",
    },
    {
      title: "Save both",
      target: "tracing-save",
      side: "top",
      align: "end",
      body: "This button saves the Langfuse and OpenTelemetry settings together. The gateway picks up changes within a minute.",
    },
    {
      title: "Send a test trace",
      target: "tracing-test",
      side: "top",
      align: "start",
      body: "Sends a made-up request to every destination you've switched on and saved, then updates the status at the top of the page. Then check that it arrived in Langfuse or your collector.",
    },
  ],
}

export const STUDIO_TOURS: TourDefinition[] = [
  ROUTES,
  ROUTE,
  PROMPTS,
  PROMPT,
  TRACING,
]
