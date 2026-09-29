from database import Base, engine
from models import User  # noqa: F401 - ensures SQLAlchemy registers the model


Base.metadata.create_all(bind=engine)
print("Database tables created successfully.")
