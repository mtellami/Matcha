import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "../api";
import { nearbyCity, type Location } from "../location";
import type { Me, Runner } from "../types";
import { ProfileCompletion } from "./ProfileCompletion";

export function ProfileEditor({
  fieldErrors,
  me,
  saved,
  run,
  notify,
  busy,
  focus,
  edit,
  discover,
  preview,
}: {
  fieldErrors: Record<string, string>;
  me: Me;
  saved: () => Promise<void>;
  run: Runner;
  notify: (message: string) => void;
  busy: boolean;
  focus: { field: string } | null;
  edit: (field: string) => void;
  discover: () => void;
  preview: () => void;
}) {
  const [coords, setCoords] = useState({
    latitude: me.latitude ?? 0,
    longitude: me.longitude ?? 0,
  });
  const [city, setCity] = useState(me.city || "");
  const [places, setPlaces] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState(
    me.city && me.latitude !== null ? "saved" : "manual",
  );
  const [locationNote, setLocationNote] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [tags, setTags] = useState(me.tags.join(", "));
  const selectedTags = new Set(tags.split(",").map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean));
  useEffect(() => {
    if (!focus) return;
    const target = document.getElementById(focus.field);
    target?.focus();
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  function toggleTag(tag: string) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else if (next.size < 20) next.add(tag);
    setTags([...next].join(", "));
  }
  useEffect(() => {
    const controller = new AbortController();
    api<{ locations: Location[] }>(
      "/locations",
      "GET",
      undefined,
      controller.signal,
    )
      .then((d) => setPlaces(d.locations))
      .catch(() =>
        setLocationNote(
          "City suggestions are unavailable. Try again or use GPS.",
        ),
      );
    api<{ tags: string[] }>("/tags", "GET", undefined, controller.signal)
      .then((d) => setKnownTags(d.tags))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  function gps() {
    if (!navigator.geolocation) {
      setLocationNote("Geolocation is unavailable. Choose a city instead.");
      return;
    }
    setLocationNote("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Math.round(position.coords.latitude * 100) / 100,
          longitude = Math.round(position.coords.longitude * 100) / 100;
        setCoords({ latitude, longitude });
        const nearest = nearbyCity(places, latitude, longitude);
        setCity(nearest?.city || "");
        setLocationId(null);
        setLocationSource("gps");
        setLocationNote(
          nearest
            ? "Approximate GPS location received. Check the suggested city."
            : "Location received. Enter the city or neighborhood for this location.",
        );
      },
      () =>
        setLocationNote(
          "Location permission denied or unavailable. Choose a city instead.",
        ),
      { timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <>
      <div className="eyebrow">YOUR LITTLE CORNER</div>
      <h1>
        Show up as <em>yourself.</em>
      </h1>
      <div className="profile-tools">
        <button type="button" disabled={busy} onClick={preview}>Preview my public profile</button>
        <small>Preview shows your saved changes.</small>
      </div>
      <ProfileCompletion me={me} edit={edit} discover={discover} />
      <form
        className="panel profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = Object.fromEntries(new FormData(event.currentTarget));
          void run(async () => {
            await api("/me/profile", "PUT", {
              ...fields,
              ...coords,
              city,
              location_id:
                locationSource === "manual"
                  ? places.find(
                      (place) =>
                        place.city.toLocaleLowerCase() ===
                        city.toLocaleLowerCase(),
                    )?.id
                  : locationId || undefined,
              location_source: locationSource,
              tags: String(fields.tags)
                .split(",")
                .map((t) => t.trim().replace(/^#/, ""))
                .filter(Boolean),
              preferences: String(fields.preferences).split(","),
            });
            await saved();
            notify("Profile saved");
          });
        }}
      >
        <div className="two">
          <label>
            First name
            <input
              name="first_name"
              aria-invalid={Boolean(fieldErrors.first_name)}
              aria-describedby={
                fieldErrors.first_name ? "form-errors" : undefined
              }
              defaultValue={me.first_name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Last name
            <input
              name="last_name"
              aria-invalid={Boolean(fieldErrors.last_name)}
              aria-describedby={
                fieldErrors.last_name ? "form-errors" : undefined
              }
              defaultValue={me.last_name}
              required
              maxLength={80}
            />
          </label>
        </div>
        <label>
          Date of birth
          <input
            name="birth_date"
            id="profile-birth-date"
            aria-invalid={Boolean(fieldErrors.birth_date)}
            aria-describedby={
              fieldErrors.birth_date ? "form-errors" : undefined
            }
            type="date"
            defaultValue={
              me.birth_date
                ? new Date(me.birth_date).toISOString().slice(0, 10)
                : ""
            }
            required
          />
        </label>
        <div className="two">
          <label>
            Gender
            <select
              name="gender"
              id="profile-gender"
              aria-invalid={Boolean(fieldErrors.gender)}
              aria-describedby={fieldErrors.gender ? "form-errors" : undefined}
              defaultValue={me.gender || ""}
              required
            >
              <option value="" disabled>
                Select your gender
              </option>
              <option value="woman">Woman</option>
              <option value="man">Man</option>
              <option value="nonbinary">Nonbinary</option>
            </select>
          </label>
          <label>
            Interested in
            <select
              name="preferences"
              id="profile-preferences"
              aria-invalid={Boolean(fieldErrors.preferences)}
              aria-describedby={
                fieldErrors.preferences ? "form-errors" : undefined
              }
              defaultValue={me.preferences.join(",")}
            >
              <option value="man,woman">Men and women</option>
              <option value="man">Men</option>
              <option value="woman">Women</option>
              <option value="nonbinary">Nonbinary people</option>
              <option value="man,nonbinary">Men and nonbinary people</option>
              <option value="woman,nonbinary">
                Women and nonbinary people
              </option>
              <option value="man,woman,nonbinary">Everyone</option>
            </select>
          </label>
        </div>
        <label>
          About you
          <textarea
            name="bio"
            id="profile-bio"
            aria-invalid={Boolean(fieldErrors.bio)}
            aria-describedby={fieldErrors.bio ? "form-errors" : undefined}
            defaultValue={me.bio}
            maxLength={2000}
            required
            placeholder="The things that make you, you."
          />
        </label>
        <label>
          Interests, separated by commas
          <input
            name="tags"
            id="profile-tags"
            aria-invalid={Boolean(fieldErrors.tags)}
            aria-describedby={fieldErrors.tags ? "form-errors" : undefined}
            list="interest-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="coffee, music, hiking"
            required
          />
        </label>
        <datalist id="interest-tags">
          {knownTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <div className="interest-picker" role="group" aria-label="Choose reusable interests">
          <p>Pick shared interests, or type your own above. {selectedTags.size}/20 selected.</p>
          <div className="interest-options">
            {[...new Set([...selectedTags, ...knownTags])].map((tag) => (
              <button type="button" key={tag} aria-pressed={selectedTags.has(tag)}
                disabled={!selectedTags.has(tag) && selectedTags.size >= 20}
                onClick={() => toggleTag(tag)}>#{tag}{selectedTags.has(tag) ? " ✓" : " +"}</button>
            ))}
          </div>
        </div>
        <fieldset>
          <legend>Your approximate location</legend>
          <p>Choose a city, or use GPS to set your approximate location.</p>
          <label>
            City or neighborhood
            <input
              name="city"
              id="profile-city"
              value={city}
              list="cities"
              required
              maxLength={100}
              aria-invalid={Boolean(fieldErrors.city)}
              aria-describedby={fieldErrors.city ? "form-errors" : undefined}
              onChange={(event) => {
                const name = event.target.value;
                setCity(name);
                const selected = places.find(
                  (place) =>
                    place.city.toLocaleLowerCase() === name.toLocaleLowerCase(),
                );
                if (locationSource === "gps") {
                  setLocationId(null);
                  return;
                }
                setLocationSource("manual");
                setLocationId(selected?.id || null);
                if (selected) {
                  setCoords({
                    latitude: selected.latitude,
                    longitude: selected.longitude,
                  });
                  setLocationNote("Approximate city location selected.");
                } else
                  setLocationNote(
                    "Choose a city from the suggestions, or use GPS and enter its city or neighborhood.",
                  );
              }}
            />
          </label>
          <datalist id="cities">
            {places.map((place) => (
              <option key={place.id} value={place.city}>
                {place.country}
              </option>
            ))}
          </datalist>
          {locationSource === "gps" && (
            <button
              type="button"
              onClick={() => {
                setLocationSource("manual");
                setLocationId(null);
                setCity("");
                setLocationNote("Choose a city from the suggestions.");
              }}
            >
              Choose a city manually instead
            </button>
          )}
          <button type="button" onClick={gps}>
            Use GPS with my permission
          </button>
          <small role="status">
            {locationNote ||
              "Only approximate coordinates are stored. GPS is optional."}
          </small>
        </fieldset>
        <button className="primary" disabled={busy}>
          Save profile <ArrowUpRight size={18} />
        </button>
      </form>
      <section className="panel profile-form" id="profile-photos" tabIndex={-1} aria-labelledby="photos-heading">
        <h2 id="photos-heading">Your photos</h2>
        <p>Up to five photos. Choose the picture people see first.</p>
        <div className="photo-row">
          {me.photos.map((photo) => (
            <div className="photo-item" key={photo.id}>
              <img
                src={"/api/v1/photos/" + photo.id}
                alt="Your uploaded photo"
              />
              {photo.is_primary ? (
                <span>Profile picture</span>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/me/photos/" + photo.id, "PUT");
                      await saved();
                    })
                  }
                >
                  Make primary
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("/me/photos/" + photo.id, "DELETE");
                    await saved();
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <label>
          Add a photo
          <input
            name="photo"
            aria-invalid={Boolean(fieldErrors.photo)}
            aria-describedby={fieldErrors.photo ? "form-errors" : undefined}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || me.photos.length >= 5}
            onChange={(event) => {
              const input = event.target,
                file = input.files?.[0];
              if (file)
                void run(async () => {
                  const form = new FormData();
                  form.append("photo", file);
                  try {
                    await api("/me/photos", "POST", form);
                    await saved();
                  } finally {
                    input.value = "";
                  }
                });
            }}
          />
        </label>
      </section>
      <form
        className="panel profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          const email = new FormData(event.currentTarget).get("email");
          void run(async () => {
            const response = await api("/me/email", "POST", { email });
            notify(response.message);
          });
        }}
      >
        <h2>Email address</h2>
        <p>
          Current email: {me.email}. Your new address becomes active after
          verification.
        </p>
        <label>
          New email
          <input
            name="email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "form-errors" : undefined}
            type="email"
            required
            maxLength={254}
          />
        </label>
        <button disabled={busy}>Send verification link</button>
      </form>
    </>
  );
}
