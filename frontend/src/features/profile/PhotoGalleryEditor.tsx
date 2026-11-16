import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../../shared/api";
import type { Me, Runner } from "../../shared/types";

type Filter = "natural" | "warm" | "mono" | "bright";
type PendingPhoto = {
  id: string;
  file: File;
  preview: string;
  rotation: number;
  zoom: number;
  x: number;
  y: number;
  filter: Filter;
};

const filterStyles: Record<Filter, string> = {
  natural: "none",
  warm: "sepia(.18) saturate(1.15)",
  mono: "grayscale(1)",
  bright: "brightness(1.08) saturate(1.18)",
};

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
  const pendingRef = useRef<PendingPhoto[]>([]);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [dragging, setDragging] = useState(false);
  const [queueError, setQueueError] = useState("");
  const remaining = Math.max(0, 5 - me.photos.length);

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
      });
    }
    setPending((current) => [...current, ...accepted]);
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
  }

  async function uploadPending() {
    await run(async () => {
      for (const photo of [...pending]) {
        const form = new FormData();
        form.append("photo", await editPhoto(photo));
        await api("/me/photos", "POST", form);
        URL.revokeObjectURL(photo.preview);
        setPending((current) => current.filter((item) => item.id !== photo.id));
        await saved();
      }
    });
  }

  return (
    <section
      className="panel profile-form"
      id="profile-photos"
      tabIndex={-1}
      aria-labelledby="photos-heading"
    >
      <h2 id="photos-heading">Your photos</h2>
      <p>Up to five photos. Choose the picture people see first.</p>
      <div className="photo-row">
        {me.photos.map((photo, index) => (
          <div className="photo-item" key={photo.id}>
            <img
              src={`/api/v1/photos/${photo.id}`}
              alt={`Your photo ${index + 1}`}
            />
            {photo.is_primary ? (
              <span>Profile picture</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                aria-label={`Make photo ${index + 1} your profile picture`}
                onClick={() =>
                  void run(async () => {
                    await api(`/me/photos/${photo.id}`, "PUT");
                    await saved();
                  })
                }
              >
                Make primary
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove photo ${index + 1}`}
              onClick={() =>
                void run(async () => {
                  await api(`/me/photos/${photo.id}`, "DELETE");
                  await saved();
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <p>Adjust the square crop, rotation, and filter before uploading.</p>
      <div
        className={`photo-dropzone${dragging ? " is-dragging" : ""}`}
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
          addFiles(event.dataTransfer.files);
        }}
      >
        <strong>Drop photos here</strong>
        <span>JPEG, PNG, or WebP · up to 8 MB each</span>
        <button
          type="button"
          disabled={busy || remaining <= pending.length}
          onClick={() => input.current?.click()}
        >
          Choose photos
        </button>
        <input
          ref={input}
          className="visually-hidden"
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
      {(queueError || fieldErrors.photo) && (
        <p className="photo-queue-error" role="alert">
          {queueError || fieldErrors.photo}
        </p>
      )}

      {pending.length > 0 && (
        <div className="photo-edit-queue" aria-label="Photos waiting to upload">
          {pending.map((photo, index) => {
            const previewStyle: CSSProperties = {
              filter: filterStyles[photo.filter],
              objectPosition: `${photo.x}% ${photo.y}%`,
              transform: `rotate(${photo.rotation}deg) scale(${photo.zoom})`,
            };
            return (
              <article className="photo-edit-card" key={photo.id}>
                <div className="photo-edit-preview">
                  <img
                    src={photo.preview}
                    alt={`Preview of ${photo.file.name}`}
                    style={previewStyle}
                  />
                </div>
                <div className="photo-edit-controls">
                  <strong>{photo.file.name}</strong>
                  <label>
                    Crop zoom
                    <input
                      aria-label={`Crop zoom for photo ${index + 1}`}
                      type="range"
                      min="1"
                      max="2.5"
                      step="0.05"
                      value={photo.zoom}
                      disabled={busy}
                      onChange={(event) =>
                        updatePhoto(photo.id, {
                          zoom: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Crop position left to right
                    <input
                      aria-label={`Crop horizontal position for photo ${index + 1}`}
                      type="range"
                      min="0"
                      max="100"
                      value={photo.x}
                      disabled={busy}
                      onChange={(event) =>
                        updatePhoto(photo.id, { x: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Crop position top to bottom
                    <input
                      aria-label={`Crop vertical position for photo ${index + 1}`}
                      type="range"
                      min="0"
                      max="100"
                      value={photo.y}
                      disabled={busy}
                      onChange={(event) =>
                        updatePhoto(photo.id, { y: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Filter
                    <select
                      aria-label={`Filter for photo ${index + 1}`}
                      value={photo.filter}
                      disabled={busy}
                      onChange={(event) =>
                        updatePhoto(photo.id, {
                          filter: event.target.value as Filter,
                        })
                      }
                    >
                      <option value="natural">Natural</option>
                      <option value="warm">Warm</option>
                      <option value="mono">Black and white</option>
                      <option value="bright">Bright</option>
                    </select>
                  </label>
                  <div className="photo-edit-actions">
                    <button
                      type="button"
                      aria-label={`Rotate photo ${index + 1} left`}
                      disabled={busy}
                      onClick={() =>
                        updatePhoto(photo.id, {
                          rotation: (photo.rotation + 270) % 360,
                        })
                      }
                    >
                      Rotate left
                    </button>
                    <button
                      type="button"
                      aria-label={`Rotate photo ${index + 1} right`}
                      disabled={busy}
                      onClick={() =>
                        updatePhoto(photo.id, {
                          rotation: (photo.rotation + 90) % 360,
                        })
                      }
                    >
                      Rotate right
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removePending(photo)}
                    >
                      Remove from upload
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void uploadPending()}
          >
            Upload {pending.length} {pending.length === 1 ? "photo" : "photos"}
          </button>
        </div>
      )}
    </section>
  );
}
