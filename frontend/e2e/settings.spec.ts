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
  photos: [
    { id: 11, is_primary: true },
    { id: 12, is_primary: false },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json:
        path === "/api/v1/me/session" || path === "/api/v1/me"
          ? { user: member, csrf: "test" }
          : path === "/api/v1/me/summary"
            ? { messages: 0, notifications: 0 }
            : path === "/api/v1/tags"
              ? { tags: [] }
              : path === "/api/v1/locations"
                ? { locations: [] }
                : {},
    });
  });
});

test("settings stacks photo cards only on mobile and preserves the desktop grid", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Your photos" }),
  ).toBeVisible();
  for (const width of [320, 375, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    const gps = page.getByRole("button", {
      name: "Use current location",
      exact: true,
    });
    if (width < 640) {
      const inputBounds = (await page.locator("#profile-city").boundingBox())!;
      const gpsBounds = (await gps.boundingBox())!;
      expect(Math.abs(inputBounds.y - gpsBounds.y)).toBeLessThan(2);
      expect(gpsBounds.x).toBeGreaterThan(inputBounds.x + inputBounds.width);
      expect(gpsBounds.width).toBeLessThanOrEqual(50);
      await expect(
        gps.getByText("Use current location", { exact: true }),
      ).toBeHidden();
    } else {
      await expect(
        gps.getByText("Use current location", { exact: true }),
      ).toBeVisible();
    }
    const slots = page.locator("[data-photo-slot]");
    const main = (await slots.nth(0).boundingBox())!;
    const cards = await Promise.all(
      [1, 2, 3, 4].map((i) => slots.nth(i).boundingBox()),
    );
    if (width < 640) {
      for (const card of cards) {
        expect(card!.y).toBeGreaterThanOrEqual(main.y + main.height);
        expect(Math.abs(card!.y - cards[0]!.y)).toBeLessThan(1);
      }
    } else {
      for (const card of cards) {
        expect(card!.x).toBeGreaterThanOrEqual(main.x + main.width);
        expect(card!.y + card!.height).toBeLessThanOrEqual(
          main.y + main.height + 1,
        );
      }
      expect(Math.abs(cards[0]!.y - main.y)).toBeLessThan(1);
      expect(Math.abs(cards[1]!.y - main.y)).toBeLessThan(1);
      expect(cards[2]!.y).toBeGreaterThan(cards[0]!.y);
      expect(Math.abs(cards[2]!.y - cards[3]!.y)).toBeLessThan(1);
    }
    const map = (await page
      .getByRole("img", { name: /Illustrative map/ })
      .boundingBox())!;
    expect(map.x + map.width).toBeLessThanOrEqual(width);
  }
});

test("location illustration follows theme changes", async ({ page }) => {
  await page.goto("/settings");
  const map = page.getByRole("img", { name: /Illustrative map/ });
  await expect(map).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const light = await map.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    roads: getComputedStyle(el).backgroundImage,
  }));
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const dark = await map.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    roads: getComputedStyle(el).backgroundImage,
  }));
  expect(dark.background).not.toBe(light.background);
  expect(dark.roads).not.toBe(light.roads);
});

