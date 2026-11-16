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
      fillColor: "#315f3e",
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
        fillColor: "#91a86d",
        fillOpacity: 0.95,
      });
      const popup = document.createElement("div");
      popup.className = "map-popup";
      if (user.photo_id) {
        const image = document.createElement("img");
        image.src = `/api/v1/photos/${user.photo_id}`;
        image.alt = `${user.first_name}’s profile photo`;
        popup.append(image);
      }
      const name = document.createElement("strong");
      name.textContent = `${user.first_name}, ${user.age}`;
      popup.append(name);
      const city = document.createElement("p");
      city.textContent = user.city;
      popup.append(city);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-popup-link";
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
      <section className="map-intro">
        <div className="eyebrow">
          <MapPin size={14} /> A LITTLE CLOSER
        </div>
        <h1>
          Your map needs <em>a location.</em>
        </h1>
        <p>Add a city or use GPS in your profile to see nearby people.</p>
      </section>
    );

  return (
    <section className="map-page" aria-labelledby="map-title">
      <div className="map-heading">
        <div>
          <div className="eyebrow">
            <MapPin size={14} /> YOUR LITTLE CORNER
          </div>
          <h1 id="map-title">
            Find people <em>nearby.</em>
          </h1>
          <p>
            {loading
              ? "Finding people who chose to share their location…"
              : `${users.length} people chose to share their location.`}
          </p>
        </div>
        <button
          type="button"
          className="map-refresh"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={16} /> Refresh map
        </button>
      </div>
      <p className="map-privacy">
        Pins appear only for people who opted in and meet mutual discovery
        preferences. Your pin is only shown to those same eligible people if you
        enable map sharing in your profile.
      </p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {users.length === 0 && !loading && !error && (
        <p className="map-empty">
          No one nearby has shared a map location yet. You can choose to share
          yours in your profile.
        </p>
      )}
      <div
        className="user-map"
        id="user-map"
        ref={container}
        role="application"
        aria-label="Interactive map of people who chose to share their location"
      />
      <p className="map-hint">
        Drag to explore. Use the map controls to zoom. Select a pin to view a
        profile.
      </p>
      {users.length > 0 && (
        <ul
          className="map-user-list"
          aria-label="People who shared their location"
        >
          {users.map((user) => (
            <li key={user.id}>
              <span>
                <strong>
                  {user.first_name}, {user.age}
                </strong>
                <small>{user.city}</small>
              </span>
              <button
                type="button"
                aria-label={`View ${user.first_name}'s profile`}
                onClick={() => void run(() => openProfile(user.id))}
              >
                View <ArrowUpRight size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="map-profile-link"
        type="button"
        onClick={manageLocation}
      >
        Manage location sharing <ArrowUpRight size={15} />
      </button>
    </section>
  );
}
