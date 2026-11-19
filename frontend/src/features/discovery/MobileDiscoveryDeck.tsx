import { useEffect, useRef, useState } from "react";
import { Modal } from "@heroui/react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Leaf,
  MapPin,
  RotateCcw,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import type { Me, Profile, Runner } from "../../shared/types";
import { UiButton } from "../../shared/UiButton";

type Decision = { person: Profile; action: "pass" | "like" };
type Props = {
  profiles: Profile[];
  viewer: Me;
  run: Runner;
  openProfile: (id: number) => Promise<void>;
  openMessage: (id: number) => void;
  onDismiss: (id: number) => void;
  onRestore: (id: number) => void;
  onRestart: () => void;
  onLikeChanged: (id: number, liked: boolean) => void;
};

function Portrait({ photoId, name }: { photoId?: number; name: string }) {
  return photoId ? (
    <img
      src={`/api/v1/photos/${photoId}`}
      alt={`${name}’s profile photo`}
      className="size-full object-cover"
      draggable={false}
    />
  ) : (
    <span className="grid size-full place-items-center bg-gradient-to-br from-[var(--avatar-bg)] to-[var(--avatar-muted)] font-[family-name:var(--font-editorial)] text-6xl text-matcha-accent">
      {name[0]}
    </span>
  );
}

