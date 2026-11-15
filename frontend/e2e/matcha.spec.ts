import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const password = "Demo!River8Cloud&2026";
async function login(page: Page, username = "demo1") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
}
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
  await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", {
        level: 3,
        name: new RegExp("^" + escaped + ","),
      }),
    })
    .click();
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
  await page.getByLabel("Sort by", { exact: true }).selectOption("fame");
  await page.getByLabel("Order", { exact: true }).selectOption("desc");
  await page.getByRole("button", { name: "Find people", exact: true }).click();
  await expect(page).toHaveURL(/min_age=25/);
  await expect(page).toHaveURL(/direction=desc/);
  await expect(page.getByRole("status")).toHaveCount(0);
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
    page.getByRole("button", { name: "Remove", exact: true }).first(),
  ).toBeVisible();
});

test("mutual interest enables chat and messages arrive within ten seconds", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  const a = await browser.newContext({ baseURL }),
    b = await browser.newContext({ baseURL });
  const pageA = await a.newPage(),
    pageB = await b.newPage();
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
      if (!beforeA.liked)
        await a.request.delete(`/api/v1/profiles/${accountB.user.id}/like`, {
          headers: { "X-CSRF-Token": accountA.csrf },
        });
      if (!beforeB.liked)
        await b.request.delete(`/api/v1/profiles/${accountA.user.id}/like`, {
          headers: { "X-CSRF-Token": accountB.csrf },
        });
    };
    const response = await b.request.post(
      `/api/v1/profiles/${accountA.user.id}/like`,
      { headers: { "X-CSRF-Token": accountB.csrf } },
    );
    expect(response.ok()).toBeTruthy();
    await openPerson(pageA, accountB.user);
    if (!beforeA.liked)
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
    await pageA
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(body);
    await pageA.getByRole("button", { name: "Send", exact: true }).click();
    await expect(pageB.locator(".messages")).toContainText(body, {
      timeout: 10000,
    });
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
    await b.setOffline(false);
    await expect(
      pageB.locator(".messages > .received").filter({ hasText: prefix }),
    ).toHaveCount(120, { timeout: 10000 });
    // Blocking the Socket.IO handshake must leave the HTTP polling fallback usable.
    await pageB.route("**/socket.io/**", (route) => route.abort());
    await pageB.reload();
    await expect(
      pageB.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await openPerson(pageB, accountA.user);
    const fallback = "Polling fallback " + Date.now();
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
  } finally {
    try {
      await b.setOffline(false);
      await cleanup?.();
    } finally {
      await a.close();
      await b.close();
    }
  }
});
