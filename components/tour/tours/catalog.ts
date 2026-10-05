import type { TourDefinition } from "../types"

// Models, providers, one provider, and people (superadmin). Admin and member
// views share a tour: steps whose element isn't on screen are skipped.

const models: TourDefinition = {
  id: "models",
  version: 1,
  title: "Models",
  steps: [
    {
      title: "Models",
      body: "Which AI models your apps can call through the gateway, what they cost and what they can do. Each model has a slug, the provider's slug plus the model id (like <code>openai/gpt-4o-mini</code>), that apps send as <code>model</code>. Admins also switch models on and off here.",
    },
    // Admin view
    {
      target: "models-capabilities",
      title: "Capabilities and tags",
      side: "bottom",
      body: "Capabilities record what a model supports, such as tool calling, vision, structured output or PDF input. When a request needs one, the router passes over models that lack it, so keep them accurate. Tags like <code>fast</code> or <code>coding</code> are free-form labels for filtering.",
    },
    // Member view
    {
      target: "models-access",
      title: "Your access",
      side: "bottom",
      body: "This sums up which of the gateway's shared models your account may call (free models only, a chosen list, or all) and any monthly budget across your apps. Only the superadmin can change it. Models from providers you connect yourself are always yours to use.",
    },
    {
      target: "models-routes",
      title: "Routes",
      body: "A route is a named group of models. Send its name as <code>model</code> and the gateway picks one of its models, moving on to the next if that one fails or is rate limited. It's the most reliable choice for apps. <b>Pricing</b> shows whether every model it can reach is free.",
    },
    {
      target: "models-filters",
      title: "Search and filter",
      side: "bottom",
      body: "Search by slug, name, provider or tag, then narrow by provider, capability, tag or kind (chat, embedding, image, speech, transcription or rerank). The count on the right shows how many models match.",
    },
    {
      target: "models-member-filters",
      title: "Search and filter",
      side: "bottom",
      body: "Search by slug, name or provider, or pick one provider from the list. Everything listed is a model you're allowed to call; disabled models and providers aren't shown.",
    },
    {
      target: "models-source",
      title: "Personal or gateway",
      side: "bottom",
      body: "<b>Personal</b> models come from your own API keys and from providers other people shared with you; your access plan doesn't limit them. <b>Gateway</b> models come from the gateway's providers and follow your access. Press one to show only that group.",
    },
    // Both views
    {
      target: "models-price-tiers",
      title: "Price tiers",
      side: "bottom",
      body: "<b>Free</b> means both input and output prices are known to be $0. <b>Paid</b> means either is above $0. <b>Unknown</b> means a price is missing, so costs can't be tracked. Accounts limited to free models can use only Free ones.",
    },
    // Admin view, with models
    {
      target: "models-bulk",
      title: "Turn models on or off",
      side: "bottom",
      align: "end",
      body: "These buttons enable or disable every model the filters show, after you confirm. Disabled models are skipped by every route and can't be called by slug. Use the <b>Enabled</b> switch on a row to change just one model.",
    },
    {
      target: "models-col-price",
      title: "Prices",
      side: "bottom",
      body: "Dollars per million input / output tokens, used to work out what each request costs. Image, speech, transcription and rerank models show a unit price instead: per image, per 1K characters, per minute of audio or per search.",
    },
    {
      target: "models-col-health",
      title: "Health",
      side: "bottom",
      body: "After errors such as rate limits, timeouts or a rejected key, a model shows <b>Cooling down</b> for a while. Routes try healthy models first and use it only as a last resort until the cooldown ends. Hover the badge to see the last error.",
    },
    {
      target: "models-row-actions",
      title: "Model menu",
      side: "left",
      body: "<b>Edit</b> capabilities, tags, prices and free-tier limits (requests per minute or per day; a model at its limit is skipped until it resets). <b>Test</b> sends a short request, <b>Reset health</b> ends a cooldown, and <b>Delete</b> removes the model from every route.",
    },
    // Member view: the end
    {
      target: "models-member-columns",
      title: "Pick a model",
      side: "bottom",
      body: "Each row shows a model's kind, capabilities, context window (how much text it can take in) and price per million tokens. Copy a slug with the button next to it and send it as <code>model</code> from your app.",
    },
    // Admin view: the end
    {
      target: "models-empty",
      title: "No models yet",
      side: "top",
      body: "Every model belongs to a provider. Go to <b>Providers</b>, connect one with its API key, then use <b>Discover models</b> to import what it offers, or add a model by its id. They'll be listed here.",
    },
    {
      target: "models-providers-link",
      title: "Add more models",
      side: "bottom",
      align: "end",
      body: "Models come from providers. Open <b>Providers</b>, choose one and press <b>Discover models</b> to import what it offers, with prices and capabilities filled in. Imported models are enabled straight away, so check their prices.",
    },
  ],
}

