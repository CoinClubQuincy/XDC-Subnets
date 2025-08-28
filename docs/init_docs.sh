#!/usr/bin/env bash
set -euo pipefail

# init_docs.sh — scaffold a GitBook-ready docs directory
# Usage: ./init_docs.sh [docs_dir]
# Example: ./init_docs.sh docs

DOCS_DIR="${1:-docs}"

echo "→ Creating $DOCS_DIR structure…"
mkdir -p "$DOCS_DIR"/{getting-started,guides,api,reference,assets}

# --- Root landing page ---
cat > "$DOCS_DIR/index.md" <<'MD'
# Project Docs

Welcome! Use the left navigation to jump into topics.

> Tip: If you’re viewing this on GitBook, use **Search** to find pages instantly.
MD

# --- Optional GitBook config (helps with titles, root page) ---
# Note: This file is optional; GitBook can infer structure from folders.
cat > "$DOCS_DIR/.gitbook.yaml" <<'YAML'
root: ./index.md
title: Project Documentation
YAML

# --- Core section pages requested ---
cat > "$DOCS_DIR/guides/subnet.md" <<'MD'
# Subnet

_Describe your subnet architecture, consensus, parameters, validators, and network endpoints._

## Overview
- Purpose
- Topology
- Security assumptions

## Endpoints
- RPC:
- Explorer:
- Faucet:

## Operations
- Spin up / join
- Monitoring
- Upgrades
MD

cat > "$DOCS_DIR/guides/credit-contracts.md" <<'MD'
# Credit Contracts

_Define the credit model, key contracts, roles, and flows._

## Contracts
- Names & addresses
- Interfaces
- Events

## Flows
1. Origination
2. Repayment
3. Liquidation

## Risks & Controls
- Rate limits
- Oracles
- Pause/guard rails
MD

cat > "$DOCS_DIR/api/apis.md" <<'MD'
# APIs

_List REST/GraphQL/WebSocket endpoints and example requests/responses._

## Base URL