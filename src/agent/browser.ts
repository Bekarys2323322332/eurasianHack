/**
 * Browser helpers for inspecting public pages and applying the small set of
 * actions represented by the shared step-file contract.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Page } from "playwright";
import type { StepAction } from "../shared/stepFile";

const PRIVATE_ADDRESS_MESSAGE =
  "That address points to a private or local network, which the agent is not allowed to visit. Use a public web address.";

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

/** Normalize host syntax before checking names and IP literals. */
function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, "");
  return trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
}

/** Check the explicit private IPv4 ranges used by the agent's network guard. */
function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

/** Expand a validated IPv6 literal into eight 16-bit words for range checks. */
function ipv6Words(address: string): number[] {
  let normalized = address;
  const ipv4Tail = normalized.match(/(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Tail) {
    const octets = ipv4Tail[2].split(".").map(Number);
    const firstWord = ((octets[0] << 8) | octets[1]).toString(16);
    const secondWord = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${ipv4Tail[1]}${firstWord}:${secondWord}`;
  }

  const [leftSide, rightSide, ...extra] = normalized.split("::");
  if (extra.length > 0) return [];
  const parseSide = (side: string) =>
    side ? side.split(":").map((word) => Number.parseInt(word, 16)) : [];
  const left = parseSide(leftSide);
  const right = parseSide(rightSide ?? "");

  if (rightSide === undefined) return left.length === 8 ? left : [];
  const missingWords = 8 - left.length - right.length;
  if (missingWords < 1) return [];
  return [...left, ...Array<number>(missingWords).fill(0), ...right];
}

/** Check whether an IPv6 literal belongs to loopback, unspecified, ULA, or link-local space. */
function isPrivateIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (words.length !== 8) return false;
  if (words.every((word) => word === 0)) return true;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;

  if ((words[0] & 0xfe00) === 0xfc00) return true;
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  const isIpv4Mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (isIpv4Mapped) {
    const first = words[6] >> 8;
    const second = words[6] & 0xff;
    const third = words[7] >> 8;
    const fourth = words[7] & 0xff;
    return isPrivateIpv4(`${first}.${second}.${third}.${fourth}`);
  }
  return false;
}

/** Identify hostnames and IP literals that must never be opened by the agent. */
export function isPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "local" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const address = normalized.split("%", 1)[0];
  const addressVersion = isIP(address);
  if (addressVersion === 4) return isPrivateIpv4(address);
  if (addressVersion === 6) return isPrivateIpv6(address);
  return false;
}

/**
 * Reject private URL hosts and DNS answers before the browser starts.
 * DNS is checked only once; a DNS-rebinding change between this check and a
 * later request is accepted for now, while the browser route still blocks
 * private IP literals on every request.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("The page URL must use HTTP or HTTPS.");
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  if (isPrivateHost(hostname)) {
    throw new Error(PRIVATE_ADDRESS_MESSAGE);
  }

  if (isIP(hostname) !== 0) return;
  const addresses = await lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateHost(address))) {
    throw new Error(PRIVATE_ADDRESS_MESSAGE);
  }
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
    document
      .querySelectorAll("[data-agent-element]")
      .forEach((node) => node.removeAttribute("data-agent-element"));
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
    const locator = page.locator(`[data-agent-element="${target!.number}"]`);
    await locator.click({ timeout: 5_000 });
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