test("photo selection previews independently from the main photo, with star and delete actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/settings");
  const slots = page.locator("[data-photo-slot]");
  const primaryStar = page.getByRole("button", {
    name: "Make photo 1 your main photo",
    exact: true,
  });
  await expect(primaryStar).toHaveAttribute("aria-pressed", "true");
  await expect(primaryStar.locator("svg")).toHaveAttribute(
    "fill",
    "currentColor",
  );
  await expect(page.getByText("MAIN PHOTO", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preview photo 2", exact: true })
    .click();
  await expect(slots.first()).toHaveAttribute("data-photo-slot", "1");
  await expect(slots.first().locator("img")).toHaveAttribute(
    "src",
    "/api/v1/photos/12",
  );
  await expect(primaryStar).toHaveCount(0);
  await expect(
    slots.nth(1).getByRole("button", { name: /Make photo|Delete photo/ }),
  ).toHaveCount(0);
  const otherStar = page.getByRole("button", {
    name: "Make photo 2 your main photo",
    exact: true,
  });
  await expect(otherStar).toHaveAttribute("aria-pressed", "false");
  await expect(otherStar.locator("svg")).toHaveAttribute("fill", "none");
  const makeMain = page.waitForRequest(
    (req) => req.url().endsWith("/me/photos/12") && req.method() === "PUT",
  );
  await otherStar.click();
  await makeMain;
  await page
    .getByRole("button", { name: "Preview photo 1", exact: true })
    .click();
  const deletePhoto = page.waitForRequest(
    (req) => req.url().endsWith("/me/photos/11") && req.method() === "DELETE",
  );
  await page
    .getByRole("button", { name: "Delete photo 1", exact: true })
    .click();
  await deletePhoto;
});

const springfield = {
  id: "mapbox:illinois",
  city: "Springfield",
  country: "United States",
  region: "Illinois, United States",
  latitude: 39.78,
  longitude: -89.65,
};

test("dynamic city search distinguishes matching names and saves the selected ID", async ({
  page,
}) => {
  const queries: string[] = [];
  await page.route("**/api/v1/locations?**", async (route) => {
    queries.push(new URL(route.request().url()).searchParams.get("q") || "");
    await route.fulfill({
      json: {
        locations: [
          springfield,
          {
            ...springfield,
            id: "mapbox:massachusetts",
            region: "Massachusetts, United States",
            latitude: 42.1,
            longitude: -72.59,
          },
        ],
      },
    });
  });
  await page.goto("/settings");
  const city = page.locator("#profile-city");
  await city.click();
  await city.fill("Spring");
  const option = page.getByRole("option").filter({ hasText: "Illinois" });
  await expect(option).toBeVisible();
  await expect(page.locator("[data-slot=combo-box-popover]")).toHaveCSS(
    "opacity",
    "1",
  );
  await option.click();
  await expect(city).toHaveValue("Springfield");
  expect(queries).toEqual(["Spring"]);
  const save = page.waitForRequest(
    (req) => req.url().endsWith("/me/profile") && req.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  expect((await save).postDataJSON()).toMatchObject({
    city: "Springfield",
    location_id: "mapbox:illinois",
    latitude: 39.78,
    longitude: -89.65,
    location_source: "manual",
  });
  await expect(
    page.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeDisabled();
  await city.fill("Springfiel");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByText("Choose a city from the suggestions, or use GPS.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("city search reports an outage and retries, then reports empty results", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/v1/locations?**", async (route) => {
    attempts++;
    await route.fulfill(
      attempts === 1
        ? { status: 503, json: { error: { message: "Search unavailable" } } }
        : { json: { locations: [] } },
    );
  });
  await page.goto("/settings");
  await page.locator("#profile-city").fill("Unlisted");
  await page
    .getByRole("button", { name: "Retry city suggestions", exact: true })
    .click();
  await expect(
    page.getByText("No matching cities found. Try another name or use GPS.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});

test("GPS reverse lookup suggests a city while retaining GPS coordinates", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 33.45123, longitude: -7.65123 });
  await page.route("**/api/v1/locations?**", async (route) => {
    await route.fulfill({
      json: {
        locations: [
          {
            ...springfield,
            id: "mapbox:bouskoura",
            city: "Bouskoura",
            country: "Morocco",
            latitude: 33.45,
            longitude: -7.65,
          },
        ],
      },
    });
  });
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  await expect(page.locator("#profile-city")).toHaveValue("Bouskoura");
  const save = page.waitForRequest(
    (req) => req.url().endsWith("/me/profile") && req.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  const payload = (await save).postDataJSON();
  expect(payload).toMatchObject({
    city: "Bouskoura",
    latitude: 33.45123,
    longitude: -7.65123,
    location_source: "gps",
  });
  expect(payload).not.toHaveProperty("location_id");
});
