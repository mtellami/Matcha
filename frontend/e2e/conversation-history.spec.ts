import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`conversation history stays readable after disconnect at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let connected = true;
    let sends = 0;
    const peer = {
      id: 2,
      username: "jamie",
      first_name: "Jamie",
      last_name: "Green",
      photo_id: null,
      preview: "Our saved conversation",
      last_message_at: "2026-11-19T12:00:00Z",
      common_tags: 1,
      connected_at: "2026-11-18T12:00:00Z",
      unread: 0,
      online: false,
      last_seen: null,
    };
    const message = (id: number, body: string) => ({
      id,
      body,
      actor: 2,
      target: 1,
      client_id: String(id),
      created_at: "2026-11-19T12:00:00Z",
      is_read: true,
      attachment: null,
    });
    await page.route("**/socket.io/**", (route) => route.abort());
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      let body: unknown = {};
      if (url.pathname === "/api/v1/me/session")
        body = {
          user: {
            ...peer,
            id: 1,
            username: "alex",
            first_name: "Alex",
            email: "alex@example.test",
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
          },
          csrf: "test",
        };
      if (url.pathname === "/api/v1/me/summary")
        body = { messages: 0, notifications: 0 };
      if (url.pathname === "/api/v1/conversations")
        body = { conversations: [{ ...peer, connected }] };
      if (url.pathname === "/api/v1/conversations/2/messages") {
        if (route.request().method() === "POST") sends++;
        body = {
          connected,
          messages: url.searchParams.has("before")
            ? [message(1, "An older memory")]
            : url.searchParams.has("after")
              ? []
              : [message(12, "Our saved conversation")],
          next_before: url.searchParams.has("before") ? null : 12,
          next_after: null,
        };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/messages?conversation=2");
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Our saved conversation", { exact: true }).last(),
    ).toBeVisible();
    connected = false;
    const explanation = page
      .getByRole("status")
      .filter({ hasText: "You’re no longer connected" });
    await expect(explanation).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Attach a file", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Load earlier messages", exact: true })
      .click();
    await expect(
      page.getByText("An older memory", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(explanation).toBeVisible();
    await expect(
      page.getByText("Our saved conversation", { exact: true }).last(),
    ).toBeVisible();
    expect(sends).toBe(0);
    connected = true;
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible({ timeout: 8000 });
    await expect(explanation).toHaveCount(0);
  });
}
