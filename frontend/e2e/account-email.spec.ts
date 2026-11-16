import { test, expect, type Page } from "@playwright/test";

const origin = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8080";
const mailpit = process.env.MAILPIT_API_URL || "http://localhost:8025/api/v1";
const replacementPassword = "Lantern!Garden48River";
const demoPassword = "Matcha!Morning58Garden";

async function delivered(email: string, subject: string) {
  await expect
    .poll(
      async () => {
        const response = await fetch(`${mailpit}/messages`);
        const body = await response.json();
        return body.messages.some(
          (message: { To?: { Address: string }[]; Subject?: string }) =>
            message.Subject === subject &&
            message.To?.some(
              (to) => to.Address.toLowerCase() === email.toLowerCase(),
            ),
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  const response = await fetch(`${mailpit}/messages`);
  const messages = (await response.json()).messages as {
    ID: string;
    Subject: string;
    To: { Address: string }[];
  }[];
  const found = messages.find(
    (message) =>
      message.Subject === subject &&
      message.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
  );
  if (!found) throw new Error(`Mailpit did not return ${subject}`);
  const detail = await (await fetch(`${mailpit}/message/${found.ID}`)).json();
  const text = [detail.Text, detail.HTML, JSON.stringify(detail)]
    .filter(Boolean)
    .join("\n");
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const url = text.match(
    new RegExp(`${escapedOrigin}/#action=[a-z]+&token=[A-Za-z0-9_-]+`),
  );
  if (!url)
    throw new Error(`Could not find the local ${subject} link in Mailpit`);
  return url[0].replace(/&amp;/g, "&");
}

async function useLink(page: Page, url: string) {
  const link = new URL(url);
  link.searchParams.set("__mailpit_reload", String(Date.now()));
  await page.goto(link.toString());
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
}

test("registers and verifies through the Mailpit link, then rejects link reuse", async ({
  page,
  request,
}) => {
  test.setTimeout(30000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const username = `mail${suffix.replace(/-/g, "")}`.slice(0, 30);
  const email = `matcha-${suffix}@example.test`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await page.getByLabel("First name", { exact: true }).fill("Email");
  await page.getByLabel("Last name", { exact: true }).fill("Tester");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Cobalt!Meadow52River");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator(".success")).toContainText("Check your email");
  const verificationLink = await delivered(email, "Verify your Matcha account");
  expect(new URL(verificationLink).search).toBe("");
  await useLink(page, verificationLink);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".success")).toContainText("Account verified");
  await useLink(page, verificationLink);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "expired or already used",
  );
  await page.goto(`${origin}/?after_verification=1`);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Cobalt!Meadow52River");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Let’s start with you." }),
  ).toBeVisible();
  const login = await request.post(`${origin}/api/v1/auth/login`, {
    data: { username, password: "Cobalt!Meadow52River" },
  });
  expect(login.status()).toBe(200);
});

