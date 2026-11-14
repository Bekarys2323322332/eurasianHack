/**
 * Browser helpers for inspecting public pages and applying the small set of
 * actions represented by the shared step-file contract.
 */
import type { Page } from "playwright";
import type { StepAction } from "../shared/stepFile";

/** A visible control described in the coordinate system of the current viewport. */
export interface InteractiveElement {
  number: number;
  role: string;
  text: string;
  x: number;
  y: number;
  inputType: string | null;
  name: string | null;
  placeholder: string | null;
  href: string | null;
}

/** The action schema shared between the agent prompt and browser executor. */
export interface AgentAction {
  action: StepAction;
  elementNumber: number | null;
  text: string | null;
  reason: string;
  done: boolean;
}

/** Collect visible page copy while excluding common hidden or non-content nodes. */
export async function extractVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) return "";
    return body.innerText.replace(/\s+/g, " ").trim().slice(0, 8_000);
  });
}

/**
 * Number visible controls and tag their DOM nodes so later actions use the
 * exact element the model selected, rather than repeating an ambiguous text query.
 */
export async function extractInteractiveElements(page: Page): Promise<InteractiveElement[]> {
  return page.evaluate(() => {
    const selector =
      'a[href],button,input,textarea,select,[role="button"],[role="link"],[onclick]';
    const elements: InteractiveElement[] = [];

    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        centerY >= 0 &&
        centerY <= window.innerHeight &&
        centerX >= 0 &&
        centerX <= window.innerWidth &&
        !node.closest('[aria-hidden="true"]');
      if (!visible) continue;

      const input = node as HTMLInputElement;
      const role =
        node.getAttribute("role") ||
        (node.tagName.toLowerCase() === "a"
          ? "link"
          : node.tagName.toLowerCase() === "button"
            ? "button"
            : node.tagName.toLowerCase() === "select"
              ? "combobox"
              : node.tagName.toLowerCase() === "textarea" || node.tagName.toLowerCase() === "input"
                ? "textbox"
                : "interactive element");
      const text =
        node.getAttribute("aria-label") ||
        node.innerText?.replace(/\s+/g, " ").trim() ||
        node.getAttribute("placeholder") ||
        node.getAttribute("title") ||
        node.getAttribute("name") ||
        `Unlabeled ${role}`;
      const number = elements.length + 1;
      node.setAttribute("data-agent-element", String(number));
      elements.push({
        number,
        role,
        text: text.slice(0, 180),
        x: centerX,
        y: centerY,
        inputType: node.tagName.toLowerCase() === "input" ? input.type : null,
        name: node.getAttribute("name"),
        placeholder: node.getAttribute("placeholder"),
        href: node instanceof HTMLAnchorElement ? node.href : null,
      });
    }

    return elements;
  });
}

/**
 * Detect common robot challenges and pages whose meaningful content is only
 * a password form, so the agent never attempts to bypass a sign-in wall.
 */
export async function detectLoginWall(page: Page): Promise<boolean> {
  const result = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    const hasChallengeFrame = frames.some((frame) =>
      /recaptcha|hcaptcha|turnstile/i.test(
        `${frame.getAttribute("src") ?? ""} ${frame.getAttribute("title") ?? ""}`,
      ),
    );
    const visibleText = document.body?.innerText ?? "";
    const asksForHuman = /verify (?:that )?(?:you are|you're) human|confirm (?:you are|you're) human|robot check/i.test(
      visibleText,
    );
    const hasVisiblePassword = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    ).some((input) => {
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

    const bodyCopy = document.body?.cloneNode(true) as HTMLElement | undefined;
    bodyCopy
      ?.querySelectorAll("script,style,form,[role='form'],nav,header,footer,aside")
      .forEach((node) => node.remove());
    const contentOutsideForms = bodyCopy?.innerText.replace(/\s+/g, " ").trim() ?? "";
    const passwordOnlyPage = hasVisiblePassword && contentOutsideForms.length < 120;

    return hasChallengeFrame || asksForHuman || passwordOnlyPage;
  });

  return result;
}

/** Replace personal-looking form input with one of the explicitly fake demo values. */
function fakeFormValue(element: InteractiveElement, suggestedText: string | null): string {
  const hints = [
    element.inputType,
    element.name,
    element.placeholder,
    element.text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/email|e-mail/.test(hints)) return "test@example.com";
  if (/phone|telephone|mobile|tel/.test(hints)) return "555-0100";
  if (/name/.test(hints)) return "Test User";

  if (
    suggestedText === "Test User" ||
    suggestedText === "test@example.com" ||
    suggestedText === "555-0100"
  ) {
    return suggestedText;
  }
  return "Test User";
}

/** Execute one selected action using a numbered DOM tag or a safe page-level operation. */
export async function performBrowserAction(
  page: Page,
  action: AgentAction,
  elements: InteractiveElement[],
): Promise<{ target: InteractiveElement | null; typedText: string | null }> {
  const target =
    action.elementNumber === null
      ? null
      : elements.find((element) => element.number === action.elementNumber) ?? null;

  if ((action.action === "click" || action.action === "type") && !target) {
    throw new Error("The selected interactive element is no longer available.");
  }

  if (action.action === "click") {
    await page.locator(`[data-agent-element="${target!.number}"]`).click({ timeout: 5_000 });
    return { target, typedText: null };
  }

  if (action.action === "type") {
    const typedText = fakeFormValue(target!, action.text);
    await page.locator(`[data-agent-element="${target!.number}"]`).fill(typedText, {
      timeout: 5_000,
    });
    return { target, typedText };
  }

  if (action.action === "scroll") {
    await page.evaluate(() => window.scrollBy({ top: 600, behavior: "smooth" }));
    return { target, typedText: null };
  }

  if (action.action === "navigate") {
    const destination = target?.href ?? action.text;
    if (!destination) {
      throw new Error("The navigation action did not include a destination.");
    }
    const url = new URL(destination, page.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("The agent can only navigate to an HTTP or HTTPS page.");
    }
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { target, typedText: null };
  }

  await page.waitForTimeout(1_000);
  return { target, typedText: null };
}
