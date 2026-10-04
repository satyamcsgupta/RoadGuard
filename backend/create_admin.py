import getpass
import sys

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from database import SessionLocal
from models import User
from security import password_context


def prompt_non_empty(prompt: str) -> str:
    while True:
        value = input(prompt).strip()
        if value:
            return value
        print("This value cannot be empty.")


def prompt_password() -> str:
    while True:
        password = getpass.getpass("Admin password (minimum 8 characters): ")
        if len(password) < 8:
            print("Password must be at least 8 characters.")
            continue

        confirmation = getpass.getpass("Confirm admin password: ")
        if password != confirmation:
            print("Passwords do not match. Try again.")
            continue
        return password


def create_admin() -> int:
    if not sys.stdin.isatty():
        print("Run this script directly in an interactive terminal.", file=sys.stderr)
        return 1

    name = prompt_non_empty("Admin name: ")
    email = prompt_non_empty("Admin email: ").lower()

    session = SessionLocal()
    try:
        existing_user = session.scalar(select(User).where(User.email == email))
    finally:
        session.close()

    if existing_user is not None:
        if existing_user.role == "admin":
            print("An admin account with this email already exists.")
            return 0
        print(
            "An account with this email already exists as a normal user. "
            "It was not promoted; use a different email for the admin account."
        )
        return 1

    password = prompt_password()
    session = SessionLocal()
    try:
        admin = User(
            name=name,
            email=email,
            password_hash=password_context.hash(password),
            role="admin",
        )
        session.add(admin)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            concurrent_user = session.scalar(select(User).where(User.email == email))
            if concurrent_user is not None and concurrent_user.role == "admin":
                print("An admin account with this email already exists.")
                return 0
            if concurrent_user is not None:
                print(
                    "An account with this email already exists as a normal user. "
                    "It was not promoted."
                )
                return 1
            raise

        print("Admin account created successfully.")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    try:
        raise SystemExit(create_admin())
    except (KeyboardInterrupt, EOFError):
        print("\nAdmin account creation cancelled.", file=sys.stderr)
        raise SystemExit(1)
