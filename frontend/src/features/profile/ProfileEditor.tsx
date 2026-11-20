import { UiInput, UiTextarea } from "../../shared/UiInput";
import { UiButton } from "../../shared/UiButton";
import { UiSelect } from "../../shared/UiSelect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, LockKeyhole, MapPin } from "lucide-react";
import { api } from "../../shared/api";
import { type Location } from "../location/location";
import type { Me, Runner } from "../../shared/types";
import { ProfileCompletion } from "./ProfileCompletion";
import { PhotoGalleryEditor } from "./PhotoGalleryEditor";
import {
  AlertDialog,
  Calendar,
  ComboBox,
  DateField,
  DatePicker,
  Label,
  ListBox,
  ListBoxItem,
  Switch,
} from "@heroui/react";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useBeforeUnload, useBlocker } from "react-router";

type ProfileDraft = {
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string;
  preferences: string;
  bio: string;
  tags: string;
  city: string;
  map_visible: boolean;
};

function createProfileDraft(me: Me): ProfileDraft {
  return {
    first_name: me.first_name,
    last_name: me.last_name,
    birth_date: me.birth_date?.slice(0, 10) ?? "",
    gender: me.gender || "",
    preferences: me.preferences.join(","),
    bio: me.bio,
    tags: me.tags.join(", "),
    city: me.city || "",
    map_visible: me.map_visible,
  };
}

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
  const [draft, setDraft] = useState(() => createProfileDraft(me));
  const [savedDraft, setSavedDraft] = useState(() => createProfileDraft(me));
  const [coords, setCoords] = useState({
    latitude: me.latitude ?? 0,
    longitude: me.longitude ?? 0,
  });
  const [savedCoords, setSavedCoords] = useState({
    latitude: me.latitude ?? 0,
    longitude: me.longitude ?? 0,
  });
  const [places, setPlaces] = useState<Location[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const selectedPlace = useRef<Location | null>(null);
  const gpsRequest = useRef<AbortController | null>(null);
  const [placesFailed, setPlacesFailed] = useState(false);
  const [placesRetry, setPlacesRetry] = useState(0);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState<
    "saved" | "manual" | "gps"
  >(me.city && me.latitude !== null ? "saved" : "manual");
  const [savedLocationSource, setSavedLocationSource] = useState<
    "saved" | "manual" | "gps"
  >(me.city && me.latitude !== null ? "saved" : "manual");
  const [savedLocationId, setSavedLocationId] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [interestError, setInterestError] = useState("");
  const selectedTags = new Set(
    draft.tags
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean),
  );
  const updateDraft = <K extends keyof ProfileDraft>(
    key: K,
    value: ProfileDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const hasChanges =
    JSON.stringify(draft) !== JSON.stringify(savedDraft) ||
    coords.latitude !== savedCoords.latitude ||
    coords.longitude !== savedCoords.longitude ||
    locationSource !== savedLocationSource ||
    locationId !== savedLocationId;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasChanges &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash) &&
      nextLocation.pathname !== "/login",
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!hasChanges) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [hasChanges],
    ),
  );
  useEffect(() => {
    if (!focus) return;
    const target = document.getElementById(focus.field);
    target?.focus();
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  function toggleTag(tag: string) {
    const next = new Set(selectedTags);
    const normalizedTag = tag.toLowerCase();
    if (next.has(normalizedTag)) next.delete(normalizedTag);
    else if (next.size < 20) next.add(normalizedTag);
    updateDraft("tags", [...next].join(", "));
  }
  function addInterest() {
    const tag = interestInput.trim().replace(/^#/, "");
    if (!tag) return;
    if (!/^[\w-]{1,30}$/u.test(tag)) {
      setInterestError(
        "Use up to 30 letters, numbers, underscores, or hyphens.",
      );
      return;
    }
    if (selectedTags.has(tag.toLowerCase())) {
      setInterestInput("");
      setInterestError("");
      return;
    }
    if (selectedTags.size >= 20) {
      setInterestError("You can add up to 20 interests.");
      return;
    }
    updateDraft("tags", [...selectedTags, tag.toLowerCase()].join(", "));
    setInterestInput("");
    setInterestError("");
  }
  useEffect(() => {
    const controller = new AbortController();
    api<{ tags: string[] }>("/tags", "GET", undefined, controller.signal)
      .then((d) => setKnownTags(d.tags))
      .catch(() => {});
    return () => {
      controller.abort();
      gpsRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const query = placeQuery.trim();
    if (query.length < 3) {
      setPlacesLoading(false);
      return;
    }
    const controller = new AbortController();
    setPlacesLoading(true);
    setPlacesFailed(false);
    const timer = window.setTimeout(() => {
      api<{ locations: Location[] }>(
        `/locations?q=${encodeURIComponent(query)}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) setPlaces(result.locations);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPlacesFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPlacesLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [placeQuery, placesRetry]);

  function gps() {
    if (!navigator.geolocation) {
      setLocationNote("Geolocation is unavailable. Choose a city instead.");
      return;
    }
    gpsRequest.current?.abort();
    const controller = new AbortController();
    gpsRequest.current = controller;
    setLocationNote("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (controller.signal.aborted) return;
        const { latitude, longitude } = position.coords;
        setCoords({ latitude, longitude });
        selectedPlace.current = null;
        setLocationId(null);
        setLocationSource("gps");
        setPlaceQuery("");
        setPlaces([]);
        setPlacesFailed(false);
        updateDraft("city", "");
        setLocationNote("Finding the city for your current location…");
        try {
          const result = await api<{ locations: Location[] }>(
            `/locations?latitude=${latitude}&longitude=${longitude}`,
            "GET",
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          updateDraft("city", result.locations[0]?.city || "");
          setLocationNote(
            result.locations.length
              ? "Current location received. Check the suggested city or neighborhood."
              : "Location received. Enter the city or neighborhood for this location.",
          );
        } catch {
          if (!controller.signal.aborted)
            setLocationNote(
              "Location received. Enter the city or neighborhood for this location.",
            );
        }
      },
      () => {
        if (!controller.signal.aborted)
          setLocationNote(
            "Location permission denied or unavailable. Choose a city instead.",
          );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  function chooseCity(place: Location) {
    gpsRequest.current?.abort();
    selectedPlace.current = place;
    updateDraft("city", place.city);
    setLocationSource("manual");
    setLocationId(place.id);
    setCoords({ latitude: place.latitude, longitude: place.longitude });
    setPlaceQuery("");
    setPlaces([place]);
    setPlacesFailed(false);
    setLocationNote(
      "City selected. Save your profile to update your location.",
    );
  }

  function updateCity(name: string) {
    if (selectedPlace.current?.city === name) return;
    gpsRequest.current?.abort();
    selectedPlace.current = null;
    updateDraft("city", name);
    setLocationId(null);
    setPlaceQuery(name);
    setPlaces([]);
    setPlacesFailed(false);
    if (locationSource !== "gps") setLocationSource("manual");
    setLocationNote(
      locationSource === "gps"
        ? "Your GPS coordinates will be kept unless you select a different city."
        : name.trim().length < 3
          ? "Type at least three characters to search for a city."
          : "",
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-8">
      <header className="flex flex-col justify-between gap-6 border-b border-matcha-border pb-7 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <p className="mb-2 text-[11px] font-bold tracking-[2.5px] text-matcha-accent">
            YOUR LITTLE CORNER
          </p>
          <h1 className="m-0 text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[1.08] tracking-[-2px]">
            Show up as <em>yourself.</em>
          </h1>
          <p className="mb-0 mt-3 max-w-xl text-base leading-relaxed text-matcha-muted">
            Make your profile feel like you. These details help the right people
            find a reason to say hello.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-3">
            <UiButton
              type="submit"
              form="profile-form"
              variant="primary"
              disabled={!hasChanges || busy}
              className="min-h-11 rounded-full !border-matcha-accent !bg-matcha-accent px-5 font-bold !text-matcha-bg hover:!bg-matcha-accent/90"
            >
              Save profile
            </UiButton>
            <UiButton
              type="button"
              disabled={busy}
              onClick={preview}
              className="min-h-11 rounded-full px-5"
            >
              Preview profile
            </UiButton>
          </div>
          <small className="text-xs text-matcha-muted">
            Preview shows your saved changes.
          </small>
        </div>
      </header>
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
        <aside className="order-2 min-w-0 lg:sticky lg:top-32">
          <ProfileCompletion me={me} edit={edit} discover={discover} />
        </aside>
        <div className="order-1 min-w-0 space-y-6">
          <PhotoGalleryEditor
            me={me}
            fieldErrors={fieldErrors}
            run={run}
            saved={saved}
            busy={busy}
          />
          <form
            id="profile-form"
            className="flex min-w-0 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              const payload: Record<string, unknown> = {};
              (Object.keys(draft) as (keyof ProfileDraft)[]).forEach((key) => {
                if (draft[key] !== savedDraft[key]) payload[key] = draft[key];
              });
              if ("tags" in payload) {
                payload.tags = draft.tags
                  .split(",")
                  .map((tag) => tag.trim().replace(/^#/, ""))
                  .filter(Boolean);
              }
              if ("preferences" in payload) {
                payload.preferences = draft.preferences
                  .split(",")
                  .filter(Boolean);
              }
              const locationChanged =
                draft.city !== savedDraft.city ||
                coords.latitude !== savedCoords.latitude ||
                coords.longitude !== savedCoords.longitude ||
                locationSource !== savedLocationSource ||
                locationId !== savedLocationId;
              if (locationChanged) {
                payload.city = draft.city;
                payload.latitude = coords.latitude;
                payload.longitude = coords.longitude;
                payload.location_source = locationSource;
                if (locationSource === "manual" && !locationId) {
                  setLocationNote(
                    "Choose a city from the suggestions, or use GPS.",
                  );
                  document.getElementById("profile-city")?.focus();
                  return;
                }
                if (locationId) payload.location_id = locationId;
              }
              void run(async () => {
                await api("/me/profile", "PATCH", payload);
                setSavedDraft({ ...draft });
                setSavedCoords({ ...coords });
                setSavedLocationSource(locationSource);
                setSavedLocationId(locationId);
                await saved();
                notify("Profile saved");
              });
            }}
          >
            <section className="flex min-w-0 flex-col gap-6 rounded-3xl border border-matcha-border bg-matcha-surface p-5 shadow-[0_16px_48px_var(--shadow)] sm:p-8">
              <div className="border-b border-matcha-border pb-5">
                <p className="mb-1 text-[10px] font-bold tracking-[2px] text-matcha-accent">
                  PROFILE DETAILS
                </p>
                <h2 className="m-0 text-2xl font-semibold tracking-tight">
                  A little about you
                </h2>
                <p className="mb-0 mt-2 break-words text-sm leading-relaxed text-matcha-muted">
                  You choose what to share. Your email and precise coordinates
                  stay private.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                  <span>First name</span>
                  <UiInput
                    name="first_name"
                    id="profile-first-name"
                    aria-invalid={Boolean(fieldErrors.first_name)}
                    aria-describedby={
                      fieldErrors.first_name ? "form-errors" : undefined
                    }
                    value={draft.first_name}
                    onChange={(event) =>
                      updateDraft("first_name", event.target.value)
                    }
                    maxLength={80}
                  />
                </label>
                <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                  <span>Last name</span>
                  <UiInput
                    name="last_name"
                    id="profile-last-name"
                    aria-invalid={Boolean(fieldErrors.last_name)}
                    aria-describedby={
                      fieldErrors.last_name ? "form-errors" : undefined
                    }
                    value={draft.last_name}
                    onChange={(event) =>
                      updateDraft("last_name", event.target.value)
                    }
                    maxLength={80}
                  />
                </label>
              </div>
              <DatePicker
                name="birth_date"
                value={draft.birth_date ? parseDate(draft.birth_date) : null}
                onChange={(date) =>
                  updateDraft("birth_date", date?.toString() ?? "")
                }
                maxValue={today(getLocalTimeZone())}
                isInvalid={Boolean(fieldErrors.birth_date)}
                aria-describedby={
                  fieldErrors.birth_date ? "form-errors" : undefined
                }
                className="grid gap-2"
              >
                <Label className="text-[13px] font-semibold text-matcha-text">
                  Date of birth
                </Label>
                <DateField.Group className="flex min-h-12 items-center rounded-xl border border-matcha-border bg-matcha-bg px-3.5 text-[15px] font-normal text-matcha-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-matcha-accent">
                  <DateField.Input className="flex min-w-0 flex-1 items-center gap-0.5">
                    {(segment) => (
                      <DateField.Segment
                        segment={segment}
                        className="rounded px-0.5 outline-none focus:bg-matcha-raised"
                      />
                    )}
                  </DateField.Input>
                  <DateField.Suffix>
                    <DatePicker.Trigger className="grid size-9 shrink-0 place-items-center rounded-lg text-matcha-muted transition-colors hover:bg-matcha-raised hover:text-matcha-accent focus-visible:outline-2 focus-visible:outline-matcha-accent">
                      <DatePicker.TriggerIndicator />
                    </DatePicker.Trigger>
                  </DateField.Suffix>
                </DateField.Group>
                <DatePicker.Popover className="z-50 rounded-2xl border border-matcha-border bg-matcha-surface p-3 text-matcha-text shadow-xl">
                  <Calendar
                    aria-label="Choose your date of birth"
                    className="w-[280px]"
                  >
                    <Calendar.Header className="mb-3 flex items-center justify-between gap-2">
                      <Calendar.YearPickerTrigger className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-matcha-raised">
                        <Calendar.YearPickerTriggerHeading />
                        <Calendar.YearPickerTriggerIndicator />
                      </Calendar.YearPickerTrigger>
                      <div className="flex items-center gap-1">
                        <Calendar.NavButton
                          slot="previous"
                          className="grid size-8 place-items-center rounded-lg hover:bg-matcha-raised"
                        />
                        <Calendar.NavButton
                          slot="next"
                          className="grid size-8 place-items-center rounded-lg hover:bg-matcha-raised"
                        />
                      </div>
                    </Calendar.Header>
                    <Calendar.Grid className="w-full border-collapse">
                      <Calendar.GridHeader>
                        {(day) => (
                          <Calendar.HeaderCell className="size-9 text-center text-xs font-medium text-matcha-muted">
                            {day}
                          </Calendar.HeaderCell>
                        )}
                      </Calendar.GridHeader>
                      <Calendar.GridBody>
                        {(date) => (
                          <Calendar.Cell
                            date={date}
                            className="size-9 cursor-pointer rounded-full text-center text-sm outline-none hover:bg-matcha-raised focus-visible:ring-2 focus-visible:ring-matcha-accent selected:bg-matcha-accent selected:font-semibold selected:text-matcha-bg disabled:cursor-not-allowed disabled:opacity-35"
                          />
                        )}
                      </Calendar.GridBody>
                    </Calendar.Grid>
                    <Calendar.YearPickerGrid className="grid grid-cols-3 gap-1 overflow-y-auto p-1">
                      <Calendar.YearPickerGridBody>
                        {({ year }) => (
                          <Calendar.YearPickerCell
                            year={year}
                            className="min-h-9 rounded-lg text-sm text-matcha-text transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-matcha-accent data-[selected=true]:bg-matcha-accent data-[selected=true]:font-semibold data-[selected=true]:text-matcha-bg"
                          >
                            {year}
                          </Calendar.YearPickerCell>
                        )}
                      </Calendar.YearPickerGridBody>
                    </Calendar.YearPickerGrid>
                  </Calendar>
                </DatePicker.Popover>
              </DatePicker>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                  <span>Gender</span>
                  <UiSelect
                    name="gender"
                    value={draft.gender}
                    onChange={(event) =>
                      updateDraft("gender", event.target.value)
                    }
                    options={[
                      { value: "woman", label: "Woman" },
                      { value: "man", label: "Man" },
                      { value: "nonbinary", label: "Nonbinary" },
                    ]}
                  />
                </label>
                <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                  <span>Interested in</span>
                  <UiSelect
                    name="preferences"
                    value={draft.preferences}
                    onChange={(event) =>
                      updateDraft("preferences", event.target.value)
                    }
                    options={[
                      { value: "man,woman", label: "Men and women" },
                      { value: "man", label: "Men" },
                      { value: "woman", label: "Women" },
                      { value: "nonbinary", label: "Nonbinary people" },
                      {
                        value: "man,nonbinary",
                        label: "Men and nonbinary people",
                      },
                      {
                        value: "woman,nonbinary",
                        label: "Women and nonbinary people",
                      },
                      { value: "man,woman,nonbinary", label: "Everyone" },
                    ]}
                  />
                </label>
              </div>
              <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                <span>About you</span>
                <UiTextarea
                  name="bio"
                  id="profile-bio"
                  aria-invalid={Boolean(fieldErrors.bio)}
                  aria-describedby={fieldErrors.bio ? "form-errors" : undefined}
                  value={draft.bio}
                  onChange={(event) => updateDraft("bio", event.target.value)}
                  maxLength={2000}
                  placeholder="The things that make you, you."
                />
              </label>
              <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                <span>Interests</span>
                <UiInput
                  id="profile-tags"
                  aria-invalid={Boolean(fieldErrors.tags || interestError)}
                  aria-describedby={
                    interestError
                      ? "interest-error"
                      : fieldErrors.tags
                        ? "form-errors"
                        : undefined
                  }
                  list="interest-tags"
                  value={interestInput}
                  maxLength={30}
                  onChange={(event) => {
                    setInterestInput(event.target.value);
                    setInterestError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addInterest();
                    }
                  }}
                  placeholder="Type an interest and press Enter"
                />
                {interestError && (
                  <span
                    id="interest-error"
                    className="text-xs font-normal text-red-500"
                  >
                    {interestError}
                  </span>
                )}
              </label>
              <datalist id="interest-tags">
                {knownTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <div
                className="grid gap-3 rounded-2xl bg-matcha-bg/60 p-4 [&_p]:[font-size:12px] [&_p]:[margin:0] [&_p]:[color:var(--muted)]"
                role="group"
                aria-label="Choose reusable interests"
              >
                <p>
                  Pick shared interests, or type your own above.{" "}
                  {selectedTags.size}
                  /20 selected.
                </p>
                <div className="flex max-h-[210px] flex-wrap gap-2 overflow-auto p-1">
                  {[...new Set([...selectedTags, ...knownTags])].map((tag) => (
                    <UiButton
                      type="button"
                      key={tag}
                      aria-pressed={selectedTags.has(tag.toLowerCase())}
                      disabled={
                        !selectedTags.has(tag.toLowerCase()) &&
                        selectedTags.size >= 20
                      }
                      onClick={() => toggleTag(tag)}
                    >
                      #{tag}
                      {selectedTags.has(tag.toLowerCase()) ? " ✓" : " +"}
                    </UiButton>
                  ))}
                </div>
              </div>
            </section>
            <fieldset className="grid min-w-0 w-full gap-5 rounded-3xl border border-matcha-border bg-matcha-surface p-5 shadow-[0_16px_48px_var(--shadow)] sm:p-8">
              <legend className="sr-only">Your approximate location</legend>
              <div className="flex items-start gap-4 border-b border-matcha-border pb-5">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-matcha-accent/10 text-matcha-accent">
                  <MapPin size={21} />
                </span>
                <div>
                  <p className="mb-1 text-[10px] font-bold tracking-[2px] text-matcha-accent">
                    LOCATION
                  </p>
                  <h2 className="m-0 text-2xl font-semibold tracking-tight">
                    Where are you based?
                  </h2>
                  <p className="mb-0 mt-2 max-w-2xl text-sm leading-relaxed text-matcha-muted">
                    Choose a city or neighborhood. People only ever see your
                    approximate area.
                  </p>
                </div>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-1 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
                <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
                  <span>City or neighborhood</span>
                  <span className="relative block w-full">
                    <MapPin
                      size={17}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-matcha-muted"
                    />
                    <ComboBox
                      aria-label="City or neighborhood"
                      allowsEmptyCollection
                      items={places}
                      inputValue={draft.city}
                      selectedKey={locationId}
                      onInputChange={updateCity}
                      onSelectionChange={(key) => {
                        const place = places.find(
                          (item) => item.id === String(key),
                        );
                        if (place) chooseCity(place);
                      }}
                      allowsCustomValue
                      menuTrigger="focus"
                      fullWidth
                      className="min-w-0 w-full"
                    >
                      <UiInput
                        name="city"
                        id="profile-city"
                        className="w-full pl-10"
                        maxLength={100}
                        aria-invalid={Boolean(fieldErrors.city)}
                        aria-describedby={
                          fieldErrors.city ? "form-errors" : undefined
                        }
                        placeholder="Search city or neighborhood"
                      />
                      <ComboBox.Popover
                        placement="bottom start"
                        className="z-[100] w-[var(--trigger-width)] min-w-[var(--trigger-width)] overflow-hidden rounded-xl border border-matcha-border bg-matcha-surface text-matcha-text shadow-xl"
                      >
                        <ListBox
                          className="max-h-64 overflow-y-auto p-1"
                          renderEmptyState={() => (
                            <p className="m-0 px-3 py-2.5 text-sm text-matcha-muted">
                              {placesLoading
                                ? "Searching…"
                                : placeQuery.trim().length < 3
                                  ? "Type at least three characters."
                                  : "No suggestions."}
                            </p>
                          )}
                        >
                          {places.map((place) => (
                            <ListBoxItem
                              key={place.id}
                              id={place.id}
                              textValue={place.city}
                              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm outline-none hover:bg-matcha-raised focus:bg-matcha-raised selected:bg-matcha-accent/10"
                            >
                              <span className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <span>{place.city}</span>
                                <span className="text-xs text-matcha-muted">
                                  {place.region || place.country}
                                </span>
                              </span>
                            </ListBoxItem>
                          ))}
                        </ListBox>
                      </ComboBox.Popover>
                    </ComboBox>
                  </span>
                  <a
                    href="https://www.mapbox.com/about/maps/"
                    target="_blank"
                    rel="noreferrer"
                    className="w-fit text-[10px] font-normal text-matcha-muted"
                  >
                    Search by Mapbox
                  </a>
                </label>
                <UiButton
                  type="button"
                  onClick={gps}
                  aria-label="Use current location"
                  title="Use current location"
                  className="mt-7 h-12 w-12 min-w-12 cursor-pointer rounded-xl max-sm:!px-0 sm:mt-0 sm:w-auto sm:px-5 xl:mt-7"
                >
                  <Crosshair
                    size={20}
                    aria-hidden="true"
                    className="shrink-0 sm:size-4"
                  />
                  <span className="hidden sm:inline">Use current location</span>
                </UiButton>
              </div>
              <div
                className="relative isolate h-52 min-w-0 w-full overflow-hidden rounded-2xl border border-matcha-border bg-matcha-raised sm:h-64"
                role="img"
                aria-label="Illustrative map showing an approximate two kilometer area"
                style={{
                  backgroundImage:
                    "linear-gradient(12deg, transparent 44%, var(--surface) 45%, var(--surface) 48%, transparent 49%), linear-gradient(-5deg, transparent 29%, var(--surface) 30%, var(--surface) 34%, transparent 35%), linear-gradient(82deg, transparent 20%, var(--surface) 21%, var(--surface) 24%, transparent 25%), linear-gradient(96deg, transparent 43%, var(--surface) 44%, var(--surface) 47%, transparent 48%), linear-gradient(4deg, transparent 72%, var(--surface) 73%, var(--surface) 76%, transparent 77%)",
                }}
              >
                <div className="absolute left-1/2 top-1/2 grid aspect-square w-28 sm:w-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-dashed border-matcha-accent bg-matcha-accent/15">
                  <MapPin
                    size={30}
                    fill="currentColor"
                    className="fill-matcha-accent stroke-matcha-surface"
                  />
                </div>
                <span className="absolute bottom-3 left-3 right-3 w-fit max-w-[calc(100%-1.5rem)] rounded-full border border-matcha-border bg-matcha-surface px-4 py-2 text-xs font-semibold text-matcha-text shadow-sm">
                  Approximate area · about 2 km
                </span>
              </div>
              {locationSource === "gps" && (
                <UiButton
                  type="button"
                  onClick={() => {
                    gpsRequest.current?.abort();
                    selectedPlace.current = null;
                    setLocationSource("manual");
                    setLocationId(null);
                    setPlaceQuery("");
                    setPlaces([]);
                    updateDraft("city", "");
                    setLocationNote("Choose a city from the suggestions.");
                  }}
                >
                  Choose a city manually instead
                </UiButton>
              )}
              {(locationNote ||
                placesFailed ||
                placesLoading ||
                (placeQuery.trim().length >= 3 && places.length === 0)) && (
                <p
                  className="m-0 text-xs leading-relaxed text-matcha-muted"
                  role="status"
                  aria-live="polite"
                >
                  {placesLoading
                    ? "Searching cities…"
                    : placesFailed
                      ? "City suggestions are unavailable. You can retry or use GPS."
                      : locationNote ||
                        "No matching cities found. Try another name or use GPS."}
                </p>
              )}
              {placesFailed && !placesLoading && (
                <UiButton
                  type="button"
                  onClick={() => {
                    setPlacesLoading(true);
                    setPlacesRetry((value) => value + 1);
                  }}
                >
                  Retry city suggestions
                </UiButton>
              )}
              <Switch
                name="map_visible"
                isSelected={draft.map_visible}
                onChange={(selected) => updateDraft("map_visible", selected)}
                size="md"
                className="group w-full"
              >
                <Switch.Content className="flex w-full flex-row-reverse justify-between gap-5 rounded-2xl border border-matcha-border bg-matcha-bg/50 p-4 text-left transition-colors group-data-[selected=true]:border-matcha-accent/50 group-data-[selected=true]:bg-matcha-accent/5">
                  <Switch.Control className="!h-6 !w-12 !shrink-0 !rounded-full !bg-matcha-border group-data-[selected=true]:!bg-matcha-accent">
                    <Switch.Thumb className="!size-5 !rounded-full !bg-white !shadow-md" />
                  </Switch.Control>
                  <span className="flex-1">
                    <span className="block font-semibold text-matcha-text">
                      Show me on the map
                    </span>
                    <span className="mt-1 block text-xs font-normal leading-relaxed text-matcha-muted">
                      Only people who match your preferences can see your pin.
                      Turn it off any time.
                    </span>
                  </span>
                </Switch.Content>
              </Switch>
              <p className="m-0 flex items-center gap-2 text-sm text-matcha-muted">
                <LockKeyhole size={15} className="shrink-0" /> Your exact
                coordinates are never shown to anyone.
              </p>
            </fieldset>
          </form>
          <form
            className="flex min-w-0 flex-col gap-5 rounded-3xl border border-matcha-border bg-matcha-surface p-5 shadow-[0_16px_48px_var(--shadow)] sm:p-8"
            onSubmit={(event) => {
              event.preventDefault();
              const email = new FormData(event.currentTarget).get("email");
              void run(async () => {
                const response = await api("/me/email", "POST", { email });
                notify(response.message);
              });
            }}
          >
            <div>
              <p className="mb-1 text-[10px] font-bold tracking-[2px] text-matcha-accent">
                ACCOUNT
              </p>
              <h2 className="m-0 text-2xl font-semibold tracking-tight">
                Email address
              </h2>
              <p className="mb-0 mt-2 break-words text-sm leading-relaxed text-matcha-muted">
                Current email: {me.email}. Your new address becomes active after
                verification.
              </p>
            </div>
            <label className="grid min-w-0 gap-2 text-[13px] font-semibold text-matcha-text">
              <span>New email</span>
              <UiInput
                name="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? "form-errors" : undefined}
                type="email"
                required
                maxLength={254}
              />
            </label>
            <UiButton
              type="submit"
              variant="primary"
              className="min-h-12 w-full rounded-xl !border-matcha-accent !bg-matcha-accent font-bold !text-matcha-bg hover:!bg-matcha-accent/90 sm:w-fit sm:min-w-48"
              disabled={busy}
            >
              Send verification link
            </UiButton>
          </form>
        </div>
      </div>
      {blocker.state === "blocked" && (
        <AlertDialog>
          <AlertDialog.Backdrop
            isOpen
            isDismissable={false}
            isKeyboardDismissDisabled={false}
            onOpenChange={(open) => {
              if (!open) blocker.reset();
            }}
            className="fixed inset-0 z-[1500] bg-black/60 backdrop-blur-sm"
          >
            <AlertDialog.Container
              placement="center"
              size="sm"
              className="z-[1501]"
            >
              <AlertDialog.Dialog className="w-full rounded-3xl border border-matcha-border bg-matcha-surface p-6 text-matcha-text shadow-2xl">
                <AlertDialog.Header>
                  <AlertDialog.Heading className="text-xl font-semibold">
                    Leave without saving?
                  </AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body className="mt-2 text-sm leading-relaxed text-matcha-muted">
                  Your profile changes haven’t been saved yet.
                </AlertDialog.Body>
                <AlertDialog.Footer className="mt-6 flex justify-end gap-3">
                  <UiButton type="button" onClick={() => blocker.reset()}>
                    Keep editing
                  </UiButton>
                  <UiButton
                    type="button"
                    variant="primary"
                    onClick={() => blocker.proceed()}
                    className="!border-matcha-accent !bg-matcha-accent font-semibold !text-matcha-bg hover:!bg-matcha-accent/90"
                  >
                    Leave page
                  </UiButton>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      )}
    </div>
  );
}
