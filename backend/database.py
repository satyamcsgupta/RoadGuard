import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from config import load_backend_env

load_backend_env()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "roadguard.db"

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL or not DATABASE_URL.strip():
    DATABASE_URL = f"sqlite:///{DB_PATH}"


def normalize_database_url(database_url: str) -> str:
    normalized = database_url.strip()
    if normalized.startswith("postgres://"):
        normalized = "postgresql://" + normalized[len("postgres://"):]
    if normalized.startswith("postgresql://"):
        normalized = "postgresql+psycopg://" + normalized[len("postgresql://"):]
    return normalized


DATABASE_URL = normalize_database_url(DATABASE_URL)


class Base(DeclarativeBase):
    pass


if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        future=True,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        future=True,
    )


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True,
)


def ensure_report_description_column(database_engine=engine):
    inspector = inspect(database_engine)
    if "reports" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("reports")}
    if "description" not in columns:
        with database_engine.begin() as connection:
            connection.execute(text("ALTER TABLE reports ADD COLUMN description TEXT"))


def ensure_report_status_column(database_engine=engine):
    inspector = inspect(database_engine)
    if "reports" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("reports")}
    if "status" not in columns:
        with database_engine.begin() as connection:
            connection.execute(
                text(
                    "ALTER TABLE reports "
                    "ADD COLUMN status VARCHAR NOT NULL DEFAULT 'submitted'"
                )
            )


def ensure_report_admin_note_column(database_engine=engine):
    inspector = inspect(database_engine)
    if "reports" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("reports")}
    if "admin_note" not in columns:
        with database_engine.begin() as connection:
            connection.execute(text("ALTER TABLE reports ADD COLUMN admin_note TEXT"))


def initialize_database(database_engine=engine):
    Base.metadata.create_all(bind=database_engine)
    ensure_report_description_column(database_engine)
    ensure_report_status_column(database_engine)
    ensure_report_admin_note_column(database_engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()