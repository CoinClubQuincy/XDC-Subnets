#!/usr/bin/env python3
"""
RAG pipeline using Qdrant as the vector database and OpenAI (ChatGPT API) for embeddings + answers.

Features
- Ingest a folder of .txt/.md files (simple, dependency-light)
- Auto-detect embedding vector size from the model (first call) and create the Qdrant collection correctly
- Upsert chunks with rich payload (text, source, chunk_id)
- Query top-k contexts and generate an answer via Chat Completions
- Works with local Qdrant (http://localhost:6333) or Qdrant Cloud (set QDRANT_API_KEY)

Usage
------
1) Copy .env.example to .env and fill in your keys/URLs.
2) pip install -r requirements.txt
3) Start Qdrant locally (docker) or use Qdrant Cloud.
4) Ingest:
   python rag_qdrant_chatgpt.py ingest --input-dir ./docs --collection my_docs
5) Ask:
   python rag_qdrant_chatgpt.py ask --question "What is in these docs?" --collection my_docs --top-k 5

Environment variables (.env)
----------------------------
OPENAI_API_KEY=...
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY= (only for Cloud; omit for local)
QDRANT_COLLECTION=my_docs
OPENAI_EMBED_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
CHUNK_SIZE_CHARS=1800
CHUNK_OVERLAP_CHARS=200
"""

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Dict, Optional

from dotenv import load_dotenv

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    VectorParams,
    PointStruct,
)

from openai import OpenAI

# -------------------------
# Utilities
# -------------------------

def read_text_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        print(f"[WARN] Failed reading {path}: {e}")
        return ""

def iter_text_files(root: Path) -> Iterable[Path]:
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in {".txt", ".md"}:
            yield p

def chunk_text(text: str, chunk_size: int = 1800, overlap: int = 200) -> List[str]:
    """
    Simple character-based chunker to avoid extra deps.
    """
    if not text:
        return []
    chunks = []
    i = 0
    n = len(text)
    while i < n:
        j = min(i + chunk_size, n)
        chunk = text[i:j]
        # Trim leading/trailing whitespace crudely
        chunk = chunk.strip()
        if chunk:
            chunks.append(chunk)
        if j == n:
            break
        i = max(j - overlap, 0)
    return chunks

@dataclass
class Settings:
    openai_api_key: str
    qdrant_url: str
    qdrant_api_key: Optional[str]
    collection: str
    embed_model: str
    chat_model: str
    chunk_size_chars: int
    chunk_overlap_chars: int

    @staticmethod
    def from_env() -> "Settings":
        load_dotenv()
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            print("ERROR: OPENAI_API_KEY is not set.")
            sys.exit(1)

        qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
        qdrant_api_key = os.getenv("QDRANT_API_KEY")  # optional
        collection = os.getenv("QDRANT_COLLECTION", "my_docs")
        embed_model = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
        chat_model = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
        chunk_size_chars = int(os.getenv("CHUNK_SIZE_CHARS", "1800"))
        chunk_overlap_chars = int(os.getenv("CHUNK_OVERLAP_CHARS", "200"))

        return Settings(
            openai_api_key=openai_api_key,
            qdrant_url=qdrant_url,
            qdrant_api_key=qdrant_api_key,
            collection=collection,
            embed_model=embed_model,
            chat_model=chat_model,
            chunk_size_chars=chunk_size_chars,
            chunk_overlap_chars=chunk_overlap_chars,
        )


# -------------------------
# Clients
# -------------------------

def make_openai_client(settings: Settings) -> OpenAI:
    # Uses OPENAI_API_KEY from env automatically
    return OpenAI(api_key=settings.openai_api_key)

def make_qdrant_client(settings: Settings) -> QdrantClient:
    if settings.qdrant_api_key:
        return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=60.0)
    return QdrantClient(url=settings.qdrant_url, timeout=60.0)


# -------------------------
# Embeddings
# -------------------------

def embed_texts(oai: OpenAI, texts: List[str], model: str) -> List[List[float]]:
    # Batch embedding; OpenAI API accepts list input
    resp = oai.embeddings.create(model=model, input=texts)
    return [d.embedding for d in resp.data]

def embedding_size(oai: OpenAI, model: str) -> int:
    # Derive vector size from a sample call to eliminate guesswork
    vec = embed_texts(oai, ["dimension probe"], model)[0]
    return len(vec)


# -------------------------
# Qdrant Collection Helpers
# -------------------------

