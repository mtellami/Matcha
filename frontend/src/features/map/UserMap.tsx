import { UiButton } from "../../shared/UiButton";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowUpRight, MapPin, RefreshCw } from "lucide-react";
import { api } from "../../shared/api";
import type { MapUser, Me, Runner } from "../../shared/types";

export function UserMap({
  me,
  openProfile,
  manageLocation,
  run,
}: {
  me: Me;
  openProfile: (id: number) => Promise<void>;
  manageLocation: () => void;
  run: Runner;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const [users, setUsers] = useState<MapUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ users: MapUser[] }>("/map/users", "GET", undefined, controller.signal)
      .then((result) => setUsers(result.users))
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "The map could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!container.current || me.latitude === null || me.longitude === null)
      return;
    const instance = L.map(container.current, {
      scrollWheelZoom: false,
    }).setView([me.latitude, me.longitude], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    L.circleMarker([me.latitude, me.longitude], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#883578",
      fillOpacity: 1,
    })
      .bindTooltip("You")
      .addTo(instance);
    map.current = instance;
    const frame = requestAnimationFrame(() => instance.invalidateSize());
    return () => {
      cancelAnimationFrame(frame);
      instance.remove();
      map.current = null;
      markers.current = null;
    };
  }, [me.latitude, me.longitude]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    markers.current?.remove();
    const group = L.layerGroup().addTo(instance);
    markers.current = group;
    const bounds = L.latLngBounds([[me.latitude!, me.longitude!]]);
    for (const user of users) {
      const marker = L.circleMarker([user.latitude, user.longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#c55bb0",
        fillOpacity: 0.95,
      });
      const popup = document.createElement("div");
      popup.className = "min-w-[145px] text-matcha-text";
      if (user.photo_id) {
        const image = document.createElement("img");
        image.className =
          "mb-2 block max-h-[105px] w-full rounded-lg object-cover";
        image.src = `/api/v1/photos/${user.photo_id}`;
        image.alt = `${user.first_name}’s profile photo`;
        popup.append(image);
      }
      const name = document.createElement("strong");
      name.textContent = `${user.first_name}, ${user.age}`;
      popup.append(name);
      const city = document.createElement("p");
      city.className = "my-[3px] mb-2 text-xs";
      city.textContent = user.city;
      popup.append(city);
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "inline-flex items-center border-0 bg-transparent py-[5px] text-xs text-matcha-accent";
      button.textContent = "View profile";
      button.append(document.createTextNode(" "));
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "↗";
      button.append(icon);
      button.addEventListener("click", () => {
        instance.closePopup();
        void run(() => openProfile(user.id));
      });
      popup.append(button);
      marker.bindPopup(popup).addTo(group);
      bounds.extend([user.latitude, user.longitude]);
    }
    if (users.length)
      instance.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  }, [users, me.latitude, me.longitude, openProfile, run]);

  if (me.latitude === null || me.longitude === null)
    return (
      <section className="grid gap-3 max-[950px]:[grid-template-columns:repeat(2,_1fr)] max-[600px]:[gap:14px]">
        <div className="eyebrow [font-size:10px] [font-weight:700] [letter-spacing:2.3px] [color:var(--accent)] [display:flex] [align-items:center] [gap:8px]">
          <MapPin size={14} /> A LITTLE CLOSER
        </div>
        <h1 className="my-5 text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[1.12] tracking-[-2px]">
          Your map needs <em>a location.</em>
        </h1>
        <p>Add a city or use GPS in your profile to see nearby people.</p>
      </section>
    );

  return (
    <section
      className="grid gap-3.5 max-[950px]:[grid-template-columns:repeat(2,_1fr)] max-[600px]:[gap:14px]"
      aria-labelledby="map-title"
    >
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow [font-size:10px] [font-weight:700] [letter-spacing:2.3px] [color:var(--accent)] [display:flex] [align-items:center] [gap:8px]">
            <MapPin size={14} /> YOUR LITTLE CORNER
          </div>
          <h1
            className="my-5 text-[clamp(2.5rem,5vw,4rem)] font-medium leading-[1.12] tracking-[-2px]"
            id="map-title"
          >
            Find people <em>nearby.</em>
          </h1>
          <p>
            {loading
              ? "Finding people who chose to share their location…"
              : `${users.length} people chose to share their location.`}
          </p>
        </div>
        <UiButton
          type="button"
          className="inline-flex items-center justify-center gap-2"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={16} /> Refresh map
        </UiButton>
      </div>
      <p className="m-0 text-[13px] text-matcha-muted">
        Pins appear only for people who opted in and meet mutual discovery
        preferences. Your pin is only shown to those same eligible people if you
        enable map sharing in your profile.
      </p>
      {error && (
        <div
          className="mb-6 flex justify-between rounded-lg bg-[var(--danger-bg)] p-[15px] text-[var(--danger-text)]"
          role="alert"
        >
          {error}
        </div>
      )}
      {users.length === 0 && !loading && !error && (
        <p className="map-empty [margin:0] [padding:12px_14px] [border-radius:10px] [background:var(--accent-soft)] [font-size:13px]">
          No one nearby has shared a map location yet. You can choose to share
          yours in your profile.
        </p>
      )}
      <div
        className="z-0 h-[min(64vh,620px)] min-h-[360px] w-full overflow-hidden rounded-[14px] border border-matcha-border bg-matcha-raised"
        id="user-map"
        ref={container}
        role="application"
        aria-label="Interactive map of people who chose to share their location"
      />
      <p className="m-0 text-[13px] text-matcha-muted">
        Drag to explore. Use the map controls to zoom. Select a pin to view a
        profile.
      </p>
      {users.length > 0 && (
        <ul
          className="m-0 grid list-none gap-2 p-0 max-[950px]:[grid-template-columns:repeat(2,_1fr)] max-[600px]:[gap:14px]"
          aria-label="People who shared their location"
        >
          {users.map((user) => (
            <li
              className="flex items-center justify-between gap-3 rounded-[10px] border border-matcha-border bg-matcha-surface px-3.5 py-[11px]"
              key={user.id}
            >
              <span>
                <strong>
                  {user.first_name}, {user.age}
                </strong>
                <small className="mt-1 block text-matcha-muted">
                  {user.city}
                </small>
              </span>
              <UiButton
                type="button"
                aria-label={`View ${user.first_name}'s profile`}
                onClick={() => void run(() => openProfile(user.id))}
              >
                View <ArrowUpRight size={15} />
              </UiButton>
            </li>
          ))}
        </ul>
      )}
      <UiButton
        className="map-profile-link [justify-self:start] [border:0] [padding:6px_0] [color:var(--accent)] [background:transparent] [font-size:13px] [&:hover]:[text-decoration:underline] [&:hover]:[background:transparent]"
        type="button"
        onClick={manageLocation}
      >
        Manage location sharing <ArrowUpRight size={15} />
      </UiButton>
    </section>
  );
}