const providers: TourDefinition = {
  id: "providers",
  version: 1,
  title: "Providers",
  steps: [
    {
      title: "Providers",
      body: "Providers are the AI services the gateway calls for your apps, such as OpenAI, Anthropic, Bedrock or a local Ollama. Admins connect shared providers that every member can use within their access. Members can connect their own API keys, which only their own apps can use.",
    },
    {
      target: "providers-empty",
      title: "Nothing connected yet",
      side: "bottom",
      body: "Without a provider there are no models to call. Connecting one is the first step: add it with its API key here, then import its models on the provider's page.",
    },
    {
      target: "providers-add",
      title: "Add a provider",
      side: "bottom",
      align: "end",
      body: "Pick a preset (an OpenAI-compatible service or a native API), name it and paste its key. The slug prefixes every model's name, like <code>openai/gpt-4o</code>, and can't be changed later. Members' own providers must use a public https:// address; local and private-network ones are refused.",
    },
    {
      target: "providers-table",
      title: "Connected providers",
      body: "One row per provider: its name and slug, the kind of API it speaks (and the preset it started from), and the address the gateway sends requests to. Admins see the shared providers here; members see only their own.",
    },
    {
      target: "providers-col-credentials",
      title: "Credentials",
      side: "bottom",
      body: "API keys are encrypted before they're stored and never leave the server. They're never shown again: the hint here only helps you tell keys apart. To change one, open the provider and use <b>Replace credentials</b>.",
    },
    {
      target: "providers-col-models",
      title: "Models",
      side: "bottom",
      body: "How many models this provider has, plus how many are enabled when that's not all of them. Only enabled models can serve requests.",
    },
    {
      target: "providers-col-enabled",
      title: "Switch a provider off",
      side: "bottom",
      body: "Turning a provider off takes all its models out of service at once: routes skip them and calls by slug fail. Its key, settings and models are kept, so you can turn it back on at any time.",
    },
    {
      target: "providers-members-own",
      title: "Members' own providers",
      side: "top",
      body: "Providers that members connected with their own keys. Only the owner's apps (and people the owner shared them with) can use them, and model access doesn't limit them. You can see them here, but you can't open or edit them.",
    },
    {
      target: "providers-shared-with-me",
      title: "Shared with you",
      side: "top",
      body: "Providers other people shared with you through an invite. Your apps can use their models, and the owner's key pays. You can't see their key or share them further. Switch one off to pause it for your apps, or <b>Leave</b> to give it back.",
    },
    {
      target: "providers-gateway",
      title: "From the gateway",
      side: "top",
      body: "The providers the gateway's owner set up for everyone. Switch one off under <b>Use in my apps</b> and your apps stop using its models (buckets skip them); it stays on for everyone else, and you can switch it back on any time.",
    },
    {
      target: "providers-open",
      title: "Open a provider",
      side: "right",
      body: "Click a name to manage it: change its connection, set free-tier limits, replace its key, and discover or add its models. That's how a provider's models become available to apps.",
    },
  ],
}

