#!/bin/bash
# Installs whisper.cpp binary + downloads the base.en model used for voice input.
# Safe to re-run: skips both steps if already present.

set -e

MODEL_DIR="$HOME/.cache/vibe-ide"
MODEL_FILE="$MODEL_DIR/ggml-base.en.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

# 1. whisper-cli binary
if command -v whisper-cli >/dev/null 2>&1 || command -v whisper-cpp >/dev/null 2>&1; then
  echo "whisper-cli already installed."
else
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "whisper-cli not found. Install whisper.cpp manually for your platform."
    exit 0
  fi
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install from https://brew.sh, then re-run npm install."
    exit 0
  fi
  echo "Installing whisper-cpp via brew..."
  brew install whisper-cpp
fi

# 2. Model file (~150MB)
if [ -f "$MODEL_FILE" ]; then
  echo "Whisper model already at $MODEL_FILE"
else
  mkdir -p "$MODEL_DIR"
  echo "Downloading whisper base.en model (~150MB) to $MODEL_FILE..."
  curl -L --progress-bar -o "$MODEL_FILE" "$MODEL_URL"
fi

echo "Voice input ready."
