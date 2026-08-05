import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { browserArtifactsDir } from "../shared/config.js";
import { nowIso } from "../shared/time.js";
import { BrowserChallengeError, type BrowserActionContext, type BrowserAgent, type BrowserChallenge } from "./browser-agent.js";
import type { RuntimeCredentials } from "../core/types.js";

function isTransientPlaywrightError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("timeout") || message.includes("detached") || message.includes("not attached") || message.includes("strict mode violation");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function normalizeText(value: string | undefined): string {
  return value ? value.trim().replace(/\s+/g, " ") : "";
}

function firstDefined<T>(values: Array<T | undefined | null>): T | undefined {
  return values.find((value): value is T => value !== undefined && value !== null);
}

function locatorOrUndefined(page: Page, spec: { selector?: string; label?: string; placeholder?: string; role?: string; name?: string }): Locator | undefined {
  return firstDefined([
    spec.selector ? page.locator(spec.selector).first() : undefined,
    spec.label ? page.getByLabel(spec.label, { exact: false }).first() : undefined,
    spec.placeholder ? page.getByPlaceholder(spec.placeholder, { exact: false }).first() : undefined,
    spec.role && spec.name ? page.getByRole(spec.role as never, { name: spec.name }).first() : undefined,
    spec.name ? page.getByText(spec.name, { exact: false }).first() : undefined,
  ]);
}

function challengeFromText(text: string): BrowserChallenge | undefined {
  const normalized = text.toLowerCase();
  if (normalized.includes("captcha") || normalized.includes("recaptcha") || normalized.includes("human verification")) {
    return { type: "captcha", message: "A CAPTCHA or human verification challenge is present." };
  }
  if (normalized.includes("two-factor") || normalized.includes("2fa") || normalized.includes("verification code") || normalized.includes("one-time code")) {
    return { type: "2fa", message: "The site is asking for a second-factor verification code." };
  }
  if (normalized.includes("security check") || normalized.includes("verify your identity") || normalized.includes("authentication required")) {
    return { type: "unexpected-auth", message: "The site presented an unexpected authentication challenge." };
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return { type: "rate-limit", message: "The site rate-limited the session." };
  }
  if (normalized.includes("log in") || normalized.includes("login") || normalized.includes("sign in")) {
    return { type: "login-wall", message: "The page still appears to be on a login wall." };
  }
  return undefined;
}

