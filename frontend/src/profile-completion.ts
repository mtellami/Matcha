import type { Me } from "./types";

export function profileSteps(me: Me) {
  return [
    { id: "profile-birth-date", label: "Your age", detail: "Add your date of birth.", done: Boolean(me.birth_date), required: true },
    { id: "profile-gender", label: "Gender", detail: "Tell people how you identify.", done: Boolean(me.gender), required: true },
    { id: "profile-preferences", label: "Who you’d like to meet", detail: "Choose your preferences.", done: me.preferences.length > 0, required: true },
    { id: "profile-bio", label: "A little about you", detail: "Write a short introduction.", done: Boolean(me.bio.trim()), required: true },
    { id: "profile-tags", label: "Your interests", detail: "Add a few things you enjoy.", done: me.tags.length > 0, required: true },
    { id: "profile-city", label: "Approximate location", detail: "Choose a city or share your location with GPS.", done: Boolean(me.city) && me.latitude !== null && me.longitude !== null, required: true },
    { id: "profile-photos", label: "A profile photo", detail: "Add a photo to express interest and connect.", done: me.photos.some((photo) => photo.is_primary), required: false },
  ];
}

export function canDiscover(me: Me) {
  return profileSteps(me).every((step) => !step.required || step.done);
}
