import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { browserArtifactsDir } from "../shared/config.js";
import { nowIso } from "../shared/time.js";
import type { BrowserActionContext, BrowserAgent } from "./browser-agent.js";

function isTransientPlaywrightError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("timeout") || message.includes("detached") || message.includes("not attached") || message.includes("strict mode violation");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
        return await fn(page);
      } catch (error) {
        lastError = error;
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

  async open(url: string, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("goto", context, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
    });
  }

  async click(spec: { selector?: string; role?: string; name?: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("click", context, async (page) => {
      const selectors = [
        spec.selector ? page.locator(spec.selector) : null,
        spec.role && spec.name ? page.getByRole(spec.role as never, { name: spec.name }) : null,
        spec.name ? page.getByText(spec.name, { exact: false }) : null,
      ].filter(Boolean);

      for (const locator of selectors) {
        if (!locator) continue;
        if ((await locator.count()) > 0) {
          await locator.first().click({ timeout: 10_000 });
          return;
        }
      }
      throw new Error(`Could not find clickable target for ${JSON.stringify(spec)}`);
    });
  }

  async fill(spec: { selector?: string; label?: string; placeholder?: string; text: string }, context: BrowserActionContext): Promise<void> {
    await this.withRecovery("fill", context, async (page) => {
      const locators = [
        spec.selector ? page.locator(spec.selector) : null,
        spec.label ? page.getByLabel(spec.label, { exact: false }) : null,
        spec.placeholder ? page.getByPlaceholder(spec.placeholder, { exact: false }) : null,
      ].filter(Boolean);

      for (const locator of locators) {
        if (!locator) continue;
        if ((await locator.count()) > 0) {
          await locator.first().fill(spec.text, { timeout: 10_000 });
          return;
        }
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

  async extractText(spec: { selector?: string }, context: BrowserActionContext): Promise<string> {
    return this.withRecovery("extract", context, async (page) => {
      const locator = spec.selector ? page.locator(spec.selector).first() : page.locator("body").first();
      const text = await locator.innerText({ timeout: 10_000 });
      return text.trim();
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
