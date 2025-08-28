# 1) Setup
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in keys/URLs

# 2) Start Qdrant (local)
docker run -p 6333:6333 qdrant/qdrant

# 3) Ingest your files (txt/md)
python rag_qdrant_chatgpt.py ingest --input-dir ./docs --collection my_docs

# 4) Ask questions
python rag_qdrant_chatgpt.py ask --question "What did we say about pricing?" --collection my_docs --top-k 5