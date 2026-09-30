from database import Base, engine
from models import Report, User  # noqa: F401 - register all database models


Base.metadata.create_all(bind=engine)
print("Database tables created successfully.")
