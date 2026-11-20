import { test, expect } from "@playwright/test";

const member = {
  id: 1,
  username: "alex",
  email: "alex@example.com",
  first_name: "Alex",
  last_name: "River",
  birth_date: null,
  gender: null,
  preferences: [],
  bio: "",
  city: null,
  latitude: null,
  longitude: null,
  map_visible: false,
  tags: [],
  photos: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/v1/me/session"
        ? { user: member, csrf: "test" }
        : path === "/api/v1/me/summary"
          ? { messages: 123, notifications: 45 }
          : path === "/api/v1/profiles"
            ? { profiles: [], total: 0, page: 1, page_size: 24 }
            : path === "/api/v1/profiles/1"
              ? { ...member, age: null, fame: 0 }
              : path === "/api/v1/tags"
                ? { tags: [] }
                : path === "/api/v1/locations"
                  ? { locations: [] }
                  : {};
    await route.fulfill({ json: body });
  });
});

test("avatar menu supports profile, theme submenu and logout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/discover");
  const header = page.locator("header");
  const avatar = header.getByRole("button", { name: "Open account menu" });
  await expect(avatar).toBeVisible();
  expect((await avatar.boundingBox())?.width).toBe(36);
  await expect(
    header.getByRole("button", { name: "Log out", exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: /Switch to .* mode/ }),
  ).toHaveCount(0);
  await avatar.click();
  await page.getByRole("menuitem", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("theme")))
    .toBe("light");
  await avatar.click();
  await page.getByRole("menuitem", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await avatar.click();
  await expect(
    page.getByRole("menu", { name: "Open account menu", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menu", { name: "Open account menu", exact: true }),
  ).toBeHidden();
  await expect(avatar).toBeFocused();
  await avatar.click();
  await page.getByRole("menuitem", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByText("This is how other members see your profile."),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await avatar.click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("tablet uses small unread dots and keeps the header on one row", async ({
  page,
}) => {
  for (const width of [768, 820, 1023]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/discover");
    const header = page.locator("header");
    const messages = header.getByRole("button", {
      name: "Messages, 123 unread",
    });
    await expect(messages).toBeVisible();
    const dots = messages.locator("span[aria-hidden=true]");
    await expect(dots.first()).toBeVisible();
    await expect(dots.last()).toBeHidden();
    expect((await dots.first().boundingBox())?.width).toBe(8);
    expect((await header.boundingBox())!.height).toBeLessThan(85);
    const headerBounds = (await header.boundingBox())!;
    const maskBounds = (await page
      .locator("div.pointer-events-none.fixed.inset-x-0")
      .boundingBox())!;
    expect(maskBounds.y + maskBounds.height).toBe(
      headerBounds.y + headerBounds.height,
    );
    expect(
      await header.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBeTruthy();
  }
});

test("mobile drawer separates actions, traps focus, closes and supports logout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover");
  const header = page.locator("header");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await expect(trigger).toBeVisible();
  await expect(header.getByRole("navigation")).toBeHidden();
  await expect(
    header.getByRole("button", { name: "Open account menu", exact: true }),
  ).toBeHidden();
  const pageWidth = await page
    .locator("main")
    .evaluate((el) => el.getBoundingClientRect().width);
  await expect(trigger).toContainText("AR");
  await expect(trigger.locator("svg")).toHaveCount(0);
  await expect(trigger.getByLabel("Unread updates")).toHaveCount(0);
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Alex River", exact: true });
  await expect(drawer).toBeVisible();
  expect(
    await page
      .locator("main")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(pageWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await expect
    .poll(async () => {
      const bounds = (await drawer.boundingBox())!;
      return Math.round(bounds.x + bounds.width);
    })
    .toBe(viewportWidth);
  await expect(drawer.getByText("Alex River", { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Profile", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "View profile", exact: true }),
  ).toHaveCount(0);
  await drawer.getByText("Alex River", { exact: true }).click();
  await expect(page).toHaveURL(/\/discover$/);
  expect(
    (
      await drawer
        .getByRole("button", { name: "Close navigation" })
        .boundingBox()
    )?.width,
  ).toBe(32);
  const actions = (await drawer
    .getByRole("region", { name: "Account actions" })
    .boundingBox())!;
  const navigation = (await drawer.getByRole("navigation").boundingBox())!;
  expect(actions.y).toBeGreaterThan(navigation.y + navigation.height);
  expect(actions.y + actions.height).toBeGreaterThan(750);
  expect(
    await drawer.evaluate((el) =>
      el
        .getAnimations()
        .some((animation) =>
          animation.effect
            ?.getKeyframes()
            .some((frame) => frame.transform === "translateX(100%)"),
        ),
    ),
  ).toBeTruthy();
  await expect(drawer.getByRole("navigation")).toBeVisible();
  const profileBefore = (await drawer
    .getByRole("button", { name: "Profile", exact: true })
    .boundingBox())!;
  await drawer.getByRole("button", { name: "Theme", exact: true }).click();
  expect(
    (await drawer
      .getByRole("button", { name: "Profile", exact: true })
      .boundingBox())!.y,
  ).toBe(profileBefore.y);
  const themeChoices = (await drawer
    .getByRole("group", { name: "Theme", exact: true })
    .boundingBox())!;
  const themeTrigger = (await drawer
    .getByRole("button", { name: "Theme", exact: true })
    .boundingBox())!;
  expect(themeChoices.width).toBe(themeTrigger.width);
  expect(themeChoices.x).toBe(themeTrigger.x);
  expect(themeChoices.y + themeChoices.height).toBeLessThanOrEqual(
    themeTrigger.y,
  );
  await drawer.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(
    drawer.getByRole("group", { name: "Theme", exact: true }),
  ).toHaveCount(0);
  await expect(
    drawer.getByRole("button", { name: "Theme", exact: true }),
  ).toBeFocused();
  await drawer.getByRole("button", { name: "Theme", exact: true }).click();
  await drawer.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    drawer.getByRole("group", { name: "Theme", exact: true }),
  ).toHaveCount(0);
  await drawer.getByRole("button", { name: "Theme", exact: true }).click();
  await drawer.getByRole("button", { name: "Close navigation" }).focus();
  await expect(
    drawer.getByRole("region", { name: "Account actions" }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Messages, 123 unread" }),
  ).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(
    await drawer.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBeTruthy();
  if (
    (await drawer
      .getByRole("button", { name: "Theme", exact: true })
      .getAttribute("aria-expanded")) !== "true"
  ) {
    await drawer.getByRole("button", { name: "Theme", exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await expect(
    drawer.getByRole("group", { name: "Theme", exact: true }),
  ).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(
    await page
      .locator("main")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(pageWidth);
  await trigger.click();
  await expect(
    drawer.getByRole("button", { name: "Theme", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    drawer.getByRole("group", { name: "Theme", exact: true }),
  ).toHaveCount(0);
  await drawer.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/profile$/);
  await trigger.click();
  const profileLink = drawer.getByRole("button", {
    name: "Profile",
    exact: true,
  });
  await expect(profileLink).toHaveAttribute("aria-current", "page");
  await expect(profileLink).toHaveClass(/bg-matcha-accent/);
  await expect(
    drawer.getByRole("button", { name: "Discover", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(drawer).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.style.overflow),
  ).toBe("");
  await page.setViewportSize({ width: 375, height: 812 });
  await trigger.click();
  const loggedOut = page.waitForRequest(
    (request) =>
      request.url().endsWith("/auth/logout") && request.method() === "POST",
  );
  await drawer.getByRole("button", { name: "Log out", exact: true }).click();
  await loggedOut;
  await expect(page).toHaveURL(/\/$/);
});

test("activity toasts offer related actions, pause on focus, and avoid duplicate events", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.unroute("**/socket.io/**");
  const queue: string[] = [];
  let pending: import("@playwright/test").Route | undefined;
  const send = (packet: string) => {
    if (pending) {
      const route = pending;
      pending = undefined;
      void route
        .fulfill({ contentType: "text/plain", body: packet })
        .catch(() => {});
    } else queue.push(packet);
  };
  await page.route("**/socket.io/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const packet = request.postData() || "";
      if (packet === "40") send('40{"sid":"activity-test"}');
      const heartbeat = packet.match(/^42(\d+)\["heartbeat"/);
      if (heartbeat) send(`43${heartbeat[1]}[{"authenticated":true}]`);
      await route.fulfill({ contentType: "text/plain", body: "ok" });
    } else if (!new URL(request.url()).searchParams.has("sid")) {
      await route.fulfill({
        contentType: "text/plain",
        body: '0{"sid":"activity-test","upgrades":[],"pingInterval":25000,"pingTimeout":20000}',
      });
    } else if (queue.length) {
      await route.fulfill({
        contentType: "text/plain",
        body: queue.splice(0).join("\x1e"),
      });
    } else pending = route;
  });
  const notification = {
    id: 500,
    actor: 2,
    first_name: "Jamie",
    last_name: "Green",
    username: "jamie",
    kind: "like",
    is_read: false,
  };
  await page.route("**/api/v1/notifications", (route) =>
    route.fulfill({
      json: {
        notifications: [{ ...notification }],
      },
    }),
  );
  await page.goto("/discover");
  await expect(page.locator("main")).toHaveAttribute(
    "data-connection-state",
    "connected",
  );
  const toast = page
    .getByRole("status")
    .filter({ hasText: "Jamie Green liked your profile" });
  await expect(toast).toHaveCount(0);
  send('42["notification",{"id":500,"kind":"like","actor":2}]');
  await expect(toast).toBeVisible();
  await expect(toast.locator("svg.lucide-heart")).toHaveCount(1);
  await expect(toast.getByText("View profile", { exact: true })).toHaveCount(0);
  const started = Date.now();
  await expect(
    toast.getByRole("link", { name: "Jamie Green liked your profile" }),
  ).toHaveAttribute("href", "/profile/2");
  await expect(toast).toBeHidden({ timeout: 9500 });
  expect(Date.now() - started).toBeGreaterThan(7000);
  send('42["notification",{"id":500,"kind":"like","actor":2}]');
  await expect(toast).toHaveCount(0);

  await page.route("**/api/v1/conversations", (route) =>
    route.fulfill({ json: { conversations: [] } }),
  );
  await page.route("**/api/v1/conversations/2/messages?*", (route) =>
    route.fulfill({ json: { messages: [], latest: 0, next_before: null } }),
  );
  notification.id = 501;
  notification.kind = "message";
  send('42["notification",{"id":501}]');
  const messageToast = page
    .getByRole("status")
    .filter({ hasText: "Jamie Green sent you a message" });
  const action = messageToast.getByRole("link", {
    name: "Jamie Green sent you a message",
  });
  await expect(action).toHaveAttribute("href", "/messages?conversation=2");
  await expect(messageToast.locator("svg.lucide-message-circle")).toHaveCount(
    1,
  );
  await page.clock.install();
  await action.focus();
  await page.clock.fastForward(9000);
  await expect(action).toBeVisible();
  await action.click();
  await expect(page).toHaveURL(/\/messages\?conversation=2$/);
  await expect(messageToast).toHaveCount(0);

  await page.route("**/api/v1/profiles/2", (route) =>
    route.fulfill({
      json: {
        ...member,
        id: 2,
        first_name: "Jamie",
        age: 24,
        fame: 0,
        connected: true,
      },
    }),
  );
  await page.route("**/api/v1/profiles/2/status", (route) =>
    route.fulfill({ json: { connected: true } }),
  );
  await page.route("**/api/v1/conversations/2/dates", (route) =>
    route.fulfill({ json: { events: [] } }),
  );
  notification.id = 502;
  notification.kind = "date_invite";
  send('42["notification",{"id":502}]');
  await page
    .getByRole("link", { name: "Jamie Green invited you to plan a date" })
    .click();
  await expect(page).toHaveURL(/\/profile\/2#date-plans$/);
  await expect(
    page.getByRole("dialog", { name: "Calls and date plans" }),
  ).toBeVisible();
});

test("active Activity count stays readable in both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/me/activity", (route) =>
    route.fulfill({
      json: {
        visitors: [],
        likes: [],
        sent: [],
        connections: [],
        blocks: [],
        next_before: null,
      },
    }),
  );
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({ json: { notifications: [], next_before: null } }),
  );
  await page.goto("/activity");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Alex River", exact: true });
  const activity = drawer.getByRole("button", { name: "Activity, 45 unread" });
  await expect(activity).toHaveAttribute("aria-current", "page");
  const badge = activity.locator("span[aria-hidden=true]").last();
  await expect(badge).toHaveText("45");
  for (const theme of ["Light", "Dark"]) {
    await drawer.getByRole("button", { name: "Theme", exact: true }).click();
    await drawer.getByRole("button", { name: theme, exact: true }).click();
    const contrast = await badge.evaluate((element) => {
      const style = getComputedStyle(element);
      const context = document.createElement("canvas").getContext("2d")!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const linear = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const foreground = luminance(style.color),
        background = luminance(style.backgroundColor);
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
});