export class PlaywrightBrowserAgent implements BrowserAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly headless = true) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 960 } });
    this.page = await this.context.newPage();
    return this.page;
  }

  private async saveCookiesIfAny(): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.context.storageState().catch(() => undefined);
  }

  private async snapshotChallenge(page: Page): Promise<BrowserChallenge | undefined> {
    const text = normalizeText(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""));
    return challengeFromText(text);
  }

  async detectChallenge(): Promise<BrowserChallenge | undefined> {
    if (!this.page) {
      return undefined;
    }
    return this.snapshotChallenge(this.page);
  }

  private async pauseOnChallenge(page: Page, context: BrowserActionContext): Promise<void> {
    const challenge = await this.snapshotChallenge(page);
    if (!challenge) {
      return;
    }
    context.emit({
      id: `${context.stepId}:challenge:${challenge.type}`,
      at: nowIso(),
      type: "browser.challenge",
      message: challenge.message,
      stepId: context.stepId,
      data: { runId: context.runId, challengeType: challenge.type },
    });
    throw new BrowserChallengeError(challenge);
  }

  private async withRecovery<T>(label: string, context: BrowserActionContext, fn: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.ensurePage();
    const maxAttempts = 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        context.emit({
          id: `${context.stepId}:${label}:${attempt}`,
          at: nowIso(),
          type: "browser.action",
          message: `${label} attempt ${attempt}`,
          stepId: context.stepId,
          data: { attempt, label, runId: context.runId },
        });
        const result = await fn(page);
        await this.pauseOnChallenge(page, context);
        await this.saveCookiesIfAny();
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof BrowserChallengeError) {
          throw error;
        }
        context.emit({
          id: `${context.stepId}:${label}:error:${attempt}`,
          at: nowIso(),
          type: "browser.error",
          message: error instanceof Error ? error.message : String(error),
          stepId: context.stepId,
          data: { attempt, transient: isTransientPlaywrightError(error) },
        });
        if (attempt < maxAttempts && isTransientPlaywrightError(error)) {
          await page.waitForLoadState("domcontentloaded").catch(() => undefined);
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
          await delay(250 * attempt);
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unknown browser action failure for ${label}`);
  }

  private async resolveCredentials(context: BrowserActionContext): Promise<RuntimeCredentials | undefined> {
    if (!context.credentialSessionId || !context.resolveCredentials) {
      return undefined;
    }
    return context.resolveCredentials(context.credentialSessionId);
  }

  async open(url: string, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("goto", context, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
    });
  }

  async click(spec: { selector?: string; role?: string; name?: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("click", context, async (page) => {
      const locator = locatorOrUndefined(page, spec);
      if (locator && (await locator.count()) > 0) {
        await locator.first().click({ timeout: 10_000 });
        return;
      }
      throw new Error(`Could not find clickable target for ${JSON.stringify(spec)}`);
    });
  }

  async fill(spec: { selector?: string; label?: string; placeholder?: string; text: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("fill", context, async (page) => {
      const locator = locatorOrUndefined(page, spec);
      if (locator && (await locator.count()) > 0) {
        await locator.first().fill(spec.text, { timeout: 10_000 });
        return;
      }

      const input = page.locator("input, textarea").first();
      if ((await input.count()) > 0) {
        await input.fill(spec.text);
        return;
      }

      throw new Error(`Could not find fill target for ${JSON.stringify(spec)}`);
    });
  }

  async type(spec: { selector?: string; text: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("type", context, async (page) => {
      const target = spec.selector ? page.locator(spec.selector).first() : page.locator("input, textarea").first();
      await target.type(spec.text, { delay: 20 });
    });
  }

  async select(spec: { selector?: string; label?: string; value: string | string[] }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("select", context, async (page) => {
      const locator = locatorOrUndefined(page, spec);
      if (!locator) {
        throw new Error(`Could not find select target for ${JSON.stringify(spec)}`);
      }
      await locator.selectOption(spec.value as never);
    });
  }

  async check(spec: { selector?: string; label?: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("check", context, async (page) => {
      const locator = locatorOrUndefined(page, spec);
      if (!locator) {
        throw new Error(`Could not find checkbox target for ${JSON.stringify(spec)}`);
      }
      await locator.check();
    });
  }

  async uncheck(spec: { selector?: string; label?: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("uncheck", context, async (page) => {
      const locator = locatorOrUndefined(page, spec);
      if (!locator) {
        throw new Error(`Could not find checkbox target for ${JSON.stringify(spec)}`);
      }
      await locator.uncheck();
    });
  }

  async upload(spec: { selector?: string; filePath: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("upload", context, async (page) => {
      const locator = spec.selector ? page.locator(spec.selector).first() : page.locator("input[type='file']").first();
      await locator.setInputFiles(spec.filePath);
    });
  }

  async wait(spec: { selector?: string; timeoutMs?: number; ms?: number }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("wait", context, async (page) => {
      if (typeof spec.ms === "number" && spec.ms > 0) {
        await page.waitForTimeout(spec.ms);
      }
      if (spec.selector) {
        await page.locator(spec.selector).first().waitFor({ timeout: spec.timeoutMs ?? 10_000 }).catch(() => undefined);
      } else {
        await page.waitForLoadState("networkidle", { timeout: spec.timeoutMs ?? 10_000 }).catch(() => undefined);
      }
    });
  }

  async login(spec: { submitSelector?: string }, context: BrowserActionContext): Promise<void> {
    const credentials = await this.resolveCredentials(context);
    if (!credentials) {
      throw new Error("No runtime credentials were supplied for login");
    }

    await this.withRecovery("login", context, async (page) => {
      const username = credentials.username ?? credentials.email;
      const password = credentials.password;
      if (!username || !password) {
        throw new Error("Login requires username/email and password");
      }

      const usernameLocator = firstDefined([
        page.getByLabel(/email|username|user name|login/i).first(),
        page.locator("input[type='email'], input[name*='email' i], input[name*='user' i], input[name*='login' i]").first(),
        page.getByPlaceholder(/email|username|user name|login/i).first(),
      ]);
      const passwordLocator = firstDefined([
        page.getByLabel(/password/i).first(),
        page.locator("input[type='password']").first(),
        page.getByPlaceholder(/password/i).first(),
      ]);

      if (usernameLocator) {
        await usernameLocator.fill(username, { timeout: 10_000 });
      }
      if (passwordLocator) {
        await passwordLocator.fill(password, { timeout: 10_000 });
      }

      for (const [key, value] of Object.entries(credentials.fields ?? {})) {
        const field = firstDefined([
          page.getByLabel(new RegExp(key, "i")).first(),
          page.locator(`input[name*='${key}' i], textarea[name*='${key}' i]`).first(),
          page.getByPlaceholder(new RegExp(key, "i")).first(),
        ]);
        if (field) {
          await field.fill(String(value), { timeout: 5_000 }).catch(() => undefined);
        }
      }

      const submit = firstDefined([
        spec.submitSelector ? page.locator(spec.submitSelector).first() : undefined,
        page.getByRole("button", { name: /sign in|log in|login|continue|submit/i }).first(),
        page.locator("button[type='submit'], input[type='submit']").first(),
      ]);

      if (submit && (await submit.count()) > 0) {
        await submit.click({ timeout: 10_000 });
      } else {
        await passwordLocator?.press("Enter").catch(() => undefined);
      }

      await page.waitForLoadState("networkidle").catch(() => undefined);
    });
  }

  async extractText(spec: { selector?: string }, context: BrowserActionContext): Promise<string> {
    return this.withRecovery("extract", context, async (page) => {
      const locator = spec.selector ? page.locator(spec.selector).first() : page.locator("body").first();
      const text = await locator.innerText({ timeout: 10_000 });
      return text.trim();
    });
  }

  async extractStructured(spec: { selector?: string }, context: BrowserActionContext): Promise<unknown> {
    return this.withRecovery("extract-structured", context, async (page) => {
      const targetSelector = spec.selector ?? "body";
      return page.evaluate((selector) => {
        const root = document.querySelector(selector) ?? document.body;
        const headings = Array.from(root.querySelectorAll("h1, h2, h3")).map((node) => node.textContent?.trim()).filter(Boolean);
        const links = Array.from(root.querySelectorAll("a")).slice(0, 25).map((node) => ({
          text: node.textContent?.trim() ?? "",
          href: (node as HTMLAnchorElement).href ?? "",
        }));
        const tables = Array.from(root.querySelectorAll("table")).slice(0, 5).map((table) =>
          Array.from(table.querySelectorAll("tr")).map((row) =>
            Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent?.trim() ?? ""),
          ),
        );
        return {
          title: document.title,
          url: location.href,
          headings,
          links,
          tables,
          text: root.textContent?.trim() ?? "",
        };
      }, targetSelector);
    });
  }

  async screenshot(spec: { path?: string }, context: BrowserActionContext): Promise<string> {
    return this.withRecovery("screenshot", context, async (page) => {
      const outputPath = spec.path ? resolve(browserArtifactsDir, spec.path) : resolve(browserArtifactsDir, `${context.runId}-${context.stepId}.png`);
      await mkdir(dirname(outputPath), { recursive: true });
      await page.screenshot({ path: outputPath, fullPage: true });
      return outputPath;
    });
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
