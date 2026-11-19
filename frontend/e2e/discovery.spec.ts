import { expect, test } from "@playwright/test";

const member = {
  id: 1,
  username: "alex",
  email: "alex@example.com",
  first_name: "Alex",
  last_name: "River",
  birth_date: "1997-01-01",
  gender: "male",
  preferences: ["female"],
  bio: "Coffee and conversation",
  city: "Rabat",
  latitude: 34,
  longitude: -6.8,
  map_visible: false,
  tags: ["coffee"],
  photos: [],
};
const people = [
  {
    id: 2,
    photo_id: 21,
    photos: [
      { id: 21, is_primary: true },
      { id: 22, is_primary: false },
    ],
    first_name: "Yasmine",
    username: "yas_27",
    last_name: "El Amrani",
    age: 27,
    city: "Rabat",
    distance: 1.24,
    tags: ["coffee", "music", "books"],
    online: true,
    liked: false,
    fame: 30,
  },
  {
    id: 3,
    first_name: "Salma",
    username: "salma_b",
    last_name: "Bennani",
    age: 25,
    city: "Salé",
    distance: 2.4,
    tags: ["music"],
    online: false,
    liked: true,
    fame: 20,
  },
  {
    id: 4,
    first_name: "Imane",
    username: "imane_a",
    last_name: "Alaoui",
    age: 26,
    city: "Rabat",
    distance: 4.8,
    tags: ["coffee"],
    online: false,
    liked: false,
    fame: 10,
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.startsWith("/api/v1/photos/")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#dcb9d5"/><circle cx="150" cy="150" r="60" fill="#886080"/><ellipse cx="150" cy="390" rx="130" ry="140" fill="#66445f"/></svg>',
      });
      return;
    }
    let body: unknown = {};
    if (path.endsWith("/like")) body = { connected: false };
    else if (path === "/api/v1/me/session")
      body = { user: member, csrf: "test" };
    else if (path === "/api/v1/me/summary")
      body = { messages: 0, notifications: 0 };
    else if (path === "/api/v1/profiles") {
      const query = (url.searchParams.get("q") || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      const profiles =
        url.searchParams.get("city") === "Nowhere"
          ? []
          : people.filter(
              (person) =>
                !query ||
                (query.startsWith("@")
                  ? person.username === query.slice(1)
                  : [
                      person.first_name,
                      person.last_name,
                      `${person.first_name} ${person.last_name}`,
                      person.username,
                    ].some((value) => value.toLowerCase() === query)),
            );
      body = { profiles, total: profiles.length, page: 1, page_size: 12 };
    } else if (path === "/api/v1/tags") body = { tags: [] };
    else if (path === "/api/v1/locations") body = { locations: [] };
    await route.fulfill({ json: body });
  });
});

