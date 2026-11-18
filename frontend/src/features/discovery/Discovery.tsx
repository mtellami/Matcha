import { UiInput } from "../../shared/UiInput";
import { UiSelect } from "../../shared/UiSelect";
import { UiButton } from "../../shared/UiButton";
import { Slider } from "@heroui/react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Heart,
  Leaf,
  MapPin,
  Minus,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import type { Profile, Runner } from "../../shared/types";
import { useSearchParams } from "react-router";

const ageMin = 18;
const ageMax = 120;
const distanceMax = 200;

function valuesFrom(params: URLSearchParams) {
  return {
    tags: (params.get("tags") || "")
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean),
    minAge: Math.max(ageMin, Number(params.get("min_age") || ageMin)),
    maxAge: Math.min(ageMax, Number(params.get("max_age") || ageMax)),
    distance: Math.min(
      distanceMax,
      Number(params.get("radius") || distanceMax),
    ),
    minFame: Math.max(0, Number(params.get("min_fame") || 0)),
    maxFame: Math.min(100, Number(params.get("max_fame") || 100)),
    city: params.get("city") || "",
    commonTags: Math.min(20, Number(params.get("min_common_tags") || 0)),
  };
}

export function Discovery({
  openProfile,
  completeProfile,
  run,
}: {
  openProfile: (id: number) => Promise<void>;
  completeProfile: () => void;
  run: Runner;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.toString();
  const params = new URLSearchParams(query);
  const initial = valuesFrom(params);
  const [result, setResult] = useState<{
    profiles: Profile[];
    total: number;
    page: number;
    page_size: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tags, setTags] = useState(initial.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState("");
  const [minAge, setMinAge] = useState(initial.minAge);
  const [maxAge, setMaxAge] = useState(initial.maxAge);
  const [distance, setDistance] = useState(initial.distance);
  const [minFame, setMinFame] = useState(initial.minFame);
  const [maxFame, setMaxFame] = useState(initial.maxFame);
  const [city, setCity] = useState(initial.city);
  const [commonTags, setCommonTags] = useState(initial.commonTags);

  useEffect(() => {
    const values = valuesFrom(new URLSearchParams(query));
    setTags(values.tags);
    setMinAge(values.minAge);
    setMaxAge(values.maxAge);
    setDistance(values.distance);
    setMinFame(values.minFame);
    setMaxFame(values.maxFame);
    setCity(values.city);
    setCommonTags(values.commonTags);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{
      profiles: Profile[];
      total: number;
      page: number;
      page_size: number;
    }>("/profiles?" + query, "GET", undefined, controller.signal)
      .then(setResult)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  function addTag() {
    const next = tagDraft.trim().replace(/^#/, "").toLowerCase();
    if (!next) return;
    if (!/^[\w-]{1,30}$/.test(next)) {
      setTagError("Use up to 30 letters, numbers, underscores or hyphens.");
      return;
    }
    if (tags.includes(next)) {
      setTagDraft("");
      setTagError("");
      return;
    }
    if (tags.length >= 20) {
      setTagError("You can add up to 20 interests.");
      return;
    }
    setTags((current) => [...current, next]);
    setTagDraft("");
    setTagError("");
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new URLSearchParams();
    const current = new URLSearchParams(query);
    for (const key of ["sort", "direction"]) {
      const value = current.get(key);
      if (value) values.set(key, value);
    }
    new FormData(event.currentTarget).forEach((value, key) => {
      const text = String(value).trim();
      if (text) values.set(key, text);
    });
    values.set("page", "1");
    setSearchParams(values, { replace: true });
  }

  function updateSort(key: "sort" | "direction", value: string) {
    const next = new URLSearchParams(query);
    next.set(key, value);
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  }

  function resetFilters() {
    setTags([]);
    setTagDraft("");
    setTagError("");
    setMinAge(ageMin);
    setMaxAge(ageMax);
    setDistance(distanceMax);
    setMinFame(0);
    setMaxFame(100);
    setCity("");
    setCommonTags(0);
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  function page(number: number) {
    const next = new URLSearchParams(query);
    next.set("page", String(number));
    setSearchParams(next, { replace: true });
  }

  function toggleLike(person: Profile) {
    void run(async () => {
      await api(
        `/profiles/${person.id}/like`,
        person.liked ? "DELETE" : "POST",
      );
      setResult((current) =>
        current
          ? {
              ...current,
              profiles: current.profiles.map((item) =>
                item.id === person.id
                  ? { ...item, liked: !person.liked }
                  : item,
              ),
            }
          : current,
      );
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <section className="mb-9 sm:mb-12" aria-labelledby="discover-heading">
        <p className="mb-3 flex items-center gap-2 text-xs font-bold tracking-[3px] text-matcha-accent">
          <span className="size-2 rounded-full bg-matcha-accent" />
          OPEN TO SOMETHING GOOD
        </p>
        <h1
          id="discover-heading"
          className="my-0 text-[clamp(2.25rem,4vw,3.5rem)] font-semibold leading-[1.08] tracking-[-.05em]"
        >
          Find your kind of <em>connection.</em>
        </h1>
        <p className="mb-0 mt-4 text-base leading-relaxed text-matcha-muted sm:text-xl">
          A shared passion. A nearby coffee. A story waiting to happen.
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-8">
        <form
          onSubmit={search}
          className="grid w-full min-w-0 gap-6 rounded-[28px] border border-matcha-border bg-matcha-surface p-5 shadow-[0_16px_48px_var(--shadow)] [&>*]:min-w-0 sm:p-7 lg:sticky lg:top-36"
        >
          <div className="flex items-center justify-between">
            <h2 className="m-0 flex items-center gap-3 text-2xl font-semibold tracking-tight">
              <SlidersHorizontal size={20} /> Filters
            </h2>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-matcha-accent hover:bg-matcha-accent/10 focus-visible:outline-2 focus-visible:outline-matcha-accent"
            >
              Reset
            </button>
          </div>

          <section
            className="grid min-w-0 gap-3"
            aria-labelledby="interest-filter-heading"
          >
            <h3
              id="interest-filter-heading"
              className="m-0 text-sm font-semibold"
            >
              Interests
            </h3>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-2 rounded-full border border-matcha-accent/20 bg-matcha-accent/10 py-1.5 pl-3.5 pr-2 text-sm font-semibold text-matcha-accent"
                  >
                    #{tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag} interest`}
                      className="grid size-6 place-items-center rounded-full hover:bg-matcha-accent/15 focus-visible:outline-2 focus-visible:outline-matcha-accent"
                      onClick={() =>
                        setTags((current) =>
                          current.filter((item) => item !== tag),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input type="hidden" name="tags" value={tags.join(",")} />
            <div className="flex min-w-0 gap-2">
              <UiInput
                aria-label="Add an interest"
                placeholder="Add an interest"
                value={tagDraft}
                onChange={(event) => {
                  setTagDraft(event.target.value);
                  setTagError("");
                }}
                onKeyDown={handleTagKeyDown}
                className="w-full min-w-0 flex-1"
              />
              <button
                type="button"
                aria-label="Add interest"
                onClick={addTag}
                className="grid size-12 shrink-0 place-items-center rounded-xl border border-matcha-border bg-matcha-bg text-matcha-accent hover:bg-matcha-accent/10 focus-visible:outline-2 focus-visible:outline-matcha-accent"
              >
                <Plus size={19} />
              </button>
            </div>
            {tagError && (
              <p className="m-0 text-xs text-[var(--danger-text)]" role="alert">
                {tagError}
              </p>
            )}
          </section>

          <section
            className="grid min-w-0 gap-2"
            aria-labelledby="age-filter-heading"
          >
            <div className="flex items-center justify-between">
              <h3 id="age-filter-heading" className="m-0 text-sm font-semibold">
                Age
              </h3>
              <span className="text-sm text-matcha-muted">
                {minAge} – {maxAge}
              </span>
            </div>
            <Slider
              aria-label="Age range"
              minValue={ageMin}
              maxValue={ageMax}
              step={1}
              value={[minAge, maxAge]}
              onChange={(values) => {
                if (Array.isArray(values)) {
                  setMinAge(values[0]);
                  setMaxAge(values[1]);
                }
              }}
              className="w-full min-w-0"
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb index={0} aria-label="Minimum age" />
                <Slider.Thumb index={1} aria-label="Maximum age" />
              </Slider.Track>
            </Slider>
            <input type="hidden" name="min_age" value={minAge} />
            <input type="hidden" name="max_age" value={maxAge} />
          </section>

          <section
            className="grid min-w-0 gap-2"
            aria-labelledby="distance-filter-heading"
          >
            <div className="flex items-center justify-between">
              <h3
                id="distance-filter-heading"
                className="m-0 text-sm font-semibold"
              >
                Distance
              </h3>
              <span className="text-sm text-matcha-muted">
                {distance === distanceMax ? "Any" : `Up to ${distance} km`}
              </span>
            </div>
            <Slider
              aria-label="Maximum distance in kilometers"
              minValue={0}
              maxValue={distanceMax}
              step={1}
              value={distance}
              onChange={(value) =>
                setDistance(typeof value === "number" ? value : value[0])
              }
              className="w-full min-w-0"
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb />
              </Slider.Track>
            </Slider>
            <input
              type="hidden"
              name="radius"
              value={distance === distanceMax ? "" : distance}
            />
          </section>

          <section
            className="grid min-w-0 gap-2"
            aria-labelledby="fame-filter-heading"
          >
            <div className="flex items-center justify-between">
              <h3
                id="fame-filter-heading"
                className="m-0 text-sm font-semibold"
              >
                Fame rating
              </h3>
              <span className="text-sm text-matcha-muted">
                {minFame} – {maxFame}
              </span>
            </div>
            <Slider
              aria-label="Fame rating range"
              minValue={0}
              maxValue={100}
              step={1}
              value={[minFame, maxFame]}
              onChange={(values) => {
                if (Array.isArray(values)) {
                  setMinFame(values[0]);
                  setMaxFame(values[1]);
                }
              }}
              className="w-full min-w-0"
            >
              <Slider.Track>
                <Slider.Fill />
                <Slider.Thumb index={0} aria-label="Minimum fame rating" />
                <Slider.Thumb index={1} aria-label="Maximum fame rating" />
              </Slider.Track>
            </Slider>
            <input type="hidden" name="min_fame" value={minFame} />
            <input type="hidden" name="max_fame" value={maxFame} />
          </section>

          <label
            className="grid min-w-0 gap-2 text-sm font-semibold"
            htmlFor="discover-city"
          >
            City or neighborhood
            <span className="relative block min-w-0">
              <MapPin
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-matcha-muted"
              />
              <UiInput
                id="discover-city"
                name="city"
                maxLength={100}
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Any location"
                className="w-full pl-11"
              />
            </span>
          </label>

          <section
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
            aria-labelledby="shared-interests-heading"
          >
            <h3
              id="shared-interests-heading"
              className="m-0 min-w-0 text-sm font-semibold leading-snug"
            >
              Minimum shared interests
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label="Require fewer shared interests"
                disabled={commonTags <= 0}
                onClick={() => setCommonTags((value) => Math.max(0, value - 1))}
                className="grid size-9 place-items-center rounded-full border border-matcha-border bg-matcha-surface hover:bg-matcha-raised disabled:opacity-40"
              >
                <Minus size={16} />
              </button>
              <strong className="min-w-4 text-center text-base">
                {commonTags}
              </strong>
              <button
                type="button"
                aria-label="Require more shared interests"
                disabled={commonTags >= 20}
                onClick={() =>
                  setCommonTags((value) => Math.min(20, value + 1))
                }
                className="grid size-9 place-items-center rounded-full border border-matcha-border bg-matcha-surface hover:bg-matcha-raised disabled:opacity-40"
              >
                <Plus size={16} />
              </button>
            </div>
            <input type="hidden" name="min_common_tags" value={commonTags} />
          </section>

          <UiButton
            type="submit"
            variant="primary"
            disabled={loading}
            className="min-h-[54px] w-full rounded-2xl !border-matcha-accent !bg-matcha-accent font-semibold !text-matcha-bg hover:!bg-matcha-accent/90"
          >
            Find people
          </UiButton>
        </form>

        <section className="min-w-0" aria-labelledby="suggestions-heading">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                id="suggestions-heading"
                className="m-0 text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                People you might click with
              </h2>
              <p
                className="mb-0 mt-1 text-sm text-matcha-muted"
                role="status"
                aria-live="polite"
              >
                {loading
                  ? "Finding your people…"
                  : error
                    ? "Suggestions could not be updated."
                    : `${result?.total ?? 0} ${result?.total === 1 ? "person" : "people"}, a little closer to your world`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <UiSelect
                aria-label="Sort suggestions"
                className="!bg-matcha-surface"
                value={params.get("sort") || "suggested"}
                onChange={(event) => updateSort("sort", event.target.value)}
                options={[
                  { value: "suggested", label: "Recommended" },
                  { value: "distance", label: "Distance" },
                  { value: "age", label: "Age" },
                  { value: "fame", label: "Fame" },
                  { value: "common_tags", label: "Shared interests" },
                ]}
              />
              <button
                type="button"
                onClick={() =>
                  updateSort(
                    "direction",
                    params.get("direction") === "desc" ? "asc" : "desc",
                  )
                }
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-matcha-border bg-matcha-surface px-4 text-sm font-medium text-matcha-text hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-matcha-accent"
              >
                {params.get("direction") === "desc"
                  ? "Descending"
                  : "Ascending"}
                {params.get("direction") === "desc" ? (
                  <ArrowDown size={16} />
                ) : (
                  <ArrowUp size={16} />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-2xl bg-[var(--danger-bg)] p-4 text-[var(--danger-text)]"
            >
              {error}
            </div>
          )}
          {loading ? (
            <div
              className="grid grid-cols-1 gap-5 sm:grid-cols-2"
              aria-hidden="true"
            >
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="aspect-[4/5] animate-pulse rounded-[26px] bg-matcha-raised"
                />
              ))}
            </div>
          ) : !error && result?.profiles.length === 0 ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[28px] border border-matcha-border bg-gradient-to-br from-matcha-accent/[0.035] to-matcha-accent/[0.12] px-6 py-12 text-center sm:px-12">
              <span className="grid size-20 place-items-center rounded-full bg-matcha-surface text-matcha-accent shadow-sm">
                <Leaf size={30} />
              </span>
              <h3 className="mb-0 mt-6 text-3xl font-semibold tracking-tight">
                A little room for possibility
              </h3>
              <p className="mb-0 mt-3 max-w-[470px] text-base leading-relaxed text-matcha-muted">
                No one matches these filters yet. Try widening them, or complete
                your profile to find your people.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <UiButton
                  type="button"
                  variant="primary"
                  onClick={resetFilters}
                  className="min-h-12 rounded-2xl !border-matcha-accent !bg-matcha-accent px-6 font-semibold !text-matcha-bg hover:!bg-matcha-accent/90"
                >
                  Reset filters
                </UiButton>
                <UiButton
                  type="button"
                  onClick={completeProfile}
                  className="min-h-12 rounded-2xl px-6 font-semibold"
                >
                  Edit my profile
                </UiButton>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {!error &&
                  result?.profiles.map((person) => (
                    <article
                      key={person.id}
                      className="overflow-hidden rounded-[26px] border border-matcha-border bg-matcha-surface shadow-[0_12px_36px_var(--shadow)] transition-transform hover:-translate-y-1"
                    >
                      <div className="relative aspect-[4/5] overflow-hidden bg-matcha-raised">
                        <button
                          type="button"
                          onClick={() => void run(() => openProfile(person.id))}
                          aria-label={`View ${person.first_name}, age ${person.age}, in ${person.city}`}
                          className="group absolute inset-0 block size-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-matcha-accent"
                        >
                          {person.photo_id ? (
                            <img
                              className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] hover:scale-[1.03]"
                              src={"/api/v1/photos/" + person.photo_id}
                              alt={`${person.first_name}’s profile photo`}
                              loading="lazy"
                            />
                          ) : (
                            <span className="absolute inset-0 flex items-center justify-center gap-5 bg-[var(--avatar-bg)] text-matcha-accent">
                              <span className="font-serif text-[clamp(5rem,12vw,8rem)]">
                                {person.first_name[0]}
                              </span>
                              <Leaf size={44} />
                            </span>
                          )}
                        </button>
                        {person.online && (
                          <span className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-matcha-surface/95 px-3.5 py-2 text-xs font-semibold text-emerald-700 shadow-sm dark:text-emerald-300">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            Online
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={
                            person.liked
                              ? `Remove interest in ${person.first_name}`
                              : `Like ${person.first_name}`
                          }
                          aria-pressed={Boolean(person.liked)}
                          onClick={() => toggleLike(person)}
                          className={`absolute bottom-4 right-4 grid size-12 place-items-center rounded-full bg-matcha-surface text-matcha-accent shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent ${person.liked ? "text-pink-600 dark:text-pink-300" : ""}`}
                        >
                          <Heart
                            size={21}
                            fill={person.liked ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => void run(() => openProfile(person.id))}
                        className="block w-full px-5 pb-5 pt-4 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-matcha-accent"
                      >
                        <span className="flex items-baseline gap-2">
                          <strong className="text-[23px] font-semibold tracking-tight text-matcha-text">
                            {person.first_name}
                          </strong>
                          {person.age !== null && (
                            <span className="text-lg text-matcha-muted">
                              {person.age}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-sm text-matcha-muted">
                          <MapPin size={16} className="shrink-0" />
                          {person.distance != null
                            ? `${person.distance} km away`
                            : person.city}
                        </span>
                        {person.tags.length > 0 && (
                          <span className="mt-3 flex flex-wrap gap-1.5">
                            {person.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-matcha-accent/10 px-3 py-1.5 text-xs font-semibold text-matcha-accent"
                              >
                                #{tag}
                              </span>
                            ))}
                            {person.tags.length > 2 && (
                              <span className="rounded-full bg-matcha-raised px-3 py-1.5 text-xs font-semibold text-matcha-muted">
                                +{person.tags.length - 2}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </article>
                  ))}
              </div>
              {result && result.total > result.page_size && !error && (
                <nav
                  className="mt-8 flex items-center justify-center gap-5 text-sm"
                  aria-label="Profile results pages"
                >
                  <UiButton
                    disabled={result.page <= 1}
                    aria-label="Previous results page"
                    onClick={() => page(result.page - 1)}
                  >
                    Previous
                  </UiButton>
                  <span>
                    Page {result.page} of{" "}
                    {Math.ceil(result.total / result.page_size)}
                  </span>
                  <UiButton
                    disabled={result.page * result.page_size >= result.total}
                    aria-label="Next results page"
                    onClick={() => page(result.page + 1)}
                  >
                    Next
                  </UiButton>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
