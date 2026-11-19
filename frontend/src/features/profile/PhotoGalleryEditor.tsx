import { UiInput } from "../../shared/UiInput";
import { UiButton } from "../../shared/UiButton";
import { useEffect, useRef, useState } from "react";
import {
  Crop,
  ImagePlus,
  Plus,
  RotateCcw,
  RotateCw,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Modal, Switch } from "@heroui/react";
import { api } from "../../shared/api";
import type { Me, Runner } from "../../shared/types";

type Filter = "natural" | "warm" | "cool" | "vivid" | "soft" | "fade" | "mono";
type PendingPhoto = {
  id: string;
  file: File;
  preview: string;
  rotation: number;
  zoom: number;
  x: number;
  y: number;
  filter: Filter;
  isPrimary: boolean;
};

const filterStyles: Record<Filter, string> = {
  natural: "none",
  warm: "sepia(.18) saturate(1.15)",
  cool: "saturate(.92) hue-rotate(12deg)",
  vivid: "saturate(1.4) contrast(1.05)",
  soft: "saturate(.78) brightness(1.04)",
  fade: "saturate(.7) contrast(.85) brightness(1.06)",
  mono: "grayscale(1)",
};
const photoFilters: { id: Filter; label: string }[] = [
  { id: "natural", label: "Natural" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "vivid", label: "Vivid" },
  { id: "soft", label: "Soft" },
  { id: "fade", label: "Fade" },
  { id: "mono", label: "B&W" },
];

