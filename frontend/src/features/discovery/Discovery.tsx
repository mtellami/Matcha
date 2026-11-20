import { MobileDiscoveryDeck } from "./MobileDiscoveryDeck";
import { UiInput } from "../../shared/UiInput";
import { UiSelect } from "../../shared/UiSelect";
import { UiButton } from "../../shared/UiButton";
import { Modal, Slider } from "@heroui/react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Heart,
  Leaf,
  MapPin,
  Minus,
  Plus,
  SlidersHorizontal,
  Search,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import type { Me, Profile, Runner } from "../../shared/types";
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
  viewer,
  openMessage,
  openProfile,
  completeProfile,
  run,
}: {
  viewer: Me;
  openMessage: (id: number) => void;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState(params.get("q") || "");
  const [searchError, setSearchError] = useState("");
  const [draftSort, setDraftSort] = useState(params.get("sort") || "suggested");
  const [draftDirection, setDraftDirection] = useState(
    params.get("direction") || "asc",
  );
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [pendingLikes, setPendingLikes] = useState<number[]>([]);

  const sortOptions = [
    { value: "suggested", label: "Recommended" },
    { value: "distance", label: "Distance" },
    { value: "age", label: "Age" },
    { value: "fame", label: "Fame" },
    { value: "common_tags", label: "Shared interests" },
  ];
  const applied = valuesFrom(params);
  const chips: { label: string; keys: string[]; tag?: string }[] = [
    ...(params.get("q")
      ? [{ label: `Search: ${params.get("q")}`, keys: ["q"] }]
      : []),
    ...applied.tags.map((tag) => ({ label: tag, keys: ["tags"], tag })),
    ...(applied.minAge !== ageMin || applied.maxAge !== ageMax
      ? [
          {
            label: `Age ${applied.minAge}–${applied.maxAge}`,
            keys: ["min_age", "max_age"],
          },
        ]
      : []),
    ...(params.has("radius")
      ? [{ label: `Within ${applied.distance} km`, keys: ["radius"] }]
      : []),
    ...(applied.minFame !== 0 || applied.maxFame !== 100
      ? [
          {
            label: `Fame ${applied.minFame}–${applied.maxFame}`,
            keys: ["min_fame", "max_fame"],
          },
        ]
      : []),
    ...(applied.city ? [{ label: applied.city, keys: ["city"] }] : []),
    ...(applied.commonTags
      ? [
          {
            label: `${applied.commonTags}+ shared interests`,
            keys: ["min_common_tags"],
          },
        ]
      : []),
  ];
  const filterCount = new Set(chips.map((chip) => chip.keys[0])).size;
  const visibleProfiles =
    result?.profiles.filter((person) => !dismissed.includes(person.id)) ?? [];

  function draftParams() {
    const next = new URLSearchParams();
    if (params.get("q")) next.set("q", params.get("q")!);
    if (tags.length) next.set("tags", tags.join(","));
    if (minAge !== ageMin) next.set("min_age", String(minAge));
    if (maxAge !== ageMax) next.set("max_age", String(maxAge));
    if (distance !== distanceMax) next.set("radius", String(distance));
    if (minFame !== 0) next.set("min_fame", String(minFame));
    if (maxFame !== 100) next.set("max_fame", String(maxFame));
    if (city.trim()) next.set("city", city.trim());
    if (commonTags) next.set("min_common_tags", String(commonTags));
    next.set("sort", draftSort);
    next.set("direction", draftDirection);
    return next;
  }
  const previewQuery = draftParams().toString();
  useEffect(() => {
    if (!filtersOpen) return;
    const controller = new AbortController();
    setPreviewTotal(null);
    const timeout = window.setTimeout(() => {
      api<{ total: number }>(
        "/profiles?" + previewQuery,
        "GET",
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted) setPreviewTotal(data.total);
        })
        .catch(() => {});
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filtersOpen, previewQuery]);

  function openFilters() {
    const values = valuesFrom(new URLSearchParams(query));
    setSearchText(new URLSearchParams(query).get("q") || "");
    setTags(values.tags);
    setMinAge(values.minAge);
    setMaxAge(values.maxAge);
    setDistance(values.distance);
    setMinFame(values.minFame);
    setMaxFame(values.maxFame);
    setCity(values.city);
    setCommonTags(values.commonTags);
    setDraftSort(params.get("sort") || "suggested");
    setDraftDirection(params.get("direction") || "asc");
    setTagDraft("");
    setTagError("");
    setFiltersOpen(true);
  }

  function removeChip(chip: (typeof chips)[number]) {
    const next = new URLSearchParams(query);
    if (chip.tag) {
      const remaining = applied.tags.filter((tag) => tag !== chip.tag);
      if (remaining.length) next.set("tags", remaining.join(","));
      else next.delete("tags");
    } else chip.keys.forEach((key) => next.delete(key));
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  }

  function searchPeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = searchText.trim();
    if (text.length > 200) {
      setSearchError("Use up to 200 characters to search.");
      return;
    }
    const next = new URLSearchParams(query);
    if (text) next.set("q", text);
    else next.delete("q");
    next.set("page", "1");
    setSearchParams(next, { replace: true });
    setSearchError("");
  }

  useEffect(() => {
    const values = valuesFrom(new URLSearchParams(query));
    setSearchText(new URLSearchParams(query).get("q") || "");
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
    const values = draftParams();
    if (tagDraft.trim()) {
      const next = tagDraft.trim().replace(/^#/, "").toLowerCase();
      if (
        !/^[\w-]{1,30}$/.test(next) ||
        (!tags.includes(next) && tags.length >= 20)
      ) {
        addTag();
        return;
      }
      values.set("tags", [...new Set([...tags, next])].join(","));
      addTag();
    }
    values.set("page", "1");
    setSearchParams(values, { replace: true });
    setFiltersOpen(false);
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
    setDraftSort(
      window.matchMedia("(max-width: 639px)").matches
        ? "suggested"
        : params.get("sort") || "suggested",
    );
    setDraftDirection("asc");
    setDismissed([]);
    setSearchText("");
    if (!filtersOpen) setSearchParams(new URLSearchParams(), { replace: true });
  }

  function page(number: number) {
    const next = new URLSearchParams(query);
    next.set("page", String(number));
    setSearchParams(next, { replace: true });
  }

  function toggleLike(person: Profile) {
    if (pendingLikes.includes(person.id)) return;
    setPendingLikes((current) => [...current, person.id]);
    void run(async () => {
      try {
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
      } finally {
        setPendingLikes((current) => current.filter((id) => id !== person.id));
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1140px]">
      <section
        className="mb-6 flex flex-wrap items-end justify-between gap-4"
        aria-labelledby="discover-heading"
      >
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 whitespace-nowrap text-[10px] font-bold tracking-[1.5px] text-matcha-accent sm:mb-3 sm:whitespace-normal sm:text-xs sm:tracking-[2.5px]">
            <span className="size-2 rounded-full bg-matcha-accent" />
            OPEN TO SOMETHING GOOD
          </p>
          <h1
            id="discover-heading"
            className="m-0 whitespace-nowrap text-[clamp(1.125rem,6.3vw,2.25rem)] font-semibold leading-[1.15] tracking-[-.045em] sm:whitespace-normal sm:text-[clamp(2rem,3.2vw,3rem)]"
          >
            Find your kind of{" "}
            <em className="font-[family-name:var(--font-editorial)] font-normal text-matcha-accent">
              connection.
            </em>
          </h1>
        </div>
        <p
          className="sr-only m-0 text-sm text-matcha-muted sm:not-sr-only"
          role="status"
          aria-live="polite"
        >
          {loading
            ? "Finding your people…"
            : error
              ? "Suggestions could not be updated."
              : `${result?.total ?? 0} ${result?.total === 1 ? "person" : "people"} ${filterCount ? "with these filters" : "near you"}`}
        </p>
      </section>

      <div className="mb-5 flex flex-wrap gap-3 sm:mb-6">
        <form
          onSubmit={searchPeople}
          className="relative min-w-0 flex-1 basis-0"
          role="search"
        >
          <Search
            size={19}
            className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-matcha-muted"
          />
          <UiInput
            aria-label="Search by name or username"
            placeholder="Name or username"
            value={searchText}
            maxLength={200}
            onChange={(event) => {
              setSearchText(event.target.value);
              setSearchError("");
            }}
            aria-invalid={Boolean(searchError)}
            aria-describedby={searchError ? "interest-search-error" : undefined}
            className="h-12 w-full !rounded-full !bg-matcha-surface !pl-12 !pr-12"
          />
          {searchText && (
            <button
              type="submit"
              aria-label="Search people"
              className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-matcha-accent text-[var(--accent-foreground)]"
            >
              <Search size={16} />
            </button>
          )}
        </form>
        <button
          type="button"
          onClick={openFilters}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          aria-label={
            filterCount ? `Filters, ${filterCount} active` : "Filters"
          }
          className="relative inline-flex size-12 shrink-0 items-center justify-center gap-2 rounded-full border border-matcha-border bg-matcha-surface text-sm sm:w-auto sm:px-5 hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-matcha-accent"
        >
          <SlidersHorizontal size={19} />
          <span className="hidden sm:inline">Filters</span>
          {filterCount > 0 && (
            <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-matcha-accent sm:static sm:size-6 text-xs font-semibold text-[var(--accent-foreground)]">
              {filterCount}
            </span>
          )}
        </button>
        <div className="hidden min-w-0 justify-end sm:flex">
          <UiSelect
            aria-label="Sort suggestions"
            className="!min-h-9 !rounded-full !bg-matcha-surface !px-4 !text-sm sm:!min-h-12 sm:!px-5 !gap-4 [&_[data-slot=select-default-indicator]]:!static"
            value={params.get("sort") || "suggested"}
            onChange={(event) => updateSort("sort", event.target.value)}
            options={sortOptions}
          />
        </div>
      </div>
      {searchError && (
        <p
          id="interest-search-error"
          role="alert"
          className="text-sm text-[var(--danger-text)]"
        >
          {searchError}
        </p>
      )}
      {chips.length > 0 && (
        <div
          className="mb-6 flex flex-wrap items-center gap-2"
          aria-label="Active filters"
        >
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.label + chip.keys[0]}
              onClick={() => removeChip(chip)}
              aria-label={`Remove ${chip.label} filter`}
              className="inline-flex items-center gap-2 rounded-full border border-matcha-accent/15 bg-matcha-accent/5 px-4 py-2 text-sm font-medium text-matcha-accent hover:bg-matcha-accent/10"
            >
              {chip.label}
              <X size={14} />
            </button>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="px-2 py-2 text-sm font-semibold text-matcha-accent"
          >
            Clear all
          </button>
        </div>
      )}

      <section aria-label="Discover people" aria-busy={loading}>
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
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 [&>*:not(:first-child)]:hidden sm:[&>*:not(:first-child)]:block"
            aria-hidden="true"
          >
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div
                key={index}
                className="aspect-[3/4] animate-pulse rounded-[24px] bg-matcha-raised"
              />
            ))}
          </div>
        ) : !error && result?.profiles.length === 0 ? (
          <div className="flex min-h-[470px] flex-col items-center justify-center rounded-[28px] border border-matcha-border bg-gradient-to-br from-matcha-accent/[0.035] to-matcha-accent/[0.12] px-6 py-12 text-center sm:px-12">
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
                className="min-h-12 rounded-2xl !border-matcha-accent !bg-matcha-accent px-6 font-semibold !text-[var(--accent-foreground)] hover:!bg-matcha-accent/90"
              >
                Clear filters
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
        ) : !error ? (
          <>
            <MobileDiscoveryDeck
              key={query}
              profiles={visibleProfiles}
              viewer={viewer}
              run={run}
              openProfile={openProfile}
              openMessage={openMessage}
              onDismiss={(id) => setDismissed((current) => [...current, id])}
              onRestart={() => setDismissed([])}
              onRestore={(id) =>
                setDismissed((current) => current.filter((item) => item !== id))
              }
              onLikeChanged={(id, liked) =>
                setResult((current) =>
                  current
                    ? {
                        ...current,
                        profiles: current.profiles.map((person) =>
                          person.id === id ? { ...person, liked } : person,
                        ),
                      }
                    : current,
                )
              }
            />
            {visibleProfiles.length === 0 &&
              result &&
              result.profiles.length > 0 && (
                <div className="hidden rounded-3xl border border-matcha-border bg-matcha-surface px-6 py-12 text-center sm:block">
                  <h2 className="text-xl font-semibold">
                    You’ve seen everyone on this page
                  </h2>
                  <UiButton onClick={() => setDismissed([])}>
                    Show dismissed suggestions
                  </UiButton>
                </div>
              )}
            <div className="hidden gap-5 sm:grid sm:grid-cols-2 lg:grid-cols-3">
              {visibleProfiles.map((person) => (
                <article
                  key={person.id}
                  aria-label={`${person.first_name}'s profile`}
                  className="group relative isolate aspect-[3/4] overflow-hidden rounded-[24px] bg-matcha-raised shadow-[0_12px_28px_var(--shadow)]"
                >
                  <button
                    type="button"
                    onClick={() => void run(() => openProfile(person.id))}
                    aria-label={`View ${person.first_name}'s profile`}
                    className="absolute inset-0 size-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-matcha-accent"
                  >
                    {person.photo_id ? (
                      <img
                        className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        src={"/api/v1/photos/" + person.photo_id}
                        alt={`${person.first_name}’s profile photo`}
                        loading="lazy"
                      />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--avatar-bg)] to-[var(--avatar-muted)]">
                        <span className="grid size-28 place-items-center rounded-full bg-matcha-accent/20 font-[family-name:var(--font-editorial)] text-6xl text-matcha-accent">
                          {person.first_name[0]}
                        </span>
                      </span>
                    )}
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#241522]/95 via-transparent to-transparent" />
                    <span className="absolute bottom-4 left-4 right-16 text-white">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <strong className="text-[22px] font-semibold tracking-tight">
                          {person.first_name}
                        </strong>
                        {person.age !== null && (
                          <span className="text-lg">{person.age}</span>
                        )}
                      </span>
                      {(person.distance != null || person.city) && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-white/90">
                          <MapPin size={13} className="shrink-0" />
                          {person.distance != null
                            ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(person.distance)} km away`
                            : person.city}
                        </span>
                      )}
                      {person.tags.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {person.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-white/25 px-2 py-1 text-[11px] font-medium leading-none"
                            >
                              #{tag}
                            </span>
                          ))}
                          {person.tags.length > 2 && (
                            <span className="rounded-full bg-white/25 px-2 py-1 text-[11px] leading-none">
                              +{person.tags.length - 2}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                  {person.online && (
                    <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  )}
                  <div className="absolute bottom-4 right-3 flex flex-col gap-2">
                    <button
                      type="button"
                      aria-label={`Dismiss ${person.first_name} for this session`}
                      title="Dismiss for this session"
                      onClick={() =>
                        setDismissed((current) => [...current, person.id])
                      }
                      className="grid size-10 place-items-center rounded-full bg-white text-[#2e232d] shadow-sm transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
                    >
                      <X size={19} />
                    </button>
                    <button
                      type="button"
                      aria-label={
                        person.liked
                          ? `Remove interest in ${person.first_name}`
                          : `Like ${person.first_name}`
                      }
                      aria-pressed={Boolean(person.liked)}
                      disabled={pendingLikes.includes(person.id)}
                      onClick={() => toggleLike(person)}
                      className="grid size-10 place-items-center rounded-full bg-matcha-accent text-[var(--accent-foreground)] shadow-sm transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent disabled:opacity-50"
                    >
                      <Heart
                        size={18}
                        fill={person.liked ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
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
        ) : null}
      </section>

      <Modal isOpen={filtersOpen} onOpenChange={setFiltersOpen}>
        <Modal.Backdrop
          isDismissable
          className="discovery-filter-backdrop fixed inset-0 z-[1600] !w-screen bg-[#241522]/45"
        >
          <Modal.Container
            placement="center"
            scroll="inside"
            className="discovery-filter-drawer !fixed !inset-y-0 !left-[max(0px,calc(100vw-440px))] !right-auto z-[1601] !flex !w-[min(440px,100vw)] !flex-row !items-stretch !justify-end !p-0"
          >
            <Modal.Dialog className="!m-0 flex !h-dvh !max-h-dvh !w-[min(440px,100%)] !max-w-none shrink-0 flex-col gap-0 !rounded-none bg-matcha-surface !p-0 text-matcha-text shadow-2xl">
              <Modal.Header className="flex !flex-row shrink-0 items-center justify-between border-b border-matcha-border px-6 py-5">
                <Modal.Heading className="m-0 text-2xl font-semibold tracking-tight">
                  Filters
                </Modal.Heading>
                <button
                  type="button"
                  aria-label="Close filters"
                  onClick={() => setFiltersOpen(false)}
                  className="grid size-11 place-items-center rounded-full border border-matcha-border hover:bg-matcha-raised"
                >
                  <X size={20} />
                </button>
              </Modal.Header>
              <form onSubmit={search} className="flex min-h-0 flex-1 flex-col">
                <div className="grid min-h-0 flex-1 content-start gap-7 overflow-y-auto px-6 py-6 [&>*]:min-w-0">
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
                    {tags.length > 0 && (
                      <div
                        className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1"
                        role="region"
                        aria-label="Selected interests"
                        tabIndex={0}
                      >
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-matcha-accent/20 bg-matcha-accent/10 py-1.5 pl-3.5 pr-2 text-sm font-semibold text-matcha-accent"
                          >
                            {tag}
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
                    {tagError && (
                      <p
                        className="m-0 text-xs text-[var(--danger-text)]"
                        role="alert"
                      >
                        {tagError}
                      </p>
                    )}
                  </section>

                  <section
                    className="grid min-w-0 gap-2"
                    aria-labelledby="age-filter-heading"
                  >
                    <div className="flex items-center justify-between">
                      <h3
                        id="age-filter-heading"
                        className="m-0 text-sm font-semibold"
                      >
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
                      className="discovery-slider w-full min-w-0 py-2"
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
                        {distance === distanceMax
                          ? "Any"
                          : `Up to ${distance} km`}
                      </span>
                    </div>
                    <Slider
                      aria-label="Maximum distance in kilometers"
                      minValue={0}
                      maxValue={distanceMax}
                      step={1}
                      value={distance}
                      onChange={(value) =>
                        setDistance(
                          typeof value === "number" ? value : value[0],
                        )
                      }
                      className="discovery-slider w-full min-w-0 py-2"
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
                      className="discovery-slider w-full min-w-0 py-2"
                    >
                      <Slider.Track>
                        <Slider.Fill />
                        <Slider.Thumb
                          index={0}
                          aria-label="Minimum fame rating"
                        />
                        <Slider.Thumb
                          index={1}
                          aria-label="Maximum fame rating"
                        />
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
                        onClick={() =>
                          setCommonTags((value) => Math.max(0, value - 1))
                        }
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
                    <input
                      type="hidden"
                      name="min_common_tags"
                      value={commonTags}
                    />
                  </section>

                  <div className="grid gap-3 sm:hidden">
                    <h3 className="m-0 text-sm font-semibold">Sort by</h3>
                    <UiSelect
                      aria-label="Sort suggestions"
                      value={draftSort}
                      onChange={(event) => setDraftSort(event.target.value)}
                      options={sortOptions}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-matcha-border px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                  <UiButton
                    type="button"
                    onClick={resetFilters}
                    className="min-h-12 px-5"
                  >
                    Reset
                  </UiButton>
                  <UiButton
                    type="submit"
                    variant="primary"
                    className="min-h-12 flex-1 !border-matcha-accent !bg-matcha-accent font-semibold !text-[var(--accent-foreground)]"
                  >
                    {previewTotal === null
                      ? "Show people"
                      : `Show ${previewTotal} ${previewTotal === 1 ? "person" : "people"}`}
                  </UiButton>
                </div>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
