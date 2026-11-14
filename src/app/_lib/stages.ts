/**
 * Keep the web pipeline's stage imports in one place while using the real
 * browser agent and Remotion renderer.
 */
export { runAgent } from "../../agent";
export type { AgentResult } from "../../agent";
export { writeScript } from "../../agent/script";
export { appendCostCall } from "../../agent/cost";
export type { AgentCostCall } from "../../agent/cost";
export { renderJob } from "../../renderer/renderJob";
export type { RenderOptions } from "../../renderer/renderJob";
export { generateVoice } from "../../voice/generateVoice";
export type { VoiceOptions, VoiceSummary } from "../../voice/generateVoice";
export { PROVIDER_NAME } from "../../voice/provider";
