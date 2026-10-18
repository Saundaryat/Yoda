from sqlmodel import Session

from app.db import create_db, engine
from app.models import Account

create_db()
with Session(engine) as session:
    if not session.get(Account, "CUST-001"):
        session.add(Account(customer_id="CUST-001", name="Demo Customer", balance=1250.50))
        session.commit()
print("Seeded CUST-001")

