import { test, expect } from "@playwright/test";

const member = {
  id: 1,
  username: "alex",
  email: "alex@example.com",
  first_name: "Alex",
  last_name: "River",
  birth_date: "1995-01-01",
  gender: "man",
  preferences: ["woman"],
  bio: "A little about me.",
  city: "Casablanca",
  latitude: 33.57,
  longitude: -7.58,
  map_visible: false,
  tags: ["music"],
  photos: [{ id: 11, is_primary: true }],
};
const nearby = {
  id: 2,
  first_name: "Sam",
  last_name: "Rivera",
  gender: "woman",
  age: 29,
  city: "Casablanca",
  latitude: 33.575,
  longitude: -7.585,
  photo_id: 22,
};
let mapUsersResponse = [
  nearby,
  {
    ...nearby,
    id: 3,
    first_name: "Far",
    city: "Paris",
    latitude: 48.85,
    longitude: 2.35,
  },
];

test.beforeEach(async ({ page }) => {
  mapUsersResponse = [
    nearby,
    {
      ...nearby,
      id: 3,
      first_name: "Far",
      city: "Paris",
      latitude: 48.85,
      longitude: 2.35,
    },
  ];
  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/photos/22")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#883578"/><circle cx="32" cy="24" r="12" fill="#f4a9e8"/><path d="M8 64a24 24 0 0 1 48 0" fill="#f4a9e8"/></svg>',
      });
    await route.fulfill({
      json:
        path === "/api/v1/me/session" || path === "/api/v1/me"
          ? { user: member, csrf: "test" }
          : path === "/api/v1/map/users"
            ? { users: mapUsersResponse }
            : path === "/api/v1/profiles/2"
              ? {
                  ...nearby,
                  username: "sam",
                  bio: "Hello",
                  tags: ["music"],
                  gender: "woman",
                  preferences: ["man"],
                  fame: 10,
                }
              : path === "/api/v1/me/summary"
                ? { messages: 0, notifications: 0 }
                : {},
    });
  });
});

test("Mapbox opens at the saved city without reframing for distant people", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const worker = page.waitForEvent("worker");
  await page.goto("/map");
  await worker;
  const map = page.getByRole("region", {
    name: "Interactive map of nearby people",
    exact: true,
  });
  await expect(map.locator(".mapboxgl-canvas")).toBeVisible();
  await expect(
    map.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeVisible();
  await expect(
    map.getByRole("link", { name: "Mapbox homepage", exact: true }),
  ).toBeVisible();
  await expect(
    map.getByRole("img", { name: "Your approximate location" }),
  ).toHaveCount(0);
  for (const [width, height] of [
    [375, 812],
    [1440, 900],
    [1280, 720],
    [375, 667],
    [667, 375],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollHeight <=
            document.documentElement.clientHeight,
        ),
      )
      .toBe(true);
    const frame = (await map.boundingBox())!;
    expect(frame.height).toBeGreaterThan(80);
    expect(frame.y + frame.height).toBeLessThanOrEqual(height);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByText("YOUR LITTLE CORNER", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/people chose to share|No one nearby|Pins appear only/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Refresh map|Manage location sharing/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => page.workers().length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("map.png") });
  const marker = map.getByRole("button", {
    name: "Show Sam Rivera's location",
    exact: true,
  });
  await expect(marker.locator("img")).toHaveAttribute(
    "src",
    "/api/v1/photos/22",
  );
  expect((await marker.boundingBox())!.width).toBeGreaterThan(36);
  await marker.click();
  const card = map.getByRole("group", {
    name: "Sam Rivera profile preview",
    exact: true,
  });
  await expect(card.getByText("Sam Rivera", { exact: true })).toBeVisible();
  await expect(card.getByText("Woman · 29", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("img", { name: "Sam Rivera's avatar", exact: true }),
  ).toBeVisible();
  await expect(card.locator("img")).toHaveAttribute("src", "/api/v1/photos/22");
  await expect(
    card.getByRole("button", { name: "View profile ↗", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "View Sam Rivera's profile", exact: true }),
  ).toHaveAttribute("href", "/profile/2");
  const close = map.locator(".mapboxgl-popup-close-button");
  await close.hover();
  await expect(close).toHaveCSS(
    "background-color",
    await map.evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await page.screenshot({ path: testInfo.outputPath("map-card.png") });
  await card.getByRole("link", { name: "Sam Rivera", exact: true }).click();
  await expect(page).toHaveURL(/\/profile\/2$/);
});

test("nearby people cluster together and expand into avatar markers", async ({
  page,
}) => {
  const colocated = Array.from({ length: 10 }, (_, index) => ({
    ...nearby,
    id: index + 2,
    first_name: `Person${index + 1}`,
    photo_id: null,
    latitude: 33.57,
    longitude: -7.58,
  }));
  mapUsersResponse = colocated;
  await page.goto("/map");
  const map = page.getByRole("region", {
    name: "Interactive map of nearby people",
    exact: true,
  });
  const avatars = map.getByRole("button", {
    name: /^Show Person\d+ Rivera's location$/,
  });
  await expect(avatars).toHaveCount(0);
  const avatarElements = map.locator(
    "button[aria-label^='Show Person'][aria-label$=\"'s location\"]",
  );
  await expect(avatarElements).toHaveCount(10);
  await expect
    .poll(() =>
      avatarElements.evaluateAll((elements) =>
        elements.every(
          (element) =>
            (element as HTMLButtonElement).hidden &&
            getComputedStyle(element).display === "none",
        ),
      ),
    )
    .toBe(true);
  const canvas = map.locator(".mapboxgl-canvas");
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: bounds.width / 2, y: bounds.height / 2 },
  });
  await expect(avatars).toHaveCount(10);
});

test("Mapbox changes style with the theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  const darkStyle = page.waitForResponse(
    (res) =>
      res.url().includes("/styles/v1/mapbox/dark-v11") && res.status() === 200,
  );
  await page.goto("/map");
  await darkStyle;
  await page
    .getByRole("button", { name: "Open account menu", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Theme", exact: true }).click();
  const lightStyle = page.waitForResponse(
    (res) =>
      res.url().includes("/styles/v1/mapbox/light-v11") && res.status() === 200,
  );
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await lightStyle;
  await expect(
    page.getByRole("img", { name: "Your approximate location" }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("avatar markers fall back to initials and show a compact card on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/photos/22", (route) => route.abort());
  await page.goto("/map");
  const map = page.getByRole("region", {
    name: "Interactive map of nearby people",
    exact: true,
  });
  const marker = map.getByRole("button", {
    name: "Show Sam Rivera's location",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await expect(marker.locator("img")).toHaveCount(0);
  await expect(marker.getByText("SR", { exact: true })).toBeVisible();
  await marker.focus();
  await page.keyboard.press("Enter");
  const card = map.getByRole("group", {
    name: "Sam Rivera profile preview",
    exact: true,
  });
  await expect(card.getByText("Sam Rivera", { exact: true })).toBeVisible();
  await expect(card.getByText("Woman · 29", { exact: true })).toBeVisible();
  await expect(card.getByText("SR", { exact: true })).toBeVisible();
  const bounds = (await card.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await card
    .getByRole("link", { name: "View Sam Rivera's profile", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/profile\/2$/);
});