export function MobileDiscoveryDeck({
  profiles,
  viewer,
  run,
  openProfile,
  openMessage,
  onDismiss,
  onRestore,
  onRestart,
  onLikeChanged,
}: Props) {
  const person = profiles[0];
  const next = profiles[1];
  const [photoIndex, setPhotoIndex] = useState(0);
  const [history, setHistory] = useState<Decision[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const draggedRef = useRef(false);
  const [match, setMatch] = useState<Profile | null>(null);
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-250, 0, 250], [-14, 0, 14]);
  const passOpacity = useTransform(x, [-90, -25, 0], [1, 0, 0]);
  const likeOpacity = useTransform(x, [0, 25, 90], [0, 0, 1]);
  const photos = person
    ? [
        ...new Set(
          [
            person.photo_id,
            ...(person.photos ?? []).map((photo) => photo.id),
          ].filter((id): id is number => id != null),
        ),
      ]
    : [];

  useEffect(() => {
    setPhotoIndex(0);
    x.set(0);
  }, [person?.id, x]);

  async function decide(action: Decision["action"]) {
    if (!person || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let completed = false;
    await run(async () => {
      let connected = false;
      if (action === "like" && !person.liked) {
        const response = await api<{ connected: boolean }>(
          `/profiles/${person.id}/like`,
          "POST",
        );
        onLikeChanged(person.id, true);
        connected = response.connected === true;
      }
      await animate(
        x,
        (action === "like" ? 1 : -1) * (window.innerWidth + 80),
        { duration: reducedMotion ? 0 : 0.24, ease: "easeOut" },
      ).finished;
      setHistory((current) => [...current, { person, action }]);
      onDismiss(person.id);
      completed = true;
      if (connected) setMatch(person);
    });
    if (!completed)
      await animate(x, 0, { duration: reducedMotion ? 0 : 0.2 }).finished;
    busyRef.current = false;
    setBusy(false);
  }

  async function undo() {
    const previous = history.at(-1);
    if (!previous || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    await run(async () => {
      if (previous.action === "like" && !previous.person.liked) {
        await api(`/profiles/${previous.person.id}/like`, "DELETE");
        onLikeChanged(previous.person.id, false);
      }
      onRestore(previous.person.id);
      setHistory((current) => current.slice(0, -1));
    });
    busyRef.current = false;
    setBusy(false);
  }

  return (
    <div
      className="-mx-5 overflow-x-clip px-5 pb-2 sm:hidden"
      aria-label="Swipe through people"
    >
      {person ? (
        <>
          <div className="relative isolate mx-auto mb-7 w-full max-w-[430px]">
            {next && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 translate-y-3 scale-[0.96] overflow-hidden rounded-[28px] bg-matcha-raised shadow-md"
              >
                <Portrait photoId={next.photo_id} name={next.first_name} />
                <span className="absolute inset-0 bg-black/20" />
              </div>
            )}
            <motion.article
              key={person.id}
              aria-label={`${person.first_name}'s profile`}
              aria-describedby="swipe-instructions"
              tabIndex={0}
              className="relative aspect-[3/4] w-full rounded-[28px] bg-matcha-raised shadow-[0_14px_32px_var(--shadow)] outline-offset-4 focus-visible:outline-2 focus-visible:outline-matcha-accent"
              style={{
                x,
                rotate: reducedMotion ? 0 : rotate,
                touchAction: "pan-y",
              }}
              drag={busy ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={1}
              dragMomentum={false}
              onPointerDownCapture={() => {
                draggedRef.current = false;
              }}
              onDragStart={() => {
                draggedRef.current = true;
              }}
              onDragEnd={(_, info) => {
                if (
                  Math.abs(info.offset.x) > 85 ||
                  (Math.abs(info.offset.x) > 35 &&
                    Math.abs(info.velocity.x) > 500)
                )
                  void decide(info.offset.x > 0 ? "like" : "pass");
                else
                  void animate(x, 0, {
                    type: "spring",
                    stiffness: 450,
                    damping: 35,
                  });
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  void decide(event.key === "ArrowRight" ? "like" : "pass");
                }
              }}
            >
              <div className="absolute inset-0 overflow-hidden rounded-[28px]">
                <Portrait
                  photoId={photos[photoIndex]}
                  name={person.first_name}
                />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#241522]/95 via-transparent to-transparent" />
              </div>
              <button
                type="button"
                aria-label={`View ${person.first_name}'s profile`}
                disabled={busy}
                onClick={(event) => {
                  if (event.detail === 0 || !draggedRef.current)
                    void run(() => openProfile(person.id));
                }}
                className="absolute inset-0 size-full cursor-pointer rounded-[28px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-matcha-accent"
              />
              {photos.length > 1 && (
                <>
                  <div
                    className="pointer-events-none absolute inset-x-4 top-3 flex gap-1.5"
                    aria-hidden="true"
                  >
                    {photos.map((id, index) => (
                      <span
                        key={id}
                        className={`h-1 flex-1 rounded-full ${index === photoIndex ? "bg-white" : "bg-white/40"}`}
                      />
                    ))}
                  </div>
                  <div
                    onPointerDown={(event) => event.stopPropagation()}
                    className="pointer-events-none absolute inset-x-3 top-1/3 flex justify-between"
                  >
                    <button
                      type="button"
                      aria-label={`Previous photo of ${person.first_name}`}
                      disabled={photoIndex === 0}
                      onClick={() => setPhotoIndex((value) => value - 1)}
                      className="pointer-events-auto grid size-9 place-items-center rounded-full bg-black/20 text-white disabled:invisible"
                    >
                      <ChevronLeft aria-hidden="true" size={20} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Next photo of ${person.first_name}`}
                      disabled={photoIndex === photos.length - 1}
                      onClick={() => setPhotoIndex((value) => value + 1)}
                      className="pointer-events-auto grid size-9 place-items-center rounded-full bg-black/20 text-white disabled:invisible"
                    >
                      <ChevronRight aria-hidden="true" size={20} />
                    </button>
                  </div>
                  <span className="sr-only" role="status">
                    Photo {photoIndex + 1} of {photos.length}
                  </span>
                </>
              )}
              {person.online && (
                <span
                  className={`pointer-events-none absolute left-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-emerald-700 ${photos.length > 1 ? "top-7" : "top-4"}`}
                >
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Online
                </span>
              )}
              <motion.span
                aria-hidden="true"
                style={{ opacity: passOpacity }}
                className="pointer-events-none absolute left-6 top-20 -rotate-12 rounded-xl border-4 border-[#594556] bg-white/95 px-4 py-2 text-2xl font-extrabold tracking-wider text-[#594556]"
              >
                NOT NOW
              </motion.span>
              <motion.span
                aria-hidden="true"
                style={{ opacity: likeOpacity }}
                className="pointer-events-none absolute right-5 top-20 rotate-12 rounded-xl border-4 border-[#883578] bg-white/95 px-4 py-2 text-2xl font-extrabold tracking-wider text-[#883578]"
              >
                INTERESTED
              </motion.span>
              <div className="pointer-events-none absolute bottom-5 left-5 right-5 text-white">
                <h2 className="m-0 flex flex-wrap items-baseline gap-x-2 text-[28px] font-semibold tracking-tight">
                  {person.first_name}
                  {person.age != null && (
                    <span className="text-2xl font-normal">{person.age}</span>
                  )}
                </h2>
                {(person.distance != null || person.city) && (
                  <p className="mb-0 mt-1 flex items-center gap-1.5 text-sm !text-white/90">
                    <MapPin aria-hidden="true" size={15} />
                    {person.distance != null
                      ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(person.distance)} km away`
                      : person.city}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {person.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/25 px-3 py-1.5 text-xs font-semibold"
                    >
                      #{tag}
                    </span>
                  ))}
                  {person.tags.length > 2 && (
                    <span className="rounded-full bg-white/25 px-3 py-1.5 text-xs">
                      +{person.tags.length - 2}
                    </span>
                  )}
                </div>
              </div>
            </motion.article>
          </div>
        </>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-[28px] border border-matcha-border bg-matcha-surface px-6 py-10 text-center">
          <Leaf aria-hidden="true" className="text-matcha-accent" size={32} />
          <h2 className="mb-0 mt-4 text-xl font-semibold">
            You’ve seen everyone on this page
          </h2>
          <p className="mb-0 mt-2 text-sm">
            Undo your last choice or revisit these suggestions.
          </p>
          <UiButton
            onClick={() => {
              onRestart();
              setHistory([]);
            }}
            className="mt-4"
          >
            Show suggestions again
          </UiButton>
        </div>
      )}
      <div
        className="mt-6 flex items-center justify-center gap-5"
        aria-label="Profile actions"
      >
        <button
          type="button"
          onClick={() => void undo()}
          disabled={busy || history.length === 0}
          aria-label="Undo last choice"
          className="grid size-12 place-items-center rounded-full border border-matcha-border bg-matcha-surface text-matcha-muted shadow-sm disabled:opacity-40"
        >
          <RotateCcw aria-hidden="true" size={22} />
        </button>
        <button
          type="button"
          onClick={() => void decide("pass")}
          disabled={busy || !person}
          aria-label={person ? `Pass on ${person.first_name}` : "Pass"}
          className="grid size-16 place-items-center rounded-full border border-matcha-border bg-matcha-surface text-matcha-muted shadow-sm disabled:opacity-40"
        >
          <X aria-hidden="true" size={30} />
        </button>
        <button
          type="button"
          onClick={() => void decide("like")}
          disabled={busy || !person}
          aria-label={person ? `Like ${person.first_name}` : "Like"}
          className="grid size-[70px] place-items-center rounded-full bg-matcha-accent text-[var(--accent-foreground)] shadow-[0_8px_24px_var(--shadow)] disabled:opacity-40"
        >
          <Heart
            aria-hidden="true"
            size={29}
            fill={person?.liked ? "currentColor" : "none"}
          />
        </button>
      </div>
      <p
        id="swipe-instructions"
        className="mb-0 mt-4 text-center text-xs text-matcha-muted"
      >
        Swipe left to pass, right to show interest.
      </p>
      <Modal
        isOpen={Boolean(match)}
        onOpenChange={(open) => {
          if (!open) setMatch(null);
        }}
      >
        <Modal.Backdrop
          isDismissable
          className="fixed inset-0 z-[1650] !w-screen bg-[#241522]/85 backdrop-blur-sm"
        >
          <Modal.Container placement="center" className="z-[1651] !p-5">
            <Modal.Dialog className="w-full !max-w-[430px] !border-0 !bg-transparent !p-0 text-center !text-white !shadow-none">
              <div className="relative mx-auto mb-6 flex w-fit items-center">
                <div className="size-28 overflow-hidden rounded-full border-4 border-white">
                  <Portrait
                    photoId={
                      viewer.photos.find((photo) => photo.is_primary)?.id
                    }
                    name={viewer.first_name}
                  />
                </div>
                <div className="-ml-5 size-28 overflow-hidden rounded-full border-4 border-white">
                  <Portrait
                    photoId={match?.photo_id}
                    name={match?.first_name || "Connection"}
                  />
                </div>
                <span className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-white bg-[#883578] text-white">
                  <Heart aria-hidden="true" size={25} />
                </span>
              </div>
              <Modal.Heading className="m-0 !text-4xl font-semibold !text-white">
                You both
                <br />
                <em className="font-[family-name:var(--font-editorial)] font-normal text-[#f4a9e8]">
                  showed interest.
                </em>
              </Modal.Heading>
              <p className="my-5 text-base !text-white/90">
                You and {match?.first_name} are now connected.
                <br />
                Say hello while the spark is fresh.
              </p>
              <UiButton
                onClick={() => {
                  if (match) {
                    openMessage(match.id);
                    setMatch(null);
                  }
                }}
                className="min-h-12 w-full !border-[#883578] !bg-[#883578] font-semibold !text-white"
              >
                Say hello
              </UiButton>
              <UiButton
                onClick={() => setMatch(null)}
                className="mt-3 min-h-12 w-full !border-white/50 !bg-transparent !text-white"
              >
                Keep discovering
              </UiButton>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
