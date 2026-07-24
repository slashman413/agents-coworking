#!/usr/bin/env bash
# cowork video pipeline — turns a cowork task into a short vertical video via the
# ComfyUI LTX-Video pipeline (shorts.py).
#
# HARD RULE: LTX-Video ONLY. LTX is a DiT model that is GB10-safe and runs fine
# with the 35B vLLM up. NEVER use Wan / Hunyuan / SVD here — they hard-hang the
# box and trip the hardware watchdog into a reboot/poweroff (confirmed in tests).
# This script therefore never calls `creative-mode heavy` and never touches vLLM.
#
# Invoked by the cowork dispatcher for role "video". The task arrives via env:
#   COWORK_TASK_ID, COWORK_TASK_TITLE, COWORK_TASK_DESCRIPTION
# Final .mp4 is copied to COWORK_VIDEO_OUTDIR for the CEO to collect.
set -uo pipefail

COMFY_DIR="/home/wayne/docker-compose-yamls/comfyui"
OUTDIR="${COWORK_VIDEO_OUTDIR:-/home/wayne/workspace/cowork_professional_promo}"
DURATION="${COWORK_VIDEO_DURATION:-10}"
TITLE="${COWORK_TASK_TITLE:-untitled}"
DESC="${COWORK_TASK_DESCRIPTION:-}"
TID="${COWORK_TASK_ID:-$(date +%s)}"
NAME="cowork_$(printf '%s' "$TID" | tr -cd 'a-zA-Z0-9' | cut -c1-12)"

# 1) ComfyUI must already be up (boot service on :8188). Do NOT start heavy models.
if ! curl -sf -o /dev/null http://localhost:8188/; then
  echo "VIDEO PIPELINE ABORTED: ComfyUI not reachable at http://localhost:8188."
  echo "Start it with: (cd $COMFY_DIR && docker compose up -d), then retry the task."
  exit 1
fi

# 2) Distill ONE cinematic scene line from the task (Qwen, best-effort; title fallback).
SCENE=""
if command -v hermes >/dev/null 2>&1; then
  SCENE=$(timeout 150 hermes -m nvidia/Qwen3.6-35B-A3B-NVFP4 -z \
    "Turn this video request into ONE vivid cinematic scene description: a single line, visual only, under 30 words, no camera directions, for an image-to-video generator. Output ONLY the scene line, nothing else.
Title: ${TITLE}
Details: ${DESC}" 2>/dev/null | tail -1 | tr -d '\r')
fi
case "${SCENE// /}" in "") SCENE="$TITLE";; esac

echo "[video] task : $TITLE"
echo "[video] scene: $SCENE"
echo "[video] name : $NAME  · duration ${DURATION}s · LTX (GB10-safe, 35B stays up)"

# 3) Render — Flux still -> LTX img2vid -> stitched 1080x1920 short. Host script,
#    drives the running ComfyUI container over REST.
cd "$COMFY_DIR" || { echo "VIDEO PIPELINE ABORTED: $COMFY_DIR missing"; exit 1; }
if ! ./shorts.py --prompt "$SCENE" --name "$NAME" --duration "$DURATION"; then
  echo "VIDEO PIPELINE FAILED during LTX render (see shorts.py output above)."
  exit 1
fi

SRC="$COMFY_DIR/data/output/$NAME.mp4"
if [ ! -f "$SRC" ]; then
  echo "VIDEO PIPELINE: shorts.py exited 0 but $SRC not found."
  exit 1
fi

# 4) Collect the artifact where the CEO expects it.
mkdir -p "$OUTDIR"
DEST="$OUTDIR/$NAME.mp4"
cp -f "$SRC" "$DEST"
SZ=$(du -h "$DEST" | cut -f1)

echo ""
echo "VIDEO READY: $DEST ($SZ, ${DURATION}s 1080x1920, LTX-Video)"
echo "source: $SRC"
echo "scene prompt used: $SCENE"
