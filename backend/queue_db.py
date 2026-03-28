import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "queue.db")

def get_connection():
    return sqlite3.connect(DB_PATH, timeout=10.0)

def init_db():
    with get_connection() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS frame_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_id TEXT UNIQUE,
                image_b64 TEXT,
                metadata TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

def enqueue_frame(frame_id: str, image_b64: str, metadata: dict):
    with get_connection() as conn:
        try:
            conn.execute(
                "INSERT INTO frame_jobs (frame_id, image_b64, metadata) VALUES (?, ?, ?)",
                (frame_id, image_b64, json.dumps(metadata))
            )
        except sqlite3.IntegrityError:
            # Skip duplicates based on frame_id matching
            pass

def get_next_job():
    # SQLite doesn't natively support atomic "SELECT AND UPDATE" block reliably without explicit locking,
    # but BEGIN EXCLUSIVE covers the write/read lock for queue patterns.
    conn = get_connection()
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()
        cursor.execute("SELECT id, frame_id, image_b64, metadata FROM frame_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
        row = cursor.fetchone()
        if row:
            cursor.execute("UPDATE frame_jobs SET status = 'processing' WHERE id = ?", (row['id'],))
            conn.commit()
            return dict(row)
        # Revert immediately if nothing to do
        conn.commit()
        return None
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def mark_job_completed(job_id: int):
    with get_connection() as conn:
        conn.execute("UPDATE frame_jobs SET status = 'completed' WHERE id = ?", (job_id,))
