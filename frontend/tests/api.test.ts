import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, setCsrf } from "../src/shared/api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setCsrf("");
});

test("JSON writes include CSRF and preserve message contents", async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/v1/conversations/42/messages");
    captured = options;
    return Response.json({ message: "sent" });
  };
  setCsrf("session-csrf");
  await api("/conversations/42/messages", "POST", {
    body: "<script>literal text</script>",
  });
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.credentials, "same-origin");
  const headers = new Headers(captured?.headers);
  assert.equal(headers.get("X-CSRF-Token"), "session-csrf");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(captured?.body)), {
    body: "<script>literal text</script>",
  });
});

test("multipart upload lets the browser set the boundary", async () => {
  const form = new FormData();
  form.append("photo", new Blob(["image"]), "photo.jpg");
  globalThis.fetch = async (_, options) => {
    assert.equal(options?.body, form);
    assert.equal(new Headers(options?.headers).get("Content-Type"), null);
    return Response.json({ id: 1 });
  };
  await api("/me/photos", "POST", form);
});

test("expired sessions retain status for the global sign-in flow", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: { message: "Please sign in" } }, { status: 401 });
  await assert.rejects(
    api("/me"),
    (error) =>
      error instanceof ApiError &&
      error.status === 401 &&
      error.message === "Please sign in",
  );
});

test("proxy errors without JSON become handled API errors", async () => {
  globalThis.fetch = async () =>
    new Response("<h1>Bad gateway</h1>", { status: 502 });
  await assert.rejects(
    api("/me"),
    (error) => error instanceof ApiError && error.status === 502,
  );
});

test("aborted searches pass their signal to fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_, options) => {
    assert.equal(options?.signal, controller.signal);
    throw new DOMException("Aborted", "AbortError");
  };
  await assert.rejects(api("/profiles", "GET", undefined, controller.signal), {
    name: "AbortError",
  });
});

test("field errors survive API parsing for accessible form feedback", async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "Please correct the highlighted fields.",
          fields: {
            birth_date: "You must be at least 18.",
            bio: "Add a biography.",
            invalid: { nested: "not a message" },
          },
        },
      },
      { status: 400 },
    );
  await assert.rejects(
    api("/me/profile", "PUT", {}),
    (error) =>
      error instanceof ApiError &&
      error.fields.birth_date === "You must be at least 18." &&
      error.fields.bio === "Add a biography." &&
      !("invalid" in error.fields),
  );
});

test("a stalled chat request times out instead of preventing future refreshes", async () => {
  globalThis.fetch = async (_, options) => new Promise<Response>((_, reject) => {
    const deadline = setTimeout(() => reject(new Error("Request was never aborted")), 1000);
    options!.signal!.addEventListener("abort", () => {
      clearTimeout(deadline);
      reject(options!.signal!.reason);
    }, { once: true });
  });
  await assert.rejects(api("/conversations/42/messages", "GET", undefined, undefined, 5),
    (error) => error instanceof ApiError && error.status === 408 && error.message.includes("timed out"));
  globalThis.fetch = async () => Response.json({ messages: [] });
  assert.deepEqual(await api("/conversations/42/messages", "GET", undefined, undefined, 100), { messages: [] });
});

test("caller cancellation is preserved when a request also has a timeout", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_, options) => {
    assert.ok(options?.signal?.aborted);
    throw options!.signal!.reason;
  };
  await assert.rejects(api("/conversations/42/messages", "GET", undefined, controller.signal, 1000), { name: "AbortError" });
});
