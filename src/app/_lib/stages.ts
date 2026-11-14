/**
 * The two stages the web app does not own: the browser agent (src/agent) and
 * the video renderer (src/renderer). Both are built on other branches.
 *
 * The pipeline only talks to them through this file, so swapping a stub for
 * the real thing is a one-line change here:
 *
 *   export { runAgent } from "../../agent";
 *   export { renderJob } from "../../renderer/renderJob";
 *
 * Until then the stubs below let the whole page flow be tested today.
 */
export { runAgentStub as runAgent, renderJobStub as renderJob } from "./stubs";
export type { AgentResult, RenderOptions } from "./stubs";
