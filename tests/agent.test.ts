import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  detectLoginWall,
  extractInteractiveElements,
  isPrivateHost,
} from "../src/agent/browser";

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
