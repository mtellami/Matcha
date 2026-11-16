import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { io, type Socket } from "socket.io-client";

type MediaMode = "audio" | "video";
type CallRole = "caller" | "callee";
type CallState = {
  call_id: string;
  peer_id: number;
  peer_name: string;
  media: MediaMode;
  role: CallRole;
  phase: "incoming" | "calling" | "connecting" | "connected" | "failed";
};
type Ack = { ok: boolean; error?: string; call_id?: string };
type Signal = {
  call_id: string;
  reason?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

async function captureMedia(media: MediaMode) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Calls need a secure browser connection and microphone support.",
    );
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: media === "video",
  });
}

export type CallManagerHandle = {
  startCall: (
    peerId: number,
    peerName: string,
    media: MediaMode,
  ) => Promise<void>;
};

export const CallManager = forwardRef<CallManagerHandle>(
  function CallManager(_props, ref) {
    const [call, setCall] = useState<CallState | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [callError, setCallError] = useState("");
    const [muted, setMuted] = useState(false);
    const [cameraOff, setCameraOff] = useState(false);
    const socket = useRef<Socket | null>(null);
    const callRef = useRef<CallState | null>(null);
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteVideo = useRef<HTMLVideoElement>(null);
    const localVideo = useRef<HTMLVideoElement>(null);
    const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
    const pendingAccepted = useRef(new Set<string>());
    const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const starting = useRef(false);

    function updateCall(next: CallState | null) {
      callRef.current = next;
      setCall(next);
    }

    function stopMedia() {
      peerConnection.current?.close();
      peerConnection.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      pendingCandidates.current = [];
      pendingAccepted.current.clear();
      setMuted(false);
      setCameraOff(false);
      if (ringTimer.current) clearTimeout(ringTimer.current);
      ringTimer.current = null;
      updateCall(null);
    }

    function finishCall(message = "") {
      if (message) setCallError(message);
      stopMedia();
    }

    function request(event: string, payload: unknown): Promise<Ack> {
      return new Promise((resolve, reject) => {
        const activeSocket = socket.current;
        if (!activeSocket) {
          reject(
            new Error("Calling is not available. Reconnect and try again."),
          );
          return;
        }
        const timer = setTimeout(
          () =>
            reject(new Error("The call service did not respond. Try again.")),
          8000,
        );
        activeSocket.emit(event, payload, (reply: Ack) => {
          clearTimeout(timer);
          if (reply?.ok) resolve(reply);
          else
            reject(
              new Error(reply?.error || "The call could not be completed."),
            );
        });
      });
    }

    function createPeerConnection(callId: string, stream: MediaStream) {
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      connection.ontrack = (event) => {
        setRemoteStream(event.streams[0] || new MediaStream([event.track]));
      };
      connection.onicecandidate = (event) => {
        if (event.candidate)
          socket.current?.emit("call:ice", {
            call_id: callId,
            candidate: event.candidate.toJSON(),
          });
      };
      connection.onconnectionstatechange = () => {
        const active = callRef.current;
        if (!active || active.call_id !== callId) return;
        if (connection.connectionState === "connected")
          updateCall({ ...active, phase: "connected" });
        else if (connection.connectionState === "failed")
          updateCall({ ...active, phase: "failed" });
      };
      peerConnection.current = connection;
      return connection;
    }

    async function flushCandidates(connection: RTCPeerConnection) {
      for (const candidate of pendingCandidates.current.splice(0))
        await connection.addIceCandidate(candidate);
    }

    async function sendOffer(callId: string) {
      const connection = peerConnection.current;
      if (!connection) return;
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const description = connection.localDescription;
      if (!description) throw new Error("Could not create the call offer.");
      await request("call:offer", {
        call_id: callId,
        description: { type: description.type, sdp: description.sdp },
      });
    }

    async function acceptCall() {
      const current = callRef.current;
      if (!current || current.role !== "callee" || current.phase !== "incoming")
        return;
      setCallError("");
      try {
        const stream = await captureMedia(current.media);
        localStreamRef.current = stream;
        setLocalStream(stream);
        createPeerConnection(current.call_id, stream);
        updateCall({ ...current, phase: "connecting" });
        await request("call:accept", { call_id: current.call_id });
      } catch (error) {
        setCallError(
          error instanceof Error ? error.message : "Could not join the call.",
        );
        socket.current?.emit("call:decline", { call_id: current.call_id });
        stopMedia();
      }
    }

    async function declineCall() {
      const current = callRef.current;
      if (!current) return;
      try {
        await request("call:decline", { call_id: current.call_id });
      } catch {
        /* The call may already have ended. */
      }
      finishCall();
    }

    async function endCall() {
      const current = callRef.current;
      if (!current) return;
      socket.current?.emit("call:end", { call_id: current.call_id });
      finishCall();
    }

    useImperativeHandle(
      ref,
      () => ({
        async startCall(peerId, peerName, media) {
          if (callRef.current || starting.current)
            throw new Error("Finish the current call first.");
          setCallError("");
          starting.current = true;
          try {
            const stream = await captureMedia(media);
            localStreamRef.current = stream;
            setLocalStream(stream);
            const reply = await request("call:start", {
              target: peerId,
              media,
            });
            if (!reply.call_id)
              throw new Error("The call could not be started.");
            const outgoing: CallState = {
              call_id: reply.call_id,
              peer_id: peerId,
              peer_name: peerName,
              media,
              role: "caller",
              phase: "calling",
            };
            updateCall(outgoing);
            createPeerConnection(reply.call_id, stream);
            ringTimer.current = setTimeout(() => {
              if (callRef.current?.call_id === reply.call_id)
                endCall().finally(() =>
                  setCallError(`${peerName} did not answer.`),
                );
            }, 60_000);
            if (pendingAccepted.current.delete(reply.call_id)) {
              if (ringTimer.current) clearTimeout(ringTimer.current);
              ringTimer.current = null;
              updateCall({ ...outgoing, phase: "connecting" });
              await sendOffer(reply.call_id);
            }
          } catch (error) {
            stopMedia();
            throw error;
          } finally {
            starting.current = false;
          }
        },
      }),
      [],
    );

    useEffect(() => {
      const activeSocket = io({ autoConnect: false });
      socket.current = activeSocket;
      activeSocket.on(
        "call:incoming",
        (invite: {
          call_id: string;
          caller_id: number;
          caller_name: string;
          media: MediaMode;
        }) => {
          if (callRef.current || starting.current) {
            activeSocket.emit("call:decline", { call_id: invite.call_id });
            return;
          }
          setCallError("");
          updateCall({
            call_id: invite.call_id,
            peer_id: invite.caller_id,
            peer_name: invite.caller_name,
            media: invite.media,
            role: "callee",
            phase: "incoming",
          });
          ringTimer.current = setTimeout(() => {
            if (callRef.current?.call_id === invite.call_id)
              finishCall("The call invitation expired.");
          }, 60_000);
        },
      );
      activeSocket.on("call:accepted", (signal: Signal) => {
        const current = callRef.current;
        if (!current || current.call_id !== signal.call_id) {
          pendingAccepted.current.add(signal.call_id);
          return;
        }
        if (ringTimer.current) clearTimeout(ringTimer.current);
        ringTimer.current = null;
        updateCall({ ...current, phase: "connecting" });
        void sendOffer(signal.call_id).catch((error) => {
          finishCall(
            error instanceof Error ? error.message : "Call setup failed.",
          );
        });
      });
      activeSocket.on("call:offer", async (signal: Signal) => {
        const current = callRef.current,
          connection = peerConnection.current;
        if (
          !current ||
          current.call_id !== signal.call_id ||
          !signal.description ||
          !connection
        )
          return;
        try {
          await connection.setRemoteDescription(signal.description);
          await flushCandidates(connection);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          const description = connection.localDescription;
          if (!description)
            throw new Error("Could not create the call answer.");
          await request("call:answer", {
            call_id: signal.call_id,
            description: { type: description.type, sdp: description.sdp },
          });
        } catch (error) {
          finishCall(
            error instanceof Error ? error.message : "Call setup failed.",
          );
        }
      });
      activeSocket.on("call:answer", async (signal: Signal) => {
        const connection = peerConnection.current,
          current = callRef.current;
        if (
          !connection ||
          !current ||
          current.call_id !== signal.call_id ||
          current.role !== "caller" ||
          !signal.description
        )
          return;
        try {
          await connection.setRemoteDescription(signal.description);
          await flushCandidates(connection);
        } catch {
          finishCall("Could not connect the call. Try again.");
        }
      });
      activeSocket.on("call:ice", async (signal: Signal) => {
        if (!signal.candidate || callRef.current?.call_id !== signal.call_id)
          return;
        const connection = peerConnection.current;
        if (!connection?.remoteDescription) {
          pendingCandidates.current.push(signal.candidate);
          return;
        }
        try {
          await connection.addIceCandidate(signal.candidate);
        } catch {
          /* A stale ICE candidate can be ignored during reconnect. */
        }
      });
      const stop = (signal: Signal) => {
        if (callRef.current?.call_id === signal.call_id)
          finishCall(
            signal.reason === "connection_changed"
              ? "Your connection changed, so the call ended."
              : "",
          );
      };
      activeSocket.on("call:declined", (signal: Signal) => {
        if (callRef.current?.call_id === signal.call_id)
          finishCall("The call was declined.");
      });
      activeSocket.on("call:ended", stop);
      activeSocket.on("call:error", (payload: { error?: string }) =>
        setCallError(payload.error || "The call could not be completed."),
      );
      activeSocket.connect();
      return () => {
        const current = callRef.current;
        if (current)
          activeSocket.emit("call:end", { call_id: current.call_id });
        activeSocket.disconnect();
        socket.current = null;
        stopMedia();
      };
    }, []);

    useEffect(() => {
      if (localVideo.current) localVideo.current.srcObject = localStream;
    }, [localStream, call]);
    useEffect(() => {
      if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
    }, [remoteStream, call]);
    useEffect(() => {
      if (!call || call.role !== "caller" || call.phase === "calling") return;
      const timer = setInterval(() => {
        socket.current?.emit(
          "call:heartbeat",
          { call_id: call.call_id },
          (reply: Ack) => {
            if (!reply?.ok && callRef.current?.call_id === call.call_id)
              finishCall(reply?.error || "The call ended.");
          },
        );
      }, 5000);
      return () => clearInterval(timer);
    }, [call]);

    function toggleMicrophone() {
      const next = !muted;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      setMuted(next);
    }

    function toggleCamera() {
      const next = !cameraOff;
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = !next;
      });
      setCameraOff(next);
    }

    return (
      <>
        {callError && !call && (
          <div className="call-notice" role="status">
            {callError}
            <button
              type="button"
              aria-label="Dismiss call message"
              onClick={() => setCallError("")}
            >
              ×
            </button>
          </div>
        )}
        {call && (
          <section
            className="call-panel"
            role="dialog"
            aria-label={`${call.media} call with ${call.peer_name}`}
          >
            <div className="call-panel-heading">
              <div>
                <strong>{call.peer_name}</strong>
                <span>
                  {call.phase === "incoming"
                    ? `Incoming ${call.media} call`
                    : call.phase === "calling"
                      ? "Calling…"
                      : call.phase === "connected"
                        ? "Connected"
                        : call.phase === "failed"
                          ? "Connection failed"
                          : "Connecting…"}
                </span>
              </div>
              {call.media === "audio" && <Phone size={19} aria-hidden="true" />}
              {call.media === "video" && <Video size={19} aria-hidden="true" />}
            </div>
            <div className="call-media">
              {call.media === "audio" && (
                <div className="audio-call-avatar" aria-hidden="true">
                  {call.peer_name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                className={
                  call.media === "audio"
                    ? "call-remote audio-only"
                    : "call-remote"
                }
                aria-label={`${call.peer_name}'s video`}
              />
              {call.media === "video" && localStream && (
                <video
                  ref={localVideo}
                  autoPlay
                  muted
                  playsInline
                  className="call-local"
                  aria-label="Your video preview"
                />
              )}
            </div>
            {callError && (
              <p className="call-panel-error" role="alert">
                {callError}
              </p>
            )}
            {call.phase === "incoming" ? (
              <div className="call-actions">
                <button
                  type="button"
                  className="call-decline"
                  onClick={() => void declineCall()}
                >
                  <PhoneOff size={17} /> Decline
                </button>
                <button
                  type="button"
                  className="call-accept"
                  onClick={() => void acceptCall()}
                >
                  <Phone size={17} /> Answer
                </button>
              </div>
            ) : (
              <div className="call-actions">
                <button
                  type="button"
                  aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                  onClick={toggleMicrophone}
                >
                  {muted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                {call.media === "video" && (
                  <button
                    type="button"
                    aria-label={
                      cameraOff ? "Turn camera on" : "Turn camera off"
                    }
                    onClick={toggleCamera}
                  >
                    {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
                  </button>
                )}
                <button
                  type="button"
                  className="call-decline"
                  aria-label="End call"
                  onClick={() => void endCall()}
                >
                  <PhoneOff size={18} /> End call
                </button>
              </div>
            )}
          </section>
        )}
      </>
    );
  },
);