async function editPhoto(photo: PendingPhoto): Promise<File> {
  const image = await createImageBitmap(photo.file, {
    imageOrientation: "from-image",
  });
  const rotated = document.createElement("canvas");
  const sideways = photo.rotation % 180 !== 0;
  rotated.width = sideways ? image.height : image.width;
  rotated.height = sideways ? image.width : image.height;
  const rotateContext = rotated.getContext("2d");
  if (!rotateContext)
    throw new Error("Photo editing is unavailable in this browser.");
  rotateContext.translate(rotated.width / 2, rotated.height / 2);
  rotateContext.rotate((photo.rotation * Math.PI) / 180);
  rotateContext.drawImage(image, -image.width / 2, -image.height / 2);
  image.close();

  const side = Math.min(rotated.width, rotated.height) / photo.zoom;
  const sourceX = (rotated.width - side) * (photo.x / 100);
  const sourceY = (rotated.height - side) * (photo.y / 100);
  const output = document.createElement("canvas");
  output.width = 1200;
  output.height = 1200;
  const context = output.getContext("2d");
  if (!context)
    throw new Error("Photo editing is unavailable in this browser.");
  context.filter = filterStyles[photo.filter];
  context.drawImage(
    rotated,
    sourceX,
    sourceY,
    side,
    side,
    0,
    0,
    output.width,
    output.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    output.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Could not prepare this photo for upload.")),
      "image/jpeg",
      0.9,
    ),
  );
  const filename = photo.file.name.replace(/\.[^.]+$/, "") || "matcha-photo";
  return new File([blob], `${filename}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export function PhotoGalleryEditor({
  me,
  fieldErrors,
  run,
  saved,
  busy,
}: {
  me: Me;
  fieldErrors: Record<string, string>;
  run: Runner;
  saved: () => Promise<void>;
  busy: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cropFrame = useRef<HTMLDivElement>(null);
  const cropDrag = useRef<{
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const pendingRef = useRef<PendingPhoto[]>([]);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState("");
  const remaining = Math.max(0, 5 - me.photos.length);
  const activePhoto =
    pending.find((photo) => photo.id === activeEditId) ?? null;
  const activePhotoIndex = activePhoto
    ? pending.findIndex((photo) => photo.id === activePhoto.id)
    : -1;

  const photoKeys = [
    ...me.photos.map((photo) => `saved:${photo.id}`),
    ...pending.map((photo) => `pending:${photo.id}`),
  ];
  const selectedSlot = Math.max(0, photoKeys.indexOf(selectedPhoto ?? ""));
  const displaySlots = [
    selectedSlot,
    ...Array.from({ length: 5 }, (_, slot) => slot).filter(
      (slot) => slot !== selectedSlot,
    ),
  ];

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(
    () => () =>
      pendingRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)),
    [],
  );

  function addFiles(files: FileList | File[]) {
    setQueueError("");
    const selected = Array.from(files);
    const available = Math.max(0, remaining - pending.length);
    const accepted: PendingPhoto[] = [];
    for (const file of selected) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setQueueError(`${file.name} is not an image.`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setQueueError(`${file.name} is over the 8 MB limit.`);
        continue;
      }
      if (accepted.length >= available) {
        setQueueError("Your gallery can contain up to five photos.");
        break;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        rotation: 0,
        zoom: 1,
        x: 50,
        y: 50,
        filter: "natural",
        isPrimary:
          me.photos.length === 0 &&
          pending.length === 0 &&
          accepted.length === 0,
      });
    }
    if (accepted.length) {
      setPending((current) => [...current, ...accepted]);
      setActiveEditId(accepted[0].id);
    }
  }

  function updatePhoto(id: string, update: Partial<PendingPhoto>) {
    setPending((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, ...update } : photo,
      ),
    );
  }

  function removePending(photo: PendingPhoto) {
    URL.revokeObjectURL(photo.preview);
    setPending((current) => current.filter((item) => item.id !== photo.id));
    if (activeEditId === photo.id) setActiveEditId(null);
  }

  function advanceEditor() {
    const next = pending[activePhotoIndex + 1];
    setActiveEditId(next?.id ?? null);
  }

  async function uploadPending() {
    await run(async () => {
      for (const photo of [...pending]) {
        const form = new FormData();
        form.append("photo", await editPhoto(photo));
        const created = await api<{ id: number }>("/me/photos", "POST", form);
        if (photo.isPrimary) await api(`/me/photos/${created.id}`, "PUT");
        URL.revokeObjectURL(photo.preview);
        setPending((current) => current.filter((item) => item.id !== photo.id));
        await saved();
      }
    });
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-6 rounded-3xl border border-matcha-border bg-matcha-surface p-5 shadow-[0_16px_48px_var(--shadow)] sm:p-8"
      id="profile-photos"
      tabIndex={-1}
      aria-labelledby="photos-heading"
    >
      <div>
        <p className="mb-1 text-[10px] font-bold tracking-[2px] text-matcha-accent">
          PHOTOS
        </p>
        <h2
          id="photos-heading"
          className="m-0 text-2xl font-semibold tracking-tight"
        >
          Your photos
        </h2>
        <p className="mb-0 mt-2 max-w-2xl text-sm leading-relaxed text-matcha-muted">
          Add up to five. Tap a photo to preview it, or its star to make it your
          main photo.
        </p>
      </div>

      <div
        className={`grid min-w-0 grid-cols-4 gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))] sm:grid-rows-2 sm:gap-3 ${dragging ? "rounded-2xl ring-2 ring-matcha-accent ring-offset-4 ring-offset-matcha-surface" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const internalPhoto = event.dataTransfer.getData(
            "application/x-matcha-photo",
          );
          const slotElement = (
            event.target as HTMLElement
          ).closest<HTMLElement>("[data-photo-slot]");
          const targetSlot = slotElement
            ? Number(slotElement.dataset.photoSlot)
            : null;
          if (internalPhoto && targetSlot !== null) {
            const [kind, photoId] = internalPhoto.split(":", 2);
            if (kind === "saved") {
              const sourceIndex = me.photos.findIndex(
                (photo) => String(photo.id) === photoId,
              );
              const destinationIndex = Math.min(
                targetSlot,
                me.photos.length - 1,
              );
              if (
                sourceIndex >= 0 &&
                destinationIndex >= 0 &&
                sourceIndex !== destinationIndex
              ) {
                const photoIds = me.photos.map((photo) => photo.id);
                const [moving] = photoIds.splice(sourceIndex, 1);
                photoIds.splice(destinationIndex, 0, moving);
                void run(async () => {
                  await api("/me/photos/order", "PATCH", {
                    photo_ids: photoIds,
                  });
                  await saved();
                });
              }
            } else if (kind === "pending") {
              const sourceIndex = pending.findIndex(
                (photo) => photo.id === photoId,
              );
              const destinationIndex = Math.max(
                0,
                Math.min(targetSlot - me.photos.length, pending.length - 1),
              );
              if (sourceIndex >= 0 && sourceIndex !== destinationIndex) {
                setPending((current) => {
                  const next = [...current];
                  const [moving] = next.splice(sourceIndex, 1);
                  next.splice(destinationIndex, 0, moving);
                  return next;
                });
              }
            }
            return;
          }
          if (event.dataTransfer.types.includes("Files"))
            addFiles(event.dataTransfer.files);
        }}
      >
        {displaySlots.map((slot, displayIndex) => {
          const photo = me.photos[slot];
          const queued = pending[slot - me.photos.length];
          const isMain = displayIndex === 0;
          const isPrimary = queued
            ? queued.isPrimary
            : Boolean(photo?.is_primary) &&
              !pending.some((item) => item.isPrimary);
          return (
            <div
              key={photo?.id ?? queued?.id ?? `empty-photo-slot-${slot}`}
              data-photo-slot={slot}
              draggable={Boolean(photo || queued)}
              onDragStart={(event) => {
                const kind = photo ? "saved" : "pending";
                const id = photo ? String(photo.id) : queued?.id;
                if (!id) return;
                event.dataTransfer.setData(
                  "application/x-matcha-photo",
                  `${kind}:${id}`,
                );
                event.dataTransfer.effectAllowed = "move";
              }}
              className={`group relative min-w-0 overflow-hidden rounded-2xl border-2 ${isMain ? "col-span-4 aspect-[4/3] sm:col-span-1 sm:row-span-2 sm:aspect-auto sm:min-h-[300px]" : "aspect-square sm:aspect-auto sm:min-h-[120px]"} ${photo || queued ? "border-matcha-border bg-matcha-bg" : "border-dashed border-matcha-accent/35 bg-matcha-accent/[0.035]"}`}
            >
              {photo ? (
                <>
                  <img
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                    src={`/api/v1/photos/${photo.id}`}
                    alt={`Your photo ${slot + 1}`}
                  />
                </>
              ) : queued ? (
                <>
                  <img
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                    src={queued.preview}
                    alt={`Preview of ${queued.file.name}`}
                    style={{
                      filter: filterStyles[queued.filter],
                      objectPosition: `${queued.x}% ${queued.y}%`,
                      transform: `rotate(${queued.rotation}deg) scale(${queued.zoom})`,
                    }}
                  />
                </>
              ) : (
                <button
                  type="button"
                  aria-label={
                    isMain
                      ? "Choose your main profile photo"
                      : `Add photo ${slot + 1}`
                  }
                  disabled={busy || remaining <= pending.length}
                  onClick={() => input.current?.click()}
                  className={`group flex size-full min-w-0 flex-col items-center justify-center gap-3 p-2 text-center text-matcha-accent transition-colors hover:bg-matcha-accent/[0.08] focus-visible:outline-2 focus-visible:outline-matcha-accent disabled:cursor-not-allowed disabled:opacity-50 ${isMain ? "p-5" : ""}`}
                >
                  {isMain ? (
                    <>
                      <span className="grid size-14 place-items-center rounded-full bg-matcha-surface text-matcha-accent shadow-sm">
                        <ImagePlus size={25} />
                      </span>
                      <span className="text-base font-semibold text-matcha-text">
                        Drop your main photo here
                      </span>
                      <span className="rounded-xl bg-matcha-accent px-5 py-2.5 text-sm font-semibold text-white">
                        Choose photos
                      </span>
                    </>
                  ) : (
                    <Plus size={25} strokeWidth={1.8} aria-label="Add photo" />
                  )}
                </button>
              )}
              {(photo || queued) && (
                <>
                  <button
                    type="button"
                    aria-label={`Preview photo ${slot + 1}`}
                    aria-pressed={isMain}
                    onClick={() => setSelectedPhoto(photoKeys[slot])}
                    className={`absolute inset-0 rounded-xl ${isMain ? "" : "cursor-pointer"} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-matcha-accent`}
                  />
                  {isMain && (
                    <>
                      <button
                        type="button"
                        aria-label={`Make photo ${slot + 1} your main photo`}
                        aria-pressed={isPrimary}
                        disabled={busy || isPrimary}
                        onClick={() => {
                          if (queued) {
                            setPending((current) =>
                              current.map((item) => ({
                                ...item,
                                isPrimary: item.id === queued.id,
                              })),
                            );
                          } else if (photo) {
                            void run(async () => {
                              await api(`/me/photos/${photo.id}`, "PUT");
                              setPending((current) =>
                                current.map((item) => ({
                                  ...item,
                                  isPrimary: false,
                                })),
                              );
                              await saved();
                            });
                          }
                        }}
                        className="absolute left-0.5 top-0.5 grid size-6 cursor-pointer place-items-center rounded-full bg-matcha-surface/95 text-matcha-accent shadow-sm focus-visible:outline-2 focus-visible:outline-matcha-accent sm:left-2 sm:top-2 sm:size-9"
                      >
                        <Star
                          className="size-4 sm:size-5"
                          fill={isPrimary ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={
                          photo
                            ? `Delete photo ${slot + 1}`
                            : `Remove ${queued!.file.name} from upload`
                        }
                        disabled={busy}
                        onClick={() => {
                          if (queued) removePending(queued);
                          else if (photo)
                            void run(async () => {
                              await api(`/me/photos/${photo.id}`, "DELETE");
                              await saved();
                            });
                        }}
                        className="absolute right-0.5 top-0.5 grid size-6 cursor-pointer place-items-center rounded-full bg-matcha-surface/95 text-matcha-text shadow-sm hover:text-[var(--danger-text)] focus-visible:outline-2 focus-visible:outline-matcha-accent disabled:opacity-50 sm:right-2 sm:top-2 sm:size-9"
                      >
                        <Trash2 className="size-3.5 sm:size-4" />
                      </button>
                    </>
                  )}
                  {queued && isMain && (
                    <UiButton
                      type="button"
                      disabled={busy}
                      onClick={() => setActiveEditId(queued.id)}
                      className="absolute bottom-3 left-3 min-h-9 rounded-full bg-matcha-surface text-matcha-text"
                    >
                      <Crop size={14} /> Edit photo
                    </UiButton>
                  )}
                </>
              )}
            </div>
          );
        })}
        <UiInput
          ref={input}
          className="sr-only"
          name="photo"
          aria-label="Choose photos to upload"
          aria-invalid={Boolean(fieldErrors.photo)}
          aria-describedby={fieldErrors.photo ? "form-errors" : undefined}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy || remaining <= pending.length}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      <p className="m-0 text-sm leading-relaxed text-matcha-muted">
        JPEG, PNG or WebP, up to 8 MB each. You can crop, rotate and filter each
        photo before it uploads. Drag photos to reorder them, or drop files into
        the grid to add them.
      </p>
      {(queueError || fieldErrors.photo) && (
        <p className="m-0 text-sm text-red-500" role="alert">
          {queueError || fieldErrors.photo}
        </p>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-matcha-border bg-matcha-bg/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-matcha-muted">
            <strong className="text-matcha-text">
              {pending.length} photo{pending.length === 1 ? "" : "s"} ready.
            </strong>{" "}
            Select a photo to preview it, then choose Edit photo to adjust it.
          </p>
          <UiButton
            type="button"
            variant="primary"
            className="rounded-full !border-matcha-accent !bg-matcha-accent px-5 font-semibold !text-matcha-bg hover:!bg-matcha-accent/90"
            disabled={busy}
            onClick={() => void uploadPending()}
          >
            <Upload size={15} /> Save photos
          </UiButton>
        </div>
      )}

      <Modal
        isOpen={Boolean(activePhoto)}
        onOpenChange={(open) => {
          if (!open) setActiveEditId(null);
        }}
      >
        <Modal.Backdrop
          className="fixed inset-0 z-[1600] bg-black/50 backdrop-blur-sm"
          isDismissable
        >
          <Modal.Container
            placement="center"
            scroll="outside"
            size="lg"
            className="z-[1601] max-w-none p-3 sm:p-6"
          >
            {activePhoto && (
              <Modal.Dialog className="flex !max-w-none w-[min(1120px,calc(100vw-24px))] flex-col gap-0 rounded-[28px] border border-matcha-border bg-matcha-surface p-4 text-matcha-text shadow-2xl sm:p-6">
                <Modal.Header className="mb-3 flex w-full shrink-0 items-start justify-between gap-4 p-0 pr-14">
                  <div className="min-w-0">
                    <Modal.Heading className="m-0 text-2xl font-semibold tracking-tight sm:text-3xl">
                      Edit your photo
                    </Modal.Heading>
                    <p className="mb-0 mt-1 truncate text-sm text-matcha-muted">
                      {activePhoto.file.name} · Photo {activePhotoIndex + 1} of{" "}
                      {pending.length}
                    </p>
                  </div>
                  <UiButton
                    type="button"
                    aria-label="Close photo editor"
                    className="absolute right-5 top-5 z-10 size-10 min-h-10 shrink-0 rounded-full p-0 sm:right-8 sm:top-8"
                    onClick={() => setActiveEditId(null)}
                  >
                    <X size={19} />
                  </UiButton>
                </Modal.Header>

                <Modal.Body className="grid min-h-0 gap-4 overflow-visible p-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
                  <div className="min-w-0">
                    <div
                      ref={cropFrame}
                      className="relative mx-auto aspect-square w-full max-w-[min(52vh,520px)] touch-none select-none overflow-hidden rounded-2xl border border-matcha-border bg-matcha-raised cursor-grab active:cursor-grabbing"
                      onPointerDown={(event) => {
                        if (event.button !== 0 || !cropFrame.current) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        cropDrag.current = {
                          id: activePhoto.id,
                          x: activePhoto.x,
                          y: activePhoto.y,
                          startX: event.clientX,
                          startY: event.clientY,
                          width: event.currentTarget.clientWidth,
                          height: event.currentTarget.clientHeight,
                        };
                      }}
                      onPointerMove={(event) => {
                        const drag = cropDrag.current;
                        if (!drag || drag.id !== activePhoto.id) return;
                        const x = Math.max(
                          0,
                          Math.min(
                            100,
                            drag.x -
                              ((event.clientX - drag.startX) / drag.width) *
                                100,
                          ),
                        );
                        const y = Math.max(
                          0,
                          Math.min(
                            100,
                            drag.y -
                              ((event.clientY - drag.startY) / drag.height) *
                                100,
                          ),
                        );
                        updatePhoto(activePhoto.id, { x, y });
                      }}
                      onPointerUp={() => {
                        cropDrag.current = null;
                      }}
                      onPointerCancel={() => {
                        cropDrag.current = null;
                      }}
                    >
                      <img
                        draggable={false}
                        className="pointer-events-none absolute inset-0 size-full object-cover"
                        src={activePhoto.preview}
                        alt="Photo crop preview"
                        style={{
                          filter: filterStyles[activePhoto.filter],
                          objectPosition: `${activePhoto.x}% ${activePhoto.y}%`,
                          transform: `translate(${((50 - activePhoto.x) / 100) * (activePhoto.zoom - 1) * 100}%, ${((50 - activePhoto.y) / 100) * (activePhoto.zoom - 1) * 100}%) rotate(${activePhoto.rotation}deg) scale(${activePhoto.zoom})`,
                        }}
                      />
                      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_33.1%,rgba(255,255,255,.55)_33.3%,rgba(255,255,255,.55)_33.5%,transparent_33.7%,transparent_66.3%,rgba(255,255,255,.55)_66.5%,rgba(255,255,255,.55)_66.7%,transparent_66.9%),linear-gradient(to_bottom,transparent_33.1%,rgba(255,255,255,.55)_33.3%,rgba(255,255,255,.55)_33.5%,transparent_33.7%,transparent_66.3%,rgba(255,255,255,.55)_66.5%,rgba(255,255,255,.55)_66.7%,transparent_66.9%)]" />
                    </div>
                    <p className="mb-0 mt-3 text-center text-sm leading-relaxed text-matcha-muted">
                      Drag the photo to reposition it. This is how it will look
                      on your profile.
                    </p>
                  </div>

                  <div className="grid content-start gap-4">
                    <label className="grid gap-2 text-sm font-semibold text-matcha-text">
                      <span className="flex items-center justify-between">
                        <span>Zoom</span>
                        <span className="font-normal text-matcha-muted">
                          {Math.round(activePhoto.zoom * 100)}%
                        </span>
                      </span>
                      <UiInput
                        aria-label="Photo zoom"
                        type="range"
                        min="1"
                        max="2.5"
                        step="0.05"
                        value={activePhoto.zoom}
                        disabled={busy}
                        onChange={(event) =>
                          updatePhoto(activePhoto.id, {
                            zoom: Number(event.target.value),
                          })
                        }
                        className="!min-h-6 !border-0 !bg-transparent !px-0 !py-0 accent-matcha-accent"
                      />
                    </label>

                    <div className="grid gap-2">
                      <p className="m-0 text-sm font-semibold text-matcha-text">
                        Rotate
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <UiButton
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            updatePhoto(activePhoto.id, {
                              rotation: (activePhoto.rotation + 270) % 360,
                            })
                          }
                        >
                          <RotateCcw size={16} /> Left
                        </UiButton>
                        <UiButton
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            updatePhoto(activePhoto.id, {
                              rotation: (activePhoto.rotation + 90) % 360,
                            })
                          }
                        >
                          <RotateCw size={16} /> Right
                        </UiButton>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="m-0 text-sm font-semibold text-matcha-text">
                        Filter
                      </p>
                      <div className="flex w-full flex-nowrap items-start justify-between gap-0 overflow-visible">
                        {photoFilters.map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            aria-pressed={activePhoto.filter === filter.id}
                            onClick={() =>
                              updatePhoto(activePhoto.id, { filter: filter.id })
                            }
                            className={`group/filter flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl p-0 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-matcha-accent ${activePhoto.filter === filter.id ? "text-matcha-accent" : "text-matcha-muted hover:text-matcha-text"}`}
                          >
                            <span
                              className={`size-16 shrink-0 overflow-hidden rounded-xl border-2 ${activePhoto.filter === filter.id ? "border-matcha-accent" : "border-transparent"}`}
                            >
                              <img
                                draggable={false}
                                className="size-full object-cover"
                                src={activePhoto.preview}
                                alt=""
                                style={{ filter: filterStyles[filter.id] }}
                              />
                            </span>
                            <span>{filter.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <Switch
                      isSelected={activePhoto.isPrimary}
                      onChange={(isPrimary) =>
                        setPending((current) =>
                          current.map((photo) => ({
                            ...photo,
                            isPrimary: isPrimary
                              ? photo.id === activePhoto.id
                              : photo.id === activePhoto.id
                                ? false
                                : photo.isPrimary,
                          })),
                        )
                      }
                      className="group w-full"
                    >
                      <Switch.Content className="flex w-full flex-row-reverse justify-between gap-4 rounded-2xl border border-matcha-border bg-matcha-bg/50 p-3 text-left group-data-[selected=true]:border-matcha-accent/50 group-data-[selected=true]:bg-matcha-accent/5">
                        <Switch.Control className="!h-6 !w-12 !shrink-0 !rounded-full !bg-matcha-border group-data-[selected=true]:!bg-matcha-accent">
                          <Switch.Thumb className="!size-5 !rounded-full !bg-white !shadow-md" />
                        </Switch.Control>
                        <span className="flex-1">
                          <span className="block font-semibold text-matcha-text">
                            Use as main photo
                          </span>
                          <span className="mt-1 block text-xs font-normal text-matcha-muted">
                            The first photo people see.
                          </span>
                        </span>
                      </Switch.Content>
                    </Switch>
                  </div>
                </Modal.Body>

                <Modal.Footer className="mt-4 flex shrink-0 flex-col gap-3 border-t border-matcha-border p-0 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div
                    className="flex max-w-full items-center gap-2 overflow-x-auto pb-1"
                    aria-label="Photos in this upload"
                  >
                    {pending.map((photo, index) => (
                      <button
                        key={photo.id}
                        type="button"
                        aria-label={`Edit photo ${index + 1}: ${photo.file.name}`}
                        aria-current={
                          photo.id === activePhoto.id ? "true" : undefined
                        }
                        onClick={() => setActiveEditId(photo.id)}
                        className={`size-14 shrink-0 overflow-hidden rounded-xl border-2 transition-colors ${photo.id === activePhoto.id ? "border-matcha-accent" : "border-transparent opacity-70 hover:opacity-100"}`}
                      >
                        <img
                          draggable={false}
                          className="size-full object-cover"
                          src={photo.preview}
                          alt=""
                          style={{ filter: filterStyles[photo.filter] }}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="flex shrink-0 justify-end gap-3">
                    <UiButton
                      type="button"
                      disabled={busy}
                      onClick={() => setActiveEditId(null)}
                      className="rounded-full px-5"
                    >
                      Cancel
                    </UiButton>
                    <UiButton
                      type="button"
                      variant="primary"
                      disabled={busy}
                      onClick={advanceEditor}
                      className="rounded-full !border-matcha-accent !bg-matcha-accent px-5 font-semibold !text-white hover:!bg-matcha-accent/90"
                    >
                      {activePhotoIndex < pending.length - 1
                        ? "Add and next"
                        : "Done editing"}
                    </UiButton>
                  </div>
                </Modal.Footer>
              </Modal.Dialog>
            )}
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}
