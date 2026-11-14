export const AUDIENCES = {
  "new-user": {
    label: "New user",
    description: "Shows how to get started",
    plannerInstruction:
      "Plan the route a first-time user needs to get started: the main entry point, the first useful action, and where to go next.",
    scriptTone:
      "Speak to someone trying the product for the first time: welcoming and practical.",
  },
  investor: {
    label: "Investor",
    description: "Shows the most impressive features fast",
    plannerInstruction:
      "Plan the route that shows the most impressive, distinctive features as fast as possible. Skip setup and settings.",
    scriptTone:
      "Speak to an investor: focus on what is impressive and why it matters.",
  },
  developer: {
    label: "Developer",
    description: "Shows setup, settings and integrations",
    plannerInstruction:
      "Plan the route a developer cares about: setup, settings, documentation, API or integrations, wherever the page offers them.",
    scriptTone:
      "Speak to a developer: concrete and technical, without hype.",
  },
} as const;

export type Audience = keyof typeof AUDIENCES;

export const DEFAULT_AUDIENCE: Audience = "new-user";
