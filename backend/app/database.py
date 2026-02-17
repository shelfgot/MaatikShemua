"""Database configuration with SQLite WAL mode."""
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import DATABASE_URL

# Create engine with SQLite-specific settings
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Configure SQLite for better concurrency."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")  # 5 second timeout
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Get database session dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database tables and indexes."""
    from app.models import db_models  # Import to register models
    Base.metadata.create_all(bind=engine)
    
    # Apply indexes
    with engine.connect() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_page_document ON pages(document_id, page_number)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_transcription_page_type ON transcriptions(page_id, type)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_version_transcription ON transcription_versions(transcription_id, created_at DESC)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_version_hash ON transcription_versions(transcription_id, content_hash)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_line_transcription ON transcription_lines(transcription_id, line_number)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_status ON background_tasks(status, created_at)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_model_type ON models(type, is_default)"))
        conn.commit()