test("resends verification email for an unverified account", async ({
  page,
}) => {
  test.setTimeout(30000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const username = `resend${suffix.replace(/-/g, "")}`.slice(0, 30);
  const email = `resend-${suffix}@example.test`;
  const created = await fetch(`${origin}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email,
      first_name: "Resend",
      last_name: "Tester",
      password: "Copper!Field84River",
    }),
  });
  expect(created.status).toBe(201);
  const before = await (await fetch(`${mailpit}/messages`)).json();
  const initialCount = before.messages.filter(
    (message: { Subject: string; To: { Address: string }[] }) =>
      message.Subject === "Verify your Matcha account" &&
      message.To.some((to) => to.Address === email),
  ).length;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Resend verification email", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Send verification link", exact: true })
    .click();
  await expect(page.locator(".success")).toContainText("check your inbox");
  await expect
    .poll(async () => {
      const messages = await (await fetch(`${mailpit}/messages`)).json();
      return messages.messages.filter(
        (message: { Subject: string; To: { Address: string }[] }) =>
          message.Subject === "Verify your Matcha account" &&
          message.To.some((to) => to.Address === email),
      ).length;
    })
    .toBeGreaterThan(initialCount);
  expect(
    (await delivered(email, "Verify your Matcha account")).includes(
      "#action=verify&token=",
    ),
  ).toBe(true);
});

test("password reset from Mailpit revokes the old session and permits the new password", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(30000);
  const account = await request.get(`${origin}/api/v1/me`);
  expect(account.status()).toBe(401);
  const username = `reset${Date.now()}`;
  const register = await request.post(`${origin}/api/v1/auth/register`, {
    data: {
      username,
      email: `account-${username}@example.test`,
      first_name: "Mail",
      last_name: "Acceptance",
      password: demoPassword,
    },
  });
  expect(register.status()).toBe(201);
  const accountEmail = `account-${username}@example.test`;
  const verification = await delivered(
    accountEmail,
    "Verify your Matcha account",
  );
  const redeem = await request.post(`${origin}/api/v1/auth/token`, {
    data: {
      kind: "verify",
      token: new URLSearchParams(new URL(verification).hash.slice(1)).get(
        "token",
      ),
    },
  });
  expect(redeem.ok()).toBe(true);
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  const resetContext = await browser.newContext();
  const resetPage = await resetContext.newPage();
  await resetPage.goto("/");
  await resetPage
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await resetPage.getByLabel("Email", { exact: true }).fill(accountEmail);
  await resetPage
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(resetPage.locator(".success")).toContainText("check your inbox");
  const resetLink = await delivered(accountEmail, "Reset your Matcha password");
  await useLink(resetPage, resetLink);
  await resetPage
    .getByLabel("Password", { exact: true })
    .fill(replacementPassword);
  await resetPage
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    resetPage.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  const oldLogin = await request.post(`${origin}/api/v1/auth/login`, {
    data: { username, password: demoPassword },
  });
  expect(oldLogin.status()).toBe(401);
  await resetPage.goto("/");
  await resetPage.getByLabel("Username", { exact: true }).fill(username);
  await resetPage
    .getByLabel("Password", { exact: true })
    .fill(replacementPassword);
  await resetPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    resetPage.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  const restored = await request.post(`${origin}/api/v1/auth/login`, {
    data: { username, password: replacementPassword },
  });
  expect(restored.ok()).toBe(true);
  await resetContext.close();
});

test("email change activates only after its delivered verification link", async ({
  page,
}) => {
  test.setTimeout(30000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newEmail = `changed-${suffix}@example.test`;
  const accountEmail = `change-account-${suffix}@example.test`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await page.getByLabel("First name", { exact: true }).fill("Change");
  await page.getByLabel("Last name", { exact: true }).fill("Tester");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`change${suffix.replace(/-/g, "")}`.slice(0, 30));
  await page.getByLabel("Email", { exact: true }).fill(accountEmail);
  await page.getByLabel("Password", { exact: true }).fill(demoPassword);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const verify = await delivered(accountEmail, "Verify your Matcha account");
  await useLink(page, verify);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`change${suffix.replace(/-/g, "")}`.slice(0, 30));
  await page.getByLabel("Password", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await page.getByLabel("New email", { exact: true }).fill(newEmail);
  await page
    .getByRole("button", { name: "Send verification link", exact: true })
    .click();
  await expect(page.locator(".success")).toContainText("Check your new email");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const emailLink = await delivered(newEmail, "Confirm your new Matcha email");
  await useLink(page, emailLink);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await page
    .getByLabel("Username", { exact: true })
    .fill(`change${suffix.replace(/-/g, "")}`.slice(0, 30));
  await page.getByLabel("Password", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await expect(page.getByText(`Current email: ${newEmail}.`)).toBeVisible();
  const reset = await page.request.post(`${origin}/api/v1/auth/reset-request`, {
    data: { email: newEmail },
  });
  expect(reset.ok()).toBe(true);
  await delivered(newEmail, "Reset your Matcha password");
  const messages = await (await fetch(`${mailpit}/messages`)).json();
  expect(
    messages.messages.some(
      (message: { Subject: string; To: { Address: string }[] }) =>
        message.Subject === "Reset your Matcha password" &&
        message.To.some((to) => to.Address === accountEmail),
    ),
  ).toBe(false);
});