def ensure_collection(client: QdrantClient, name: str, vector_size: int):
    """
    Create the collection if it does not exist; if it exists, assume parameters are correct.
    """
    try:
        exists = client.collection_exists(name)
    except Exception:
        # Fallback for older clients
        try:
            client.get_collection(name)
            exists = True
        except Exception:
            exists = False

    if not exists:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        print(f"[OK] Created collection '{name}' (size={vector_size}, metric=cosine)")
    else:
        print(f"[OK] Collection '{name}' already exists")


# -------------------------
# Ingest
# -------------------------

def ingest_folder(settings: Settings, input_dir: Path):
    oai = make_openai_client(settings)
    qdrant = make_qdrant_client(settings)

    # Derive size from model dynamically, then ensure collection
    dim = embedding_size(oai, settings.embed_model)
    ensure_collection(qdrant, settings.collection, dim)

    points: List[PointStruct] = []
    pid = 0

    for fpath in iter_text_files(input_dir):
        text = read_text_file(fpath)
        if not text.strip():
            continue

        chunks = chunk_text(text, settings.chunk_size_chars, settings.chunk_overlap_chars)
        if not chunks:
            continue

        # Embed in reasonably sized batches
        BATCH = 64
        for i in range(0, len(chunks), BATCH):
            batch = chunks[i:i+BATCH]
            vectors = embed_texts(oai, batch, settings.embed_model)

            for j, (chunk, vec) in enumerate(zip(batch, vectors)):
                payload = {
                    "source": str(fpath),
                    "chunk_index": i + j,
                    "text": chunk,
                }
                points.append(PointStruct(id=pid, vector=vec, payload=payload))
                pid += 1

            # Upsert per batch to keep memory bounded
            qdrant.upsert(
                collection_name=settings.collection,
                points=points,
                wait=True,
            )
            print(f"[UPSERT] {len(points)} points (latest file: {fpath.name})")
            points.clear()

    print("[DONE] Ingestion complete.")


# -------------------------
# Query + Answer
# -------------------------

def retrieve(
    settings: Settings,
    question: str,
    top_k: int = 5,
) -> List[Dict]:
    oai = make_openai_client(settings)
    qdrant = make_qdrant_client(settings)

    qvec = embed_texts(oai, [question], settings.embed_model)[0]

    res = qdrant.query_points(
        collection_name=settings.collection,
        query=qvec,
        limit=top_k,
        with_payload=True,
    )
    # Normalize output
    out = []
    for p in res.points:
        payload = p.payload or {}
        out.append({
            "id": p.id,
            "score": p.score,
            "source": payload.get("source"),
            "text": payload.get("text", ""),
        })
    return out

def build_prompt(question: str, contexts: List[Dict]) -> str:
    ctx = "\n\n---\n\n".join(
        f"Source: {c.get('source')}\n\n{c.get('text','')}" for c in contexts
    )
    return (
        "You are a careful research assistant. Answer the question using ONLY the context.\n"
        "If the answer is not in the context, say you don't know.\n\n"
        f"Context:\n{ctx}\n\n"
        f"Question: {question}\n"
        "Answer:"
    )

def answer_with_chat(settings: Settings, question: str, contexts: List[Dict]) -> str:
    oai = make_openai_client(settings)
    prompt = build_prompt(question, contexts)
    resp = oai.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": "You are ChatGPT, a large language model that cites only from provided context."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content

# -------------------------
# CLI
# -------------------------

def main():
    parser = argparse.ArgumentParser(description="Qdrant + OpenAI RAG")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ingest = sub.add_parser("ingest", help="Ingest a folder of .txt/.md files")
    p_ingest.add_argument("--input-dir", required=True, type=str, help="Path to folder")

    p_ask = sub.add_parser("ask", help="Ask a question against the vector DB")
    p_ask.add_argument("--question", required=True, type=str, help="Your question")
    p_ask.add_argument("--top-k", type=int, default=5, help="Results to retrieve")

    p_common = [p_ingest, p_ask]
    for p in p_common:
        p.add_argument("--collection", type=str, help="Qdrant collection name")

    args = parser.parse_args()
    settings = Settings.from_env()
    if getattr(args, "collection", None):
        settings.collection = args.collection

    if args.cmd == "ingest":
        input_dir = Path(args.input_dir).expanduser().resolve()
        if not input_dir.exists():
            print(f"ERROR: Input dir not found: {input_dir}")
            sys.exit(1)
        ingest_folder(settings, input_dir)
    elif args.cmd == "ask":
        hits = retrieve(settings, args.question, top_k=args.top_k)
        print(json.dumps({"hits": hits}, ensure_ascii=False, indent=2))
        if not hits:
            print("\nNo results; cannot construct an answer.")
            sys.exit(0)
        ans = answer_with_chat(settings, args.question, hits)
        print("\n=== ANSWER ===\n")
        print(ans)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
