from database import (
    initialize_database,
)
from models import Report, User  # noqa: F401 - register all database models


initialize_database()
print("Database tables created successfully.")
