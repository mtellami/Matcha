import { test } from "node:test";
import assert from "node:assert/strict";
import { canDiscover, profileSteps } from "../src/profile-completion.ts";
import type { Me } from "../src/types.ts";

const member: Me = {
  id: 1, username: "member", email: "member@example.test", first_name: "Alex", last_name: "Test",
  birth_date: "1995-01-01", gender: "woman", preferences: ["man", "woman"], bio: "Coffee and hiking.",
  city: "Rabat", latitude: 34.02, longitude: -6.84, tags: ["coffee"], photos: [],
};
test("a profile without a photo can discover but still needs a photo to connect", () => {
  assert.equal(canDiscover(member), true);
  assert.equal(profileSteps(member).find((step) => step.id === "profile-photos")?.done, false);
});
test("a newly registered member is directed to missing details", () => {
  const fresh = { ...member, birth_date: null, gender: null, bio: "", tags: [], city: null, latitude: null, longitude: null };
  assert.equal(canDiscover(fresh), false);
  assert.deepEqual(profileSteps(fresh).filter((step) => step.done).map((step) => step.id), ["profile-preferences"]);
});
test("coordinates at zero are valid and a city label alone is insufficient", () => {
  assert.equal(canDiscover({ ...member, latitude: 0, longitude: 0 }), true);
  assert.equal(canDiscover({ ...member, longitude: null }), false);
});
test("only a primary photo completes the picture step", () => {
  assert.equal(profileSteps({ ...member, photos: [{ id: 1, is_primary: false }] }).at(-1)?.done, false);
  assert.equal(profileSteps({ ...member, photos: [{ id: 1, is_primary: true }] }).every((step) => step.done), true);
});
