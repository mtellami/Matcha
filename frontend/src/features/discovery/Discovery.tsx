import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Heart, Leaf } from "lucide-react";
import { api } from "../../shared/api";
import type { Profile, Runner } from "../../shared/types";

export function Discovery({
  openProfile,
  completeProfile,
  run,
}: {
  openProfile: (id: number) => Promise<void>;
  completeProfile: () => void;
  run: Runner;
}) {
  const [query, setQuery] = useState(() =>
    new URLSearchParams(location.search).toString(),
  );
  const [result, setResult] = useState<{
    profiles: Profile[];
    total: number;
    page: number;
    page_size: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const params = new URLSearchParams(query);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    history.replaceState({}, "", query ? "/?" + query : "/");
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
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (String(value).trim()) values.set(key, String(value).trim());
    });
    values.set("page", "1");
    setQuery(values.toString());
  }
  function page(number: number) {
    const next = new URLSearchParams(query);
    next.set("page", String(number));
    setQuery(next.toString());
  }
  return (
    <>
      <div className="intro">
        <div>
          <div className="eyebrow">
            <span className="dot" /> OPEN TO SOMETHING GOOD
          </div>
          <h1>
            Find your kind
            <br />
            of <em>connection.</em>
          </h1>
          <p>A shared passion. A nearby coffee. A story waiting to happen.</p>
        </div>
        <div className="intro-note">
          <span>✳</span>Less scrolling.
          <br />
          More butterflies.
        </div>
      </div>
      <form className="search-form" onSubmit={search}>
        <div className="toolbar">
          <div>
            <h2>
              People you might click with <span>{result?.total ?? "…"}</span>
            </h2>
            <p className="sr-only" role="status" aria-live="polite">
              {loading
                ? "Updating your suggestions."
                : error
                  ? "Your suggestions could not be updated."
                  : result
                    ? `${result.total} profiles found. Page ${result.page} of ${Math.max(1, Math.ceil(result.total / result.page_size))}.`
                    : ""}
            </p>
            <p>A little closer to your world.</p>
          </div>
          <div className="search-controls">
            <input
              name="tags"
              aria-label="Interest tags"
              placeholder="Interests: coffee,music"
              defaultValue={params.get("tags") || ""}
            />
            <button className="primary" disabled={loading}>
              Find people
            </button>
          </div>
        </div>
        <details>
          <summary>Advanced filters and sorting</summary>
          <div className="filter-grid">
            <label>
              Minimum age
              <input
                name="min_age"
                type="number"
                min="18"
                max="120"
                defaultValue={params.get("min_age") || "18"}
              />
            </label>
            <label>
              Maximum age
              <input
                name="max_age"
                type="number"
                min="18"
                max="120"
                defaultValue={params.get("max_age") || "120"}
              />
            </label>
            <label>
              Within (km)
              <input
                name="radius"
                type="number"
                min="0"
                max="20040"
                step="0.1"
                defaultValue={params.get("radius") || ""}
                placeholder="Any distance"
              />
            </label>
            <label>
              City or neighborhood
              <input
                name="city"
                maxLength={100}
                defaultValue={params.get("city") || ""}
                placeholder="Any location"
              />
            </label>
            <label>
              Minimum fame
              <input
                name="min_fame"
                type="number"
                min="0"
                max="100"
                defaultValue={params.get("min_fame") || "0"}
              />
            </label>
            <label>
              Maximum fame
              <input
                name="max_fame"
                type="number"
                min="0"
                max="100"
                defaultValue={params.get("max_fame") || "100"}
              />
            </label>
            <label>
              Minimum shared interests
              <input
                name="min_common_tags"
                type="number"
                min="0"
                max="20"
                defaultValue={params.get("min_common_tags") || "0"}
              />
            </label>
            <label>
              Sort by
              <select
                name="sort"
                defaultValue={params.get("sort") || "suggested"}
              >
                <option value="suggested">Recommended</option>
                <option value="distance">Distance</option>
                <option value="age">Age</option>
                <option value="fame">Fame</option>
                <option value="common_tags">Shared interests</option>
              </select>
            </label>
            <label>
              Order
              <select
                name="direction"
                defaultValue={params.get("direction") || "asc"}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
          </div>
        </details>
      </form>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">Finding your people…</p>
      ) : (
        <>
          <div className="grid">
            {!error &&
              result?.profiles.map((person, index) => (
                <button
                  className="card"
                  key={person.id}
                  aria-label={`View ${person.first_name}, age ${person.age}, in ${person.city}`}
                  onClick={() => void run(() => openProfile(person.id))}
                >
                  <div className={"card-image color-" + (index % 4)}>
                    {person.photo_id ? (
                      <img
                        src={"/api/v1/photos/" + person.photo_id}
                        alt={`${person.first_name}’s profile photo`}
                        loading="lazy"
                      />
                    ) : (
                      <span className="initial">
                        {person.first_name[0]}
                        <Leaf size={46} />
                      </span>
                    )}
                    <span className="distance">{person.distance} km away</span>
                    <span className="heart">
                      <Heart size={19} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="card-body">
                    <h3>
                      {person.first_name}, {person.age}
                      <ArrowUpRight size={19} />
                    </h3>
                    <span className="location">
                      {person.city} · Fame {person.fame}
                    </span>
                    <p>{person.bio}</p>
                    <div className="tags">
                      {person.tags.map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
          </div>
          {!error && result?.profiles.length === 0 && (
            <div className="empty">
              <Leaf size={40} />
              <h2>A little room for possibility</h2>
              <p>
                Try broader filters, or complete your profile to find your
                people.
              </p>
              <button onClick={completeProfile}>Edit my profile →</button>
            </div>
          )}
          {result && result.total > 24 && !error && (
            <nav className="pagination" aria-label="Profile results pages">
              <button
                disabled={result.page <= 1}
                aria-label="Previous results page"
                onClick={() => page(result.page - 1)}
              >
                Previous
              </button>
              <span>
                Page {result.page} of {Math.ceil(result.total / 24)}
              </span>
              <button
                disabled={result.page * 24 >= result.total}
                aria-label="Next results page"
                onClick={() => page(result.page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
