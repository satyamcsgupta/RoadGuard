from passlib.context import CryptContext


password_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
