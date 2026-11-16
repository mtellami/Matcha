import { expect, type BrowserContext, type Page } from "@playwright/test";

const password = "Demo!River8Cloud&2026";
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessions = new Map<string, Cookies>();

async function restore(context: BrowserContext, username: string) {
  const cookies = sessions.get(username);
  if (!cookies) return false;
  await context.addCookies(cookies);
  const response = await context.request.get("/api/v1/me");
  return response.ok() && (await response.json()).user.username === username;
}

// Reuse valid demo sessions within this worker, while keeping page contexts isolated.
// This lets the full suite respect the real authentication throttle. Logout is still real.
export async function login(page: Page, username = "demo1") {
  const restored = await restore(page.context(), username);
  await page.goto("/");
  if (!restored) {
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  sessions.set(username, await page.context().cookies());
}

export async function loginByApi(context: BrowserContext, username: string) {
  if (await restore(context, username)) return;
  const response = await context.request.post("/api/v1/auth/login", {
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
  sessions.set(username, await context.cookies());
}
