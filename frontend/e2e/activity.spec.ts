import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, loginByApi } from "./helpers/auth";

async function prepare(a: BrowserContext, b: BrowserContext) {
  await loginByApi(b, "demo2");
  const memberA = await (await a.request.get("/api/v1/me")).json();
  const memberB = await (await b.request.get("/api/v1/me")).json();
  const beforeA = await (
    await a.request.get(`/api/v1/profiles/${memberB.user.id}`)
  ).json();
  const beforeB = await (
    await b.request.get(`/api/v1/profiles/${memberA.user.id}`)
  ).json();
  const send = async (
    context: BrowserContext,
    csrf: string,
    target: number,
    remove = false,
  ) => {
    const response = await context.request[remove ? "delete" : "post"](
      `/api/v1/profiles/${target}/like`,
      {
        headers: { "X-CSRF-Token": csrf },
      },
    );
    expect(response.ok()).toBeTruthy();
  };
  const interestA = (remove = false) =>
    send(a, memberA.csrf, memberB.user.id, remove);
  const interestB = (remove = false) =>
    send(b, memberB.csrf, memberA.user.id, remove);
  return {
    memberA,
    memberB,
    interestA,
    interestB,
    restore: async () => {
      // Restore each side independently, including a relationship that was absent.
      await interestA(true);
      await interestB(true);
      if (beforeA.liked) await interestA();
      if (beforeB.liked) await interestB();
    },
  };
}

test("sent interest becomes a connection and can be withdrawn from activity", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  await login(page);
  const other = await browser.newContext({ baseURL });
  const pair = await prepare(context, other);
  try {
    await pair.interestA(true);
    await pair.interestB(true);
    await pair.interestA();
    await page
      .getByRole("button", { name: /^Activity(?:, \d+ unread)?$/ })
      .click();
    await page.getByRole("tab", { name: "Sent interest", exact: true }).click();
    const card = page.locator(".interest-card").filter({ hasText: "@demo2" });
    await expect(card).toContainText("Waiting for mutual interest");
    await pair.interestB();
    await expect(card).toContainText("Connected", { timeout: 10000 });
    await expect(
      card.getByRole("button", { name: "Chat", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("sent-interest.png"),
      fullPage: true,
    });
    await card
      .getByRole("button", { name: "Remove interest in Alex 2", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await page
      .getByRole("tab", { name: "Received interest", exact: true })
      .click();
    const received = page
      .locator(".interest-card")
      .filter({ hasText: "@demo2" });
    await received
      .getByRole("button", { name: "Express interest", exact: true })
      .click();
    await expect(received).toContainText("Connected");
  } finally {
    await pair.restore();
    await other.close();
  }
});

test("notification polling, individual read state, and opening a message", async ({
  page,
  context,
  browser,
  baseURL,
}, testInfo) => {
  await page.route("**/socket.io/**", (route) => route.abort());
  await login(page);
  const other = await browser.newContext({ baseURL });
  const pair = await prepare(context, other);
  try {
    await pair.interestA();
    await pair.interestB();
    await page
      .getByRole("button", { name: /^Activity(?:, \d+ unread)?$/ })
      .click();
    await page.getByLabel("Unread only", { exact: true }).check();
    const prefix = `Activity milestone ${testInfo.project.name} ${Date.now()}`;
    for (let i = 0; i < 2; i++) {
      const response = await other.request.post(
        `/api/v1/conversations/${pair.memberA.user.id}/messages`,
        {
          headers: { "X-CSRF-Token": pair.memberB.csrf },
          data: { body: `${prefix} ${i}`, client_id: `${prefix}-${i}` },
        },
      );
      expect(response.ok()).toBeTruthy();
    }
    const events = (
      await (
        await context.request.get("/api/v1/notifications?unread=true")
      ).json()
    ).notifications
      .filter(
        (item: { actor: number; kind: string }) =>
          item.actor === pair.memberB.user.id && item.kind === "message",
      )
      .slice(0, 2);
    expect(events).toHaveLength(2);
    const newest = page.locator(`[data-notification-id="${events[0].id}"]`);
    const older = page.locator(`[data-notification-id="${events[1].id}"]`);
    await expect(newest).toBeVisible({ timeout: 10000 });
    await expect(older).toBeVisible();
    await older
      .getByRole("button", {
        name: "Mark notification from demo2 as read",
        exact: true,
      })
      .click();
    await expect(older).toHaveCount(0);
    await expect(newest).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("notifications.png"),
      fullPage: true,
    });
    await newest.locator(".notification-open").click();
    await expect(
      page.getByRole("heading", { name: "Your conversation", exact: true }),
    ).toBeVisible();
    const saved = (
      await (await context.request.get("/api/v1/notifications")).json()
    ).notifications;
    expect(
      saved.find((item: { id: number }) => item.id === events[0].id)?.is_read,
    ).toBeTruthy();
    expect(
      saved.find((item: { id: number }) => item.id === events[1].id)?.is_read,
    ).toBeTruthy();
  } finally {
    await pair.restore();
    await other.close();
  }
});
