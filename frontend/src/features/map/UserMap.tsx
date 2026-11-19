import { useEffect, useRef, useState } from "react";
import * as mapboxgl from "mapbox-gl/esm";
import type { GeoJSONSourceSpecification } from "mapbox-gl/esm";
import "mapbox-gl/dist/mapbox-gl.css";
import { api } from "../../shared/api";
import { useTheme } from "../../shared/theme";
import type { MapUser, Me, Runner } from "../../shared/types";

const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const unavailable = "The map is currently unavailable. Please try again later.";

type ClusterSource = {
  getClusterExpansionZoom: (
    clusterId: number,
    callback: (error: Error | null, zoom: number) => void,
  ) => unknown;
  getClusterLeaves: (
    clusterId: number,
    limit: number,
    offset: number,
    callback: (
      error: Error | null,
      leaves: Array<{ properties?: Record<string, unknown> }> | null,
    ) => void,
  ) => unknown;
};

function getClusterSource(
  source: mapboxgl.Source | undefined,
): ClusterSource | null {
  if (
    !source ||
    !("getClusterExpansionZoom" in source) ||
    !("getClusterLeaves" in source)
  )
    return null;
  return source as unknown as ClusterSource;
}

function mapAvatar(user: MapUser, size: string) {
  const avatar = document.createElement("span");
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  avatar.className = `relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-matcha-raised font-semibold text-matcha-accent ${size}`;
  avatar.setAttribute("role", "img");
  avatar.setAttribute("aria-label", `${fullName}'s avatar`);
  avatar.textContent = [user.first_name, user.last_name]
    .filter(Boolean)
    .map((name) => name[0])
    .join("")
    .toUpperCase();
  if (user.photo_id) {
    const image = document.createElement("img");
    image.src = `/api/v1/photos/${user.photo_id}`;
    image.alt = "";
    image.draggable = false;
    image.className = "absolute inset-0 size-full object-cover";
    image.addEventListener("error", () => image.remove(), { once: true });
    avatar.append(image);
  }
  return avatar;
}

