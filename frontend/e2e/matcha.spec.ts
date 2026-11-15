import { test, expect, type Page, type BrowserContext, type Route } from "@playwright/test";
import { login } from "./helpers/auth";
async function account(context: BrowserContext) {
  const response = await context.request.get("/api/v1/me");
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function openPerson(
  page: Page,
  person: { first_name: string; city: string },
) {
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByText("Advanced filters and sorting", { exact: true }).click();
  await page
    .getByLabel("City or neighborhood", { exact: true })
    .fill(person.city);
  await page.getByRole("button", { name: "Find people", exact: true }).click();
  const escaped = person.first_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page.getByRole("button", { name: "Find people", exact: true })).toBeEnabled();
  const card = page.getByRole("button", {
    name: new RegExp(`^View ${escaped},`),
  });
  // Distance and fame can place the seeded chat partner beyond the first page.
  while (!(await card.count())) {
    const next = page.getByRole("button", { name: "Next results page", exact: true });
    if (!(await next.count()) || !(await next.isEnabled()))
      throw new Error(`No discoverable profile found for ${person.first_name} in ${person.city}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/v1/profiles?") && response.request().method() === "GET"),
      next.click(),
    ]);
    await expect(page.getByRole("button", { name: "Find people", exact: true })).toBeEnabled();
  }
  await card.click();
}

test("weak multilingual passwords produce accessible field feedback", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await page.getByLabel("First name", { exact: true }).fill("Test");
  await page.getByLabel("Last name", { exact: true }).fill("Account");
  await page
    .getByLabel("Username", { exact: true })
    .fill("browser_test_" + Date.now());
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-test@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Contraseña2026!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("password");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("search filters persist and the page fits the viewport", async ({
  page,
}) => {
  await login(page);
  await page.getByText("Advanced filters and sorting", { exact: true }).click();
  await page.getByLabel("Minimum age", { exact: true }).fill("25");
  await page.getByLabel("Maximum age", { exact: true }).fill("40");
  await page.getByLabel("Interest tags", { exact: true }).fill("coffee");
  await page.getByRole("combobox", { name: "Sort by", exact: true }).selectOption("fame");
  await page.getByRole("combobox", { name: "Order", exact: true }).selectOption("desc");
  await page.getByRole("button", { name: "Find people", exact: true }).click();
  await expect(page).toHaveURL(/min_age=25/);
  await expect(page).toHaveURL(/direction=desc/);
  await expect(page.getByRole("status")).toContainText(/\d+ profiles found/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("profile validation rejects empty normalized tags and city selection needs no coordinates", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await expect(page.locator('#cities option[value="Marrakech"]')).toHaveCount(
    1,
  );
  await page
    .getByLabel("City or neighborhood", { exact: true })
    .fill("Marrakech");
  await page
    .getByLabel("Interests, separated by commas", { exact: true })
    .fill(",,,");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("tags");
  await expect(
    page.getByLabel("Interests, separated by commas", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Latitude", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Remove photo \d+$/ }).first(),
  ).toBeVisible();
});

test("profile checklist guides a new member to missing fields", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, user: {
      ...data.user, birth_date: null, gender: null, bio: "", tags: [],
      city: null, latitude: null, longitude: null, photos: [],
    } } });
  });
  await login(page);
  await expect(page.getByRole("heading", { name: "Let’s start with you." })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Saved profile completion" })).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: /A little about you/ }).click();
  await expect(page.getByLabel("About you", { exact: true })).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("public profile preview and reusable interest selection", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  const hiking = page.getByRole("button", { name: "#hiking +", exact: true });
  await hiking.click();
  await expect(page.getByRole("button", { name: "#hiking ✓", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Interests, separated by commas", { exact: true })).toHaveValue(/hiking/);
  await page.getByRole("button", { name: "#hiking ✓", exact: true }).click();
  await expect(page.getByLabel("Interests, separated by commas", { exact: true })).not.toHaveValue(/hiking/);
  await page.getByRole("button", { name: "Preview my public profile", exact: true }).click();
  await expect(page.getByText(/Your public profile ·/)).toBeVisible();
  await expect(page.getByText("Coffee, conversation, and discovering new places.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "I’m interested", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Block", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "← Back to editing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your photos", exact: true })).toBeVisible();
});

test("mutual interest enables chat and messages arrive within ten seconds", async ({
  browser,
  baseURL,
  page: pageA,
  context: a,
  viewport,
  isMobile,
  hasTouch,
  deviceScaleFactor,
  userAgent,
}, testInfo) => {
  test.setTimeout(90000);
  const b = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  const pageB = await b.newPage();
  const timings: Record<string, number> = {};
  let blockedByTest = false;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    await login(pageA, "demo1");
    await login(pageB, "demo2");
    const accountA = await account(a),
      accountB = await account(b);
    const beforeA = await (
      await a.request.get(`/api/v1/profiles/${accountB.user.id}`)
    ).json();
    const beforeB = await (
      await b.request.get(`/api/v1/profiles/${accountA.user.id}`)
    ).json();
    cleanup = async () => {
      if (blockedByTest)
        await a.request.delete(`/api/v1/profiles/${accountB.user.id}/block`, {
          headers: { "X-CSRF-Token": accountA.csrf },
        });
      await a.request[beforeA.liked ? "post" : "delete"](`/api/v1/profiles/${accountB.user.id}/like`, {
        headers: { "X-CSRF-Token": accountA.csrf },
      });
      await b.request[beforeB.liked ? "post" : "delete"](`/api/v1/profiles/${accountA.user.id}/like`, {
        headers: { "X-CSRF-Token": accountB.csrf },
      });
    };
    // Start from a known state even if a prior interrupted browser run left a match.
    await a.request.delete(`/api/v1/profiles/${accountB.user.id}/like`, {
      headers: { "X-CSRF-Token": accountA.csrf },
    });
    await b.request.delete(`/api/v1/profiles/${accountA.user.id}/like`, {
      headers: { "X-CSRF-Token": accountB.csrf },
    });
    const response = await b.request.post(
      `/api/v1/profiles/${accountA.user.id}/like`,
      { headers: { "X-CSRF-Token": accountB.csrf } },
    );
    expect(response.ok()).toBeTruthy();
    await openPerson(pageA, accountB.user);
    await pageA
      .getByRole("button", { name: "I’m interested", exact: true })
      .click();
    await expect(
      pageA.getByText("You’re connected ✨", { exact: true }),
    ).toBeVisible();
    await openPerson(pageB, accountA.user);
    await expect(
      pageB.getByRole("heading", { name: "Your conversation", exact: true }),
    ).toBeVisible();
    const body = "Browser acceptance hello " + Date.now();
    await expect(pageA.locator("main")).toHaveAttribute("data-connection-state", "connected");
    await expect(pageB.locator("main")).toHaveAttribute("data-connection-state", "connected");
    await pageA
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(body);
    let started = Date.now();
    await pageA.getByRole("button", { name: "Send", exact: true }).click();
    await expect(pageB.locator(".messages")).toContainText(body, {
      timeout: 10000,
    });
    timings.live_delivery_ms = Date.now() - started;
    // Recover more than one page after this tab loses its network connection.
    await b.setOffline(true);
    const prefix = "Offline burst " + Date.now();
    for (let index = 0; index < 120; index++) {
      const sent = await a.request.post(
        `/api/v1/conversations/${accountB.user.id}/messages`,
        {
          headers: { "X-CSRF-Token": accountA.csrf },
          data: {
            body: `${prefix} #${index}`,
            client_id: `${prefix}-${index}`,
          },
        },
      );
      expect(sent.ok()).toBeTruthy();
    }
    started = Date.now();
    await b.setOffline(false);
    await expect(
      pageB.locator(".messages > .received").filter({ hasText: prefix }),
    ).toHaveCount(120, { timeout: 10000 });
    timings.offline_120_recovery_ms = Date.now() - started;
    await expect(pageB.locator("main")).toHaveAttribute("data-connection-state", "connected");
    // Blocking the Socket.IO handshake must leave the HTTP polling fallback usable.
    await pageB.route("**/socket.io/**", (route) => route.abort());
    await pageB.reload();
    await expect(
      pageB.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await openPerson(pageB, accountA.user);
    const fallback = "Polling fallback " + Date.now();
    started = Date.now();
    const sent = await a.request.post(
      `/api/v1/conversations/${accountB.user.id}/messages`,
      {
        headers: { "X-CSRF-Token": accountA.csrf },
        data: { body: fallback, client_id: fallback },
      },
    );
    expect(sent.ok()).toBeTruthy();
    await expect(pageB.locator(".messages")).toContainText(fallback, {
      timeout: 10000,
    });
    timings.polling_delivery_ms = Date.now() - started;

    // One stalled status response must not wedge the queued refresh loop.
    let held: Route | undefined;
    const statusPath = `**/api/v1/profiles/${accountA.user.id}/status`;
    await pageB.route(statusPath, (route) => {
      if (!held) held = route;
      else return route.continue();
    });
    await expect.poll(() => Boolean(held)).toBe(true);
    const afterStall = "Recovered stalled request " + Date.now();
    started = Date.now();
    await a.request.post(`/api/v1/conversations/${accountB.user.id}/messages`, {
      headers: { "X-CSRF-Token": accountA.csrf }, data: { body: afterStall, client_id: afterStall },
    });
    await expect(pageB.locator(".messages")).toContainText(afterStall, { timeout: 10000 });
    timings.stalled_request_recovery_ms = Date.now() - started;
    await held?.abort().catch(() => {});
    await pageB.unroute(statusPath);

    // Lose the response after the server commits; retry must reuse its key.
    const retryBody = "Retry accepted send " + Date.now();
    const attempts: { client_id: string }[] = [];
    const sendPath = `**/api/v1/conversations/${accountB.user.id}/messages`;
    await pageA.route(sendPath, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) {
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    await pageA.getByRole("textbox", { name: "Message", exact: true }).fill(retryBody);
    await pageA.getByRole("button", { name: "Send", exact: true }).click();
    await expect(pageA.getByRole("alert")).toBeVisible();
    await expect(pageA.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(retryBody);
    await pageA.getByRole("button", { name: "Send", exact: true }).click();
    await expect(pageA.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
    await expect(pageB.locator(".messages > .received").filter({ hasText: retryBody })).toHaveCount(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].client_id).toBe(attempts[0].client_id);
    const stored = await (await a.request.get(`/api/v1/conversations/${accountB.user.id}/messages`)).json();
    expect(stored.messages.filter((message: { body: string }) => message.body === retryBody)).toHaveLength(1);
    await pageA.unroute(sendPath);

    // A second tab has its own socket/presence and can load older messages.
    const secondTab = await b.newPage();
    await secondTab.bringToFront();
    await secondTab.goto("/");
    await expect(secondTab.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await openPerson(secondTab, accountA.user);
    await expect(secondTab.locator(".messages > [data-message-id]")).toHaveCount(50);
    await secondTab.getByRole("button", { name: "Older messages", exact: true }).click();
    await expect(secondTab.locator(".messages > [data-message-id]")).toHaveCount(100);
    const multiTab = "Two tabs " + Date.now();
    let failedAcknowledgement = false;
    await secondTab.route(`**/api/v1/conversations/${accountA.user.id}/read`, (route) => {
      if (!failedAcknowledgement) {
        failedAcknowledgement = true;
        return route.abort("failed");
      }
      return route.continue();
    });
    await a.request.post(`/api/v1/conversations/${accountB.user.id}/messages`, {
      headers: { "X-CSRF-Token": accountA.csrf },
      data: { body: multiTab, client_id: multiTab },
    });
    await expect(secondTab.locator(".messages")).toContainText(multiTab);
    await expect(pageB.locator(".messages")).toContainText(multiTab);
    await secondTab.locator(".messages > [data-message-id]").last().scrollIntoViewIfNeeded();
    await secondTab.locator(".messages").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => secondTab.evaluate(() => document.visibilityState)).toBe("visible");
    await expect.poll(async () => (await (await b.request.get("/api/v1/me/summary")).json()).messages).toBe(0);
    expect(failedAcknowledgement).toBe(true);
    await secondTab.close();

    // Removing interest closes the peer's composer; reconnecting restores chat.
    started = Date.now();
    await pageA.getByRole("button", { name: "Remove interest", exact: true }).click();
    await expect(pageA.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
    expect((await b.request.get(`/api/v1/conversations/${accountA.user.id}/messages`)).status()).toBe(403);
    await expect(pageB.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
    timings.disconnect_ms = Date.now() - started;
    await pageA.getByRole("button", { name: "I’m interested", exact: true }).click();
    await expect(pageB.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();

    // A block rejects both reads and sends, and unblocking cannot restore likes.
    blockedByTest = true;
    await pageA.getByRole("button", { name: "Block", exact: true }).click();
    await expect(pageA.getByRole("button", { name: "Block", exact: true })).toHaveCount(0);
    await expect(pageB.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
    expect((await b.request.get(`/api/v1/profiles/${accountA.user.id}`)).status()).toBe(404);
    expect((await b.request.post(`/api/v1/conversations/${accountA.user.id}/messages`, {
      headers: { "X-CSRF-Token": accountB.csrf }, data: { body: "Blocked send", client_id: "blocked-" + Date.now() },
    })).status()).toBe(403);
    await pageA.getByRole("button", { name: /^Activity(?:, \d+ unread)?$/ }).click();
    await pageA.getByRole("tab", { name: "Blocked users", exact: true }).click();
    await pageA.locator(".blocked-row").filter({ hasText: accountB.user.username }).getByRole("button", { name: "Unblock", exact: true }).click();
    await expect(pageA.locator(".blocked-row").filter({ hasText: accountB.user.username })).toHaveCount(0);
    blockedByTest = false;
    const unblocked = await (await b.request.get(`/api/v1/profiles/${accountA.user.id}`)).json();
    expect(unblocked.connected).toBe(false);
    expect(unblocked.liked).toBe(false);
    expect(unblocked.likes_you).toBe(false);
    console.log(`Chat latency ${testInfo.project.name}: ${JSON.stringify(timings)}`);
    await testInfo.attach("chat-latency", { body: JSON.stringify(timings, null, 2), contentType: "application/json" });
  } finally {
    try {
      await b.setOffline(false);
      await cleanup?.();
    } finally {
      await b.close();
    }
  }
});