const provider: TourDefinition = {
  id: "provider",
  version: 1,
  title: "Provider",
  steps: [
    {
      title: "Provider",
      body: "Everything about one provider: how the gateway connects to it, the key it uses, any free-tier limits, and the models it offers. Changes here reach the gateway within a few seconds.",
    },
    {
      target: "page-actions",
      title: "On, off or delete",
      side: "bottom",
      align: "end",
      body: "Switching the provider off takes all its models out of service until you switch it back on. <b>Delete</b> removes it for good, along with its models (also from every route) and its stored key. Request logs are kept.",
    },
    {
      target: "provider-settings",
      title: "Connection settings",
      body: "The name and connection details, such as base URL or region; press <b>Save changes</b> to apply them. The slug is fixed because it's part of every model's slug. A provider a member owns must point at a public https:// address.",
    },
    {
      target: "provider-quota",
      title: "Provider-wide limits",
      side: "top",
      body: "For free tiers that cap your key across all of this provider's models (for example OpenRouter free: 20 a minute, 50 a day). Once a cap is reached, the gateway skips these models until the minute or UTC day resets, instead of getting errors. Blank means no limit.",
    },
    {
      target: "provider-credentials",
      title: "Credentials",
      side: "left",
      body: "The key is encrypted at rest and never shown again; the hint helps you recognise it. <b>Replace credentials</b> overwrites everything stored, and fields you leave empty are cleared. <b>Get an API key</b> links to the provider's key page when there is one.",
    },
    {
      target: "provider-sharing",
      title: "Share it",
      side: "top",
      body: "Let someone else's apps use this provider with your key. <b>Invite someone</b> gives you a link and a separate 6-digit code; they open the link, sign in and enter the code. You see what each person uses, and <b>Take back</b> ends their access within seconds. They can't share it further.",
    },
    {
      target: "provider-add-model",
      title: "Add a model by id",
      side: "bottom",
      body: "For models discovery doesn't find, or providers that can't list theirs. Enter the provider's model id, then its kind, capabilities, tags, prices (or a unit price for image, speech, transcription and rerank models) and any per-model free-tier limits.",
    },
    {
      target: "provider-discover",
      title: "Discover models",
      side: "bottom",
      body: "Asks the provider for its model list and shows the ones not added yet, with capabilities and prices filled in from the model catalogue. Tick the ones you want and import them. They're enabled straight away, so review their prices.",
    },
    {
      target: "provider-columns",
      title: "This provider's models",
      side: "bottom",
      body: "The same controls as the <b>Models</b> page, for this provider only. Apps call each one as this provider's slug plus the model id. Use the switch to turn a model off, and the menu to edit its details, reset its health or delete it.",
    },
    {
      target: "provider-test",
      title: "Test a model",
      side: "left",
      body: "Sends a short request and shows the reply time, token counts and the start of the answer, or the error. It's the quickest way to check the key and model work before apps rely on them.",
    },
  ],
}

const people: TourDefinition = {
  id: "members",
  version: 1,
  title: "Members",
  steps: [
    {
      title: "Members",
      body: "Everyone who can sign in to the dashboard. As superadmin, you add people here, choose what they may do and call, and cap what members can spend. Sign-up is open, so new accounts appear here too, as members with free models only.",
    },
    {
      target: "members-col-role",
      title: "Roles",
      side: "bottom",
      body: "<b>Members</b> create their own apps and API keys and see only their own usage and logs. <b>Admins</b> manage providers, models, routes and every app, but not people. The superadmin can't be edited here.",
    },
    {
      target: "members-col-access",
      title: "Model access",
      side: "bottom",
      body: "Which shared models a member may call: <b>Free models only</b> (priced at $0; paid and unknown-price models are blocked), <b>Selected routes and models</b>, or <b>All models</b>. Admins can use everything. Providers members connect themselves aren't limited by this.",
    },
    {
      target: "members-col-2fa",
      title: "Two-factor sign-in",
      side: "bottom",
      body: "Everyone needs an authenticator app to use the dashboard. <b>Not set up</b> means they'll be asked at their next sign-in; <b>No account</b> means they can't sign in until an account is created for them.",
    },
    {
      target: "members-col-spend",
      title: "Spend this month",
      side: "bottom",
      body: "What their requests have cost since the 1st of the month (UTC), next to a member's monthly budget. Once a member reaches it, their requests are refused until the next month. <b>No cap</b> means unlimited.",
    },
    {
      target: "members-row-actions",
      title: "Manage a person",
      side: "left",
      body: "<b>Edit access</b> (the sliders) changes role, model access and budget; their API keys pick it up within about 30 seconds. The other buttons create a missing account, reset the password or 2FA, and remove the person, which also deletes their apps and API keys.",
    },
    {
      target: "page-actions",
      title: "Add a person",
      side: "bottom",
      align: "end",
      body: "Creates an account with a starting password for you to share, or leave it empty if they'll sign in with Google. You choose their role, model access and budget up front; the default is a member with free models only.",
    },
  ],
}

export const CATALOG_TOURS: TourDefinition[] = [
  models,
  providers,
  provider,
  people,
]
