import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  detectLoginWall,
  extractInteractiveElements,
  isPrivateHost,
  performBrowserAction,
} from "../src/agent/browser";
import {
  addAgentCostCall,
  createAgentCostFile,
  findUnpricedModel,
  formatTotalCost,
} from "../src/agent/cost";
import { buildStepGoal } from "../src/agent/planner";

describe("browser helpers", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  });

  afterAll(async () => {
    await browser.close();
  });

  it("identifies private and local hostnames and IP literals", () => {
    for (const hostname of [
      "localhost",
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "[::1]",
      "foo.local",
    ]) {
      expect(isPrivateHost(hostname), hostname).toBe(true);
    }

    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });

  it("numbers visible controls, tags their DOM nodes, and reports viewport centres", async () => {
    await page.setContent(`
      <button style="position:absolute;left:100px;top:50px;width:80px;height:20px">Start</button>
      <input type="email" name="email" placeholder="Email"
        style="position:absolute;left:200px;top:100px;width:120px;height:24px">
      <button style="display:none">Hidden control</button>
    `);

    const elements = await extractInteractiveElements(page);

    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({
      number: 1,
      role: "button",
      text: "Start",
      x: 140,
      y: 60,
    });
    expect(elements[1]).toMatchObject({
      number: 2,
      role: "textbox",
      inputType: "email",
      name: "email",
    });
    expect(await page.locator('[data-agent-element="1"]').count()).toBe(1);
    expect(await page.locator('[data-agent-element="2"]').count()).toBe(1);
  });

  it("removes stale tags before numbering controls after a scroll", async () => {
    const buttons = Array.from(
      { length: 40 },
      (_, index) =>
        `<button style="display:block;width:100%;height:80px">Control ${index + 1}</button>`,
    ).join("");
    await page.setContent(`<main>${buttons}</main>`);
    await extractInteractiveElements(page);
    await page.evaluate(() => window.scrollTo(0, 1_800));
    await page.waitForTimeout(50);

    const elements = await extractInteractiveElements(page);
    const tags = await page
      .locator("[data-agent-element]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-agent-element")));

    expect(elements.length).toBeGreaterThan(0);
    expect(tags).toHaveLength(elements.length);
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of tags) {
      expect(await page.locator(`[data-agent-element="${tag}"]`).count()).toBe(1);
    }
  });

  it("removes target blank from a link before clicking it", async () => {
    await page.setContent('<a href="#opened" target="_blank">Open locally</a>');
    const elements = await extractInteractiveElements(page);

    await performBrowserAction(
      page,
      {
        action: "click",
        elementNumber: elements[0].number,
        text: null,
        reason: "Open the local link",
        done: false,
      },
      elements,
    );

    expect(page.url()).toContain("#opened");
    expect(await page.locator('[data-agent-element="1"]').getAttribute("target")).toBeNull();
    expect(page.context().pages()).toHaveLength(1);
  });

  it("removes target from a form ancestor before clicking its control", async () => {
    await page.setContent(`
      <form target="_blank">
        <button type="button" target="_blank" onclick="window.location.hash = 'opened'">Open</button>
      </form>
    `);
    const elements = await extractInteractiveElements(page);

    await performBrowserAction(
      page,
      {
        action: "click",
        elementNumber: elements[0].number,
        text: null,
        reason: "Open the form control",
        done: false,
      },
      elements,
    );

    expect(page.url()).toContain("#opened");
    expect(await page.locator("button").getAttribute("target")).toBeNull();
    expect(await page.locator("form").getAttribute("target")).toBeNull();
  });

  it("detects a captcha iframe and human-verification copy", async () => {
    await page.setContent('<iframe title="reCAPTCHA challenge"></iframe>');
    expect(await detectLoginWall(page)).toBe(true);

    await page.setContent("<main>Verify you are human to continue.</main>");
    expect(await detectLoginWall(page)).toBe(true);
  });

  it("detects a page whose only meaningful content is a password form", async () => {
    await page.setContent(`
      <main>
        <form>
          <label>Password <input type="password"></label>
          <button>Continue</button>
        </form>
      </main>
    `);
    expect(await detectLoginWall(page)).toBe(true);
  });

  it("allows a password form when the page also has substantial public content", async () => {
    await page.setContent(`
      <main>
        <h1>Public product guide</h1>
        <p>${"A public article paragraph with useful product details. ".repeat(6)}</p>
        <form><label>Password <input type="password"></label></form>
      </main>
    `);
    expect(await detectLoginWall(page)).toBe(false);
  });
});

describe("step-model goal", () => {
  it("uses the complete numbered route for a demo without a supplied goal", () => {
    expect(buildStepGoal("demo", null, ["Open the catalog", "View an item"])).toEqual({
      goal: "Show these things, in order:\n1. Open the catalog\n2. View an item",
      requireFullRoute: true,
    });
  });

  it("preserves a supplied how-to goal", () => {
    expect(buildStepGoal("howto", "Open the top story's comments", ["Other item"])).toEqual({
      goal: "Open the top story's comments",
      requireFullRoute: false,
    });
  });
});

describe("agent cost accounting", () => {
  it("marks the total unknown when any model call has no configured price", () => {
    const costFile = createAgentCostFile();
    addAgentCostCall(costFile, "planner", {
      model: "anthropic/claude-haiku-5.5",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.25,
    });
    addAgentCostCall(costFile, "agent-step-1", {
      model: "provider/unlisted-model",
      inputTokens: 20,
      outputTokens: 10,
      costUsd: null,
    });

    expect(costFile.totalUsd).toBeNull();
    expect(findUnpricedModel(costFile)).toBe("provider/unlisted-model");
    expect(formatTotalCost(costFile.totalUsd, findUnpricedModel(costFile))).toBe(
      "Total cost: unknown (no price for provider/unlisted-model)",
    );
  });

  it("formats a known aggregate as a dollar amount", () => {
    expect(formatTotalCost(0.125, null)).toBe("Total cost: $0.125000");
  });
});