test("cards use profile data and support likes and session dismissal", async ({
  page,
}) => {
  test.skip(
    test.info().project.name === "mobile",
    "Mobile uses the swipe deck below.",
  );
  await page.goto("/discover");
  await expect(
    page
      .getByRole("region", { name: "Find your kind of connection." })
      .getByRole("status"),
  ).toContainText("3 people near you");
  const card = page.getByRole("article", { name: "Yasmine's profile" });
  await expect(card).toContainText("1.2 km away");
  await expect(card).toContainText("#coffee");
  await expect(card).toContainText("+1");
  await expect(card.getByText("Online", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `/tmp/matcha-discover-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await card.getByRole("button", { name: "Like Yasmine", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Remove interest in Yasmine" }),
  ).toHaveAttribute("aria-pressed", "true");
  await card
    .getByRole("button", { name: "Remove interest in Yasmine" })
    .click();
  await expect(
    card.getByRole("button", { name: "Like Yasmine", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await card
    .getByRole("button", { name: "Dismiss Yasmine for this session" })
    .click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("drawer stages filters, previews counts, applies sorting and supports empty state recovery", async ({
  page,
}) => {
  await page.goto("/discover");
  const mobile = page.viewportSize()!.width < 640;
  if (!mobile) {
    await page
      .getByRole("button", { name: "Recommended Sort suggestions" })
      .click();
    await page.getByRole("option", { name: "Fame", exact: true }).click();
  } else {
    await expect(
      page.getByRole("button", { name: "Recommended Sort suggestions" }),
    ).toBeHidden();
  }
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Filters" });
  if (mobile) {
    await drawer
      .getByRole("button", { name: "Recommended Sort suggestions" })
      .click();
    await page.getByRole("option", { name: "Fame", exact: true }).click();
    await expect(page).not.toHaveURL(/sort=fame/);
  }
  await expect(drawer).toBeVisible();
  await page.screenshot({
    path: `/tmp/matcha-discover-drawer-${test.info().project.name}.png`,
    animations: "disabled",
  });
  await drawer.getByLabel("City or neighborhood").fill("Nowhere");
  await expect(
    drawer.getByRole("button", { name: "Show 0 people", exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/city=/);
  if (mobile)
    await expect(drawer.getByText("Sort by", { exact: true })).toBeVisible();
  else await expect(drawer.getByText("Sort by", { exact: true })).toBeHidden();
  await drawer.getByRole("button", { name: "Descending", exact: true }).click();
  await drawer
    .getByRole("button", { name: "Show 0 people", exact: true })
    .click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/city=Nowhere/);
  await expect(page).toHaveURL(/sort=fame&direction=desc/);
  await expect(page.getByText("A little room for possibility")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Remove Nowhere filter" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(
    page.viewportSize()!.width < 640 ? 1 : 3,
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await drawer.getByLabel("City or neighborhood").fill("Cancel me");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(drawer.getByLabel("City or neighborhood")).toHaveValue("");
});

test("strict name and username search creates removable filters and layout fits the viewport", async ({
  page,
}) => {
  await page.goto("/discover");
  const search = page.getByLabel("Search by name or username", { exact: true });
  for (const text of ["coffee", "yas", "asmin"]) {
    await search.fill(text);
    await search.press("Enter");
    await expect(page.getByText("A little room for possibility")).toBeVisible();
  }
  await search.fill("YASMINE");
  await search.press("Enter");
  await expect(
    page.getByRole("article", { name: "Yasmine's profile" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await search.fill("@yas_27");
  await search.press("Enter");
  await expect(
    page.getByRole("article", { name: "Yasmine's profile" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=%40yas_27/);
  await search.fill("Yasmine El Amrani");
  await search.press("Enter");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Remove Search: Yasmine El Amrani filter" })
    .click();
  await expect(page.getByRole("article")).toHaveCount(
    page.viewportSize()!.width < 640 ? 1 : 3,
  );
  await search.fill("Bennani");
  await search.press("Enter");
  await expect(
    page.getByRole("article", { name: "Salma's profile" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.reload();
  await expect(search).toHaveValue("Bennani");
  await page.getByRole("button", { name: "Filters", exact: false }).click();
  const filterDrawer = page.getByRole("dialog", { name: "Filters" });
  await filterDrawer
    .getByRole("button", { name: "Show 1 person", exact: true })
    .click();
  await expect(page).toHaveURL(/q=Bennani/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  if (page.viewportSize()!.width >= 640) {
    const sort = page.getByRole("button", {
      name: "Recommended Sort suggestions",
    });
    const labelBounds = await sort
      .locator('[data-slot="select-value"]')
      .boundingBox();
    const chevronBounds = await sort
      .locator(".select__indicator")
      .boundingBox();
    expect(
      chevronBounds!.x - (labelBounds!.x + labelBounds!.width),
    ).toBeGreaterThanOrEqual(12);
  }
  await page.getByRole("button", { name: /Filters/ }).click();
  const drawer = page.getByRole("dialog", { name: "Filters" });
  await expect(drawer).toBeVisible();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await expect
    .poll(async () => {
      const bounds = await drawer.boundingBox();
      return Math.round(bounds!.x + bounds!.width);
    })
    .toBe(viewport.width);
  const bounds = await drawer.boundingBox();
  expect(bounds!.x + bounds!.width).toBeCloseTo(viewport.width, 0);
  expect(bounds!.y).toBe(0);
  expect(bounds!.height).toBeCloseTo(viewport.height, 0);
  await drawer.getByRole("button", { name: "Close filters" }).click();
  await expect(page.getByRole("button", { name: /Filters/ })).toBeFocused();
});

test("mobile deck supports photos, swiping, like and undo", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "mobile");
  await page.goto("/discover");
  const yasmine = page.getByRole("article", { name: "Yasmine's profile" });
  await expect(yasmine).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(yasmine).toContainText("1.2 km away");
  await yasmine.getByRole("button", { name: "Next photo of Yasmine" }).click();
  await expect(
    yasmine.getByRole("img", { name: "Yasmine’s profile photo" }),
  ).toHaveAttribute("src", "/api/v1/photos/22");
  await yasmine
    .getByRole("button", { name: "Previous photo of Yasmine" })
    .click();
  await page.screenshot({
    path: "/tmp/matcha-mobile-deck.png",
    fullPage: true,
    animations: "disabled",
  });
  const bounds = (await yasmine.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 140,
    bounds.y + bounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("article", { name: "Salma's profile" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo last choice" }).click();
  await expect(yasmine).toBeVisible();
  const likeRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/profiles/2/like") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Like Yasmine", exact: true }).click();
  await likeRequest;
  await expect(
    page.getByRole("article", { name: "Salma's profile" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: /You both/ })).toHaveCount(0);
  const unlikeRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/profiles/2/like") &&
      request.method() === "DELETE",
  );
  await page.getByRole("button", { name: "Undo last choice" }).click();
  await unlikeRequest;
  await expect(yasmine).toBeVisible();
  const restoredBounds = (await yasmine.boundingBox())!;
  await page.mouse.move(
    restoredBounds.x + restoredBounds.width / 2,
    restoredBounds.y + restoredBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    restoredBounds.x + restoredBounds.width / 2 + 130,
    restoredBounds.y + restoredBounds.height / 2,
    { steps: 12 },
  );
  await expect(yasmine.getByText("INTERESTED", { exact: true })).toHaveCSS(
    "opacity",
    "1",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.mouse.up();
  await expect(
    page.getByRole("article", { name: "Salma's profile" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const salma = page.getByRole("article", { name: "Salma's profile" });
  await expect(salma.locator(".lucide-chevron-up")).toHaveCount(0);
  const cardButton = salma.getByRole("button", {
    name: "View Salma's profile",
  });
  expect((await cardButton.boundingBox())!.width).toBeCloseTo(
    (await salma.boundingBox())!.width,
    0,
  );
  await page.route("**/api/v1/profiles/3", (route) =>
    route.fulfill({
      json: {
        ...people[1],
        bio: "Coffee and conversation",
        gender: "female",
        preferences: ["male"],
        photos: [],
      },
    }),
  );
  await cardButton.click({ position: { x: 20, y: 20 } });
  await expect(page).toHaveURL(/\/profile\/3$/);
});

test("mobile connection overlay uses confirmed match data and opens the conversation", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "mobile");
  await page.route("**/api/v1/profiles/2/like", (route) =>
    route.fulfill({ json: { connected: true } }),
  );
  await page.goto("/discover");
  await page.getByRole("button", { name: "Like Yasmine", exact: true }).click();
  const connection = page.getByRole("dialog", { name: /You both/ });
  await expect(connection).toBeVisible();
  await expect(connection).toContainText("You and Yasmine are now connected.");
  await page.screenshot({
    path: "/tmp/matcha-mobile-connection.png",
    animations: "disabled",
  });
  await connection.getByRole("button", { name: "Say hello" }).click();
  await expect(page).toHaveURL(/messages\?conversation=2/);
});

test("mobile keeps the card when a like fails", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile");
  await page.route("**/api/v1/profiles/2/like", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { message: "Add a profile picture before liking" } },
    }),
  );
  await page.goto("/discover");
  await page.getByRole("button", { name: "Like Yasmine", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Add a profile picture before liking",
  );
  await expect(
    page.getByRole("article", { name: "Yasmine's profile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Like Yasmine", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Undo last choice" }),
  ).toBeDisabled();
});