export function UserMap({
  me,
  openProfile,
  run,
}: {
  me: Me;
  openProfile: (id: number) => Promise<void>;
  run: Runner;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { resolvedTheme } = useTheme();
  const style = `mapbox://styles/mapbox/${resolvedTheme === "dark" ? "dark" : "light"}-v11`;
  const latestStyle = useRef(style);
  latestStyle.current = style;
  const appliedStyle = useRef("");
  const [users, setUsers] = useState<MapUser[]>([]);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const hasLocation = me.latitude !== null && me.longitude !== null;

  useEffect(() => {
    const controller = new AbortController();
    api<{ users: MapUser[] }>("/map/users", "GET", undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setUsers(result.users);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Nearby people could not be loaded.",
          );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      !container.current ||
      me.latitude === null ||
      me.longitude === null ||
      !accessToken
    )
      return;
    setMapError("");
    let instance: mapboxgl.Map;
    try {
      instance = new mapboxgl.Map({
        container: container.current,
        accessToken,
        style: latestStyle.current,
        center: [me.longitude, me.latitude],
        zoom: 12,
      });
    } catch {
      setMapError(unavailable);
      return;
    }
    map.current = instance;
    appliedStyle.current = latestStyle.current;
    instance.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.on("style.load", () => setMapError(""));
    instance.on("error", () => setMapError(unavailable));
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, [me.latitude, me.longitude]);

  useEffect(() => {
    if (map.current && appliedStyle.current !== style) {
      appliedStyle.current = style;
      map.current.setStyle(style);
    }
  }, [style]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const canvas = instance.getCanvas();
    const markers: mapboxgl.Marker[] = [];
    const popups: mapboxgl.Popup[] = [];
    // Mapbox cluster IDs are only unique within a zoom level. Include the
    // current cluster zoom in cache keys so a zoom cycle cannot reuse a
    // different cluster's member list under a recycled ID.
    const clusterMembers = new Map<string, Set<number>>();
    const pendingClusters = new Set<string>();
    const sourceId = "nearby-people";
    const clusterLayerId = `${sourceId}-clusters`;
    const countLayerId = `${sourceId}-cluster-count`;
    for (const user of users) {
      const pin = document.createElement("button");
      pin.type = "button";
      // Keep avatars out of the map until its first cluster pass is complete.
      pin.hidden = true;
      pin.className =
        "grid size-11 cursor-pointer place-items-center rounded-full border-2 border-matcha-surface bg-matcha-surface p-0 shadow-lg ring-2 ring-matcha-accent/70 transition-shadow hover:ring-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-matcha-accent";
      const fullName = [user.first_name, user.last_name]
        .filter(Boolean)
        .join(" ");
      pin.setAttribute("aria-label", `Show ${fullName}'s location`);
      pin.append(mapAvatar(user, "size-full text-base"));
      const content = document.createElement("div");
      content.className = "grid w-52 min-w-0 gap-3 text-matcha-text";
      content.setAttribute("role", "group");
      content.setAttribute("aria-label", `${fullName} profile preview`);
      const summary = document.createElement("div");
      summary.className = "flex min-w-0 items-center gap-3";
      const avatarLink = document.createElement("a");
      avatarLink.href = `/profile/${user.id}`;
      avatarLink.setAttribute("aria-label", `View ${fullName}'s profile`);
      avatarLink.className =
        "shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent";
      avatarLink.append(mapAvatar(user, "size-14 text-lg"));
      summary.append(avatarLink);
      const details = document.createElement("div");
      details.className = "min-w-0 flex-1";
      const name = document.createElement("a");
      name.href = `/profile/${user.id}`;
      name.className =
        "block cursor-pointer break-words pr-2 text-sm font-semibold leading-snug text-matcha-text hover:text-matcha-accent focus-visible:outline-2 focus-visible:outline-matcha-accent";
      name.textContent = fullName;
      details.append(name);
      const genderLabels: Record<string, string> = {
        woman: "Woman",
        man: "Man",
        nonbinary: "Nonbinary",
      };
      const metadata = document.createElement("p");
      metadata.className = "mb-0 mt-1 text-xs text-matcha-muted";
      metadata.textContent = `${genderLabels[user.gender] ?? user.gender} · ${user.age}`;
      details.append(metadata);
      summary.append(details);
      content.append(summary);
      const popup = new mapboxgl.Popup({
        offset: 32,
        maxWidth: "260px",
        className: "map-profile-popup",
        focusAfterOpen: false,
      }).setDOMContent(content);
      popup.on("open", () =>
        popups.forEach((other) => {
          if (other !== popup) other.remove();
        }),
      );
      const visitProfile = (event: MouseEvent) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        popup.remove();
        void run(() => openProfile(user.id));
      };
      avatarLink.addEventListener("click", visitProfile);
      name.addEventListener("click", visitProfile);
      markers.push(
        new mapboxgl.Marker({ element: pin })
          .setLngLat([user.longitude, user.latitude])
          .setPopup(popup)
          .addTo(instance),
      );
      popups.push(popup);
    }

    const sourceData = {
      type: "FeatureCollection",
      features: users.map((user) => ({
        type: "Feature",
        properties: { userId: user.id },
        geometry: {
          type: "Point",
          coordinates: [user.longitude, user.latitude],
        },
      })),
    };
    let cancelled = false;
    let initialClusterPassComplete = false;
    const refreshClusters = () => {
      const source = getClusterSource(instance.getSource(sourceId));
      if (
        !source ||
        !instance.getLayer(clusterLayerId) ||
        !initialClusterPassComplete ||
        !instance.isSourceLoaded(sourceId)
      )
        return;

      // Only clusters painted in the current viewport should suppress DOM
      // avatar markers. querySourceFeatures also returns buffered/offscreen
      // source tiles, which can include stale cluster features at the current
      // zoom and leave individual markers visible on top of the cluster.
      const features = instance.queryRenderedFeatures({
        layers: [clusterLayerId],
      });
      const visibleClusterIds = new Set<string>();
      for (const feature of features) {
        const properties = feature.toJSON().properties as Record<
          string,
          unknown
        > | null;
        if (!properties?.cluster || typeof properties.cluster_id !== "number")
          continue;
        const clusterId = properties.cluster_id;
        const clusterKey = `${Math.floor(instance.getZoom())}:${clusterId}`;
        visibleClusterIds.add(clusterKey);
        if (
          !clusterMembers.has(clusterKey) &&
          !pendingClusters.has(clusterKey)
        ) {
          pendingClusters.add(clusterKey);
          source.getClusterLeaves(
            clusterId,
            Number(properties.point_count) || users.length,
            0,
            (error, leaves) => {
              pendingClusters.delete(clusterKey);
              if (error || !leaves || cancelled) return;
              clusterMembers.set(
                clusterKey,
                new Set(
                  leaves
                    .map(
                      (leaf) =>
                        (
                          leaf as unknown as {
                            properties?: Record<string, unknown>;
                          }
                        ).properties?.userId,
                    )
                    .filter((id): id is number => typeof id === "number"),
                ),
              );
              refreshClusters();
            },
          );
        }
      }

      // Apply a zoom's visibility in one pass. Otherwise the first leaf
      // callback can expose markers while sibling clusters are still loading.
      if ([...visibleClusterIds].some((id) => !clusterMembers.has(id))) return;

      const clusteredUserIds = new Set<number>();
      for (const clusterKey of visibleClusterIds) {
        clusterMembers
          .get(clusterKey)
          ?.forEach((id) => clusteredUserIds.add(id));
      }
      markers.forEach((marker, index) => {
        const element = marker.getElement();
        const clustered = clusteredUserIds.has(users[index].id);
        element.hidden = clustered;
        element.style.display = clustered ? "none" : "";
      });
    };
    const onClusterClick = (event: mapboxgl.MapMouseEvent) => {
      if (!instance.getLayer(clusterLayerId)) return;
      const feature = instance.queryRenderedFeatures(event.point, {
        layers: [clusterLayerId],
      })[0];
      if (!feature) return;
      const clusterFeature = feature.toJSON() as unknown as {
        properties?: Record<string, unknown>;
        geometry?: { coordinates?: [number, number] };
      };
      const clusterId = clusterFeature.properties?.cluster_id;
      const coordinates = clusterFeature.geometry?.coordinates;
      const source = getClusterSource(instance.getSource(sourceId));
      if (typeof clusterId !== "number" || !coordinates || !source) return;
      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error || typeof zoom !== "number" || cancelled) return;
        instance.easeTo({ center: coordinates, zoom, duration: 450 });
      });
    };
    const updateClusterCursor = (event: mapboxgl.MapMouseEvent) => {
      if (!instance.getLayer(clusterLayerId)) return;
      const cluster = instance.queryRenderedFeatures(event.point, {
        layers: [clusterLayerId],
      });
      canvas.style.cursor = cluster.length ? "pointer" : "";
    };

    const installClusterSource = () => {
      if (cancelled) return;
      if (instance.getSource(sourceId)) return;
      if (!instance.isStyleLoaded()) return;
      instance.addSource(sourceId, {
        type: "geojson",
        data: sourceData as GeoJSONSourceSpecification["data"],
        cluster: true,
        clusterRadius: 60,
        clusterMaxZoom: 15,
      });
      instance.addLayer({
        id: clusterLayerId,
        type: "circle",
        source: sourceId,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#883578",
          "circle-radius": ["step", ["get", "point_count"], 19, 10, 23, 30, 28],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: countLayerId,
        type: "symbol",
        source: sourceId,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });
    };
    const onIdle = () => {
      installClusterSource();
      if (instance.isSourceLoaded(sourceId)) {
        initialClusterPassComplete = true;
        refreshClusters();
      }
    };
    // The user request can resolve while Mapbox is still loading its base
    // style. React then replaces this effect and can miss the one-time
    // `style.load` event, leaving avatar markers unclustered. Retry on style
    // readiness and idle until the source has been installed.
    instance.on("style.load", installClusterSource);
    instance.on("styledata", installClusterSource);
    instance.on("idle", onIdle);
    if (instance.isStyleLoaded()) installClusterSource();
    instance.on("render", refreshClusters);
    instance.on("moveend", refreshClusters);
    instance.on("zoomend", refreshClusters);
    instance.on("click", onClusterClick);
    instance.on("mousemove", updateClusterCursor);
    // Loading people must not move the camera away from the saved profile area.
    return () => {
      cancelled = true;
      if (map.current === instance) {
        instance.off("style.load", installClusterSource);
        instance.off("styledata", installClusterSource);
        instance.off("idle", onIdle);
        instance.off("render", refreshClusters);
        instance.off("moveend", refreshClusters);
        instance.off("zoomend", refreshClusters);
        instance.off("click", onClusterClick);
        instance.off("mousemove", updateClusterCursor);
        canvas.style.cursor = "";
        if (instance.getLayer(countLayerId)) instance.removeLayer(countLayerId);
        if (instance.getLayer(clusterLayerId))
          instance.removeLayer(clusterLayerId);
        if (instance.getSource(sourceId)) instance.removeSource(sourceId);
      }
      markers.forEach((marker) => marker.remove());
      popups.forEach((popup) => popup.remove());
    };
  }, [users, me.latitude, me.longitude, openProfile, run, style]);

  if (!hasLocation)
    return (
      <section className="grid min-w-0 gap-3">
        <h1 className="my-5 text-[clamp(2.5rem,5vw,4rem)] font-medium leading-tight tracking-[-2px]">
          Your map needs <em>a location.</em>
        </h1>
        <p>Add a city or use GPS in your profile to see nearby people.</p>
      </section>
    );

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      aria-labelledby="map-title"
    >
      <header className="shrink-0">
        <h1
          className="m-0 text-[clamp(1.5rem,3vw,2.25rem)] font-medium leading-tight tracking-tight"
          id="map-title"
        >
          Find people <em>nearby.</em>
        </h1>
      </header>
      {(error || mapError || !accessToken) && (
        <p
          role="alert"
          className="m-0 rounded-xl bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger-text)]"
        >
          {error || mapError || unavailable}
        </p>
      )}
      <div
        className="user-map relative isolate z-0 min-h-0 min-w-0 w-full flex-1 overflow-hidden rounded-2xl border border-matcha-border bg-matcha-raised"
        id="user-map"
        ref={container}
        role="region"
        aria-label="Interactive map of nearby people"
      />
    </section>
  );
}
